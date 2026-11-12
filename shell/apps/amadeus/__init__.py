"""Amadeus — the Makise Kurisu AI inside the phone (Alt+P → Amadeus).

Three sections, one file each:
  personality.py  who she is, how she talks, emotion → picture
  memory.py       long-term notes + the running conversation
  thinking.py     the Gemini Flash model, its API keys, and the file tools

This module is the switchboard between those and the phone page: the page sends
`amadeus_*` commands, the answer comes back later as `amadeusEvent({...})`.
"""
import json
import threading

import sg_common as C
from . import memory as _memory, personality, thinking

SETTINGS_FILE = C.DATA_DIR / "amadeus" / "settings.json"
MODES = ["ask", "allow", "read-only", "off"]


class Controller:
    def __init__(self, cfg, emit):
        """emit(event_dict) must be safe to call from a worker thread."""
        self.emit = emit
        a = cfg.get("amadeus", {}) if isinstance(cfg.get("amadeus"), dict) else {}
        sec = lambda name: a.get(name, {}) if isinstance(a.get(name), dict) else {}
        self.user = (a.get("user_name") or cfg.get("lock", {}).get("display_name")
                     or __import__("getpass").getuser())
        self.roots = a.get("folders") or ["~"]
        self.history_messages = int(sec("memory").get("history_messages", 24))
        self.memory = _memory.Memory(max_facts=int(sec("memory").get("max_facts", 200)))
        self.gemini = thinking.Gemini(sec("thinking").get("model", ""))
        self.salieri = thinking.Salieri(sec("salieri"))
        self.link = "ok"              # ok | limited (rate-limited) | offline | salieri (local stand-in)
        self.mode = a.get("files", "ask")
        try:
            saved = json.loads(SETTINGS_FILE.read_text())
            self.mode = saved.get("files", self.mode)
        except (OSError, ValueError):
            pass
        if self.mode not in MODES:
            self.mode = "ask"
        self.busy = False
        self.status = ""
        self.pending = None           # change waiting for approval
        self._answer = threading.Event()
        self._allowed = False
        self.emotion = "neutral"
        for m in reversed(self.memory.history()):
            if m["role"] == "model" and m.get("segments"):
                self.emotion = m["segments"][-1]["emotion"]
                break

    # ---- page → here ----
    def handle(self, cmd, msg):
        if cmd == "amadeus_state":
            return self.state()
        if cmd == "amadeus_send":
            return self.send(str(msg.get("text", "")))
        if cmd == "amadeus_confirm":
            if self.pending and msg.get("id") == self.pending["id"]:
                self._allowed = bool(msg.get("allow"))
                self.pending = None
                self._answer.set()
            return self.state()
        if cmd == "amadeus_key_add":
            key = "".join(str(msg.get("key", "")).split())
            if len(key) < 20:
                return {"error": "that does not look like an API key"}
            keys = thinking.load_keys()
            if key not in keys:
                thinking.save_keys(keys + [key])
            return self.state()
        if cmd == "amadeus_keys_clear":
            thinking.save_keys([])
            return self.state()
        if cmd == "amadeus_mode":
            self.mode = MODES[(MODES.index(self.mode) + 1) % len(MODES)]
            SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
            SETTINGS_FILE.write_text(json.dumps({"files": self.mode}))
            return self.state()
        if cmd == "amadeus_forget":
            self.memory.forget(msg.get("id"))
            return self.state()
        if cmd == "amadeus_call_answer":
            return self.call_answer(str(msg.get("raw", "")))
        if cmd == "amadeus_clear":
            if not self.busy:
                self.memory.clear_history()
                self.emotion = "neutral"
            return self.state()
        return {"error": f"unknown command {cmd}"}

    def state(self):
        images = personality.emotion_images()
        log = []
        for m in self.memory.history():
            if m["role"] == "user":
                log.append({"role": "user", "text": m["text"]})
            elif m["role"] == "model":
                log += [{"role": "ai", **s} for s in m.get("segments") or personality.split_reply(m["text"])]
            else:
                log.append({"role": "sys", "text": m["text"]})
        return {
            "keys": len(thinking.load_keys()), "model": self.gemini.model, "mode": self.mode,
            "images": images, "pictures": sorted(images), "emotions": personality.known_emotions(),
            "emotion": self.emotion, "picture": personality.picture_for(self.emotion, images),
            "busy": self.busy, "status": self.status, "pending": self.pending,
            "facts": self.memory.facts(), "log": log[-120:], "user": self.user,
            "link": self.link, "channel": personality.channel_level(), "salieri": self.salieri.enabled,
            "personality_file": str(personality.PERSONALITY_FILE),
            "emotions_dir": str(personality.USER_EMOTIONS),
        }

    def send(self, text):
        text = text.strip()
        if not text:
            return self.state()
        if self.busy:
            return {"error": "still working on the last message"}
        nick = personality.nickname_in(text)
        # without a key she can still answer through Salieri, or at least object to a nickname
        if not thinking.load_keys() and not self.salieri.enabled and not nick:
            return {"error": "no API key"}
        self.busy, self.status = True, "thinking"
        if nick:
            self.emotion = "annoyed"          # the face changes before the words arrive
        self.memory.add("user", text)
        threading.Thread(target=self._work, args=(nick,), daemon=True).start()
        return self.state()

    # ---- calls: she rings the phone (a long job ended, the battery is low, it is 3 a.m.) ----
    def call_line(self, reason, detail=""):
        raw = personality.call_line(reason, detail)
        return {"raw": raw, "segments": personality.split_reply(raw)}

    def call_answer(self, raw):
        """The owner picked up: what she says becomes part of the conversation."""
        raw = raw.strip()[:2000]
        if raw:
            segments = personality.split_reply(raw)
            self.memory.add("model", raw, segments)
            self.emotion = segments[-1]["emotion"]
        return self.state()

    # ---- worker thread ----
    def _set_status(self, text):
        self.status = text
        self.emit({"type": "status", "text": text})

    def _confirm(self, change):
        self._answer.clear()
        self._allowed = False
        self.pending = {"id": f"c{id(change)}", **change}
        self.emit({"type": "confirm"})
        if not self._answer.wait(timeout=600):   # nobody answered: treat as "no"
            self.pending = None
        return self._allowed

    def _answer_text(self, nick):
        """Amadeus over the network; Salieri (local model) when she cannot be reached."""
        extra = "\n\n".join(filter(None, [personality.channel_rules(),
                                           personality.nickname_rule(nick) if nick else ""]))
        why = "no API key"
        if thinking.load_keys():
            tools = thinking.Tools(self.memory, self.mode, self.roots, self._confirm, self._set_status)
            try:
                raw = thinking.think(self.gemini, self.memory, tools, self.user, self.history_messages, extra)
                self.link = "ok"
                return raw
            except thinking.RateLimited:
                self.link = "limited"
                raise
            except thinking.NetworkError as e:
                why = str(e)
        self.link = "offline"
        if self.salieri.enabled:
            self._set_status("no link · asking Salieri")
            try:
                raw = thinking.think_offline(self.salieri, self.memory, self.user, self.history_messages, extra)
                self.link = "salieri"
                return raw
            except thinking.ApiError as e:
                why = f"{why}; Salieri: {e}"
        if nick:
            return personality.nickname_canned(nick)
        raise thinking.ApiError(f"no link to Amadeus ({why})")

    def _work(self, nick=None):
        try:
            raw = self._answer_text(nick)
            segments = personality.split_reply(raw)
            if nick:
                segments = personality.force_annoyed(segments)
            self.memory.add("model", raw, segments)
            self.emotion = segments[-1]["emotion"]
        except thinking.ApiError as e:
            self.memory.add("note", f"Amadeus could not answer: {e}")
        except Exception as e:  # never leave the page waiting
            self.memory.add("note", f"Amadeus hit an internal error: {type(e).__name__}: {e}")
        finally:
            self.busy, self.status, self.pending = False, "", None
            self.emit({"type": "done"})
