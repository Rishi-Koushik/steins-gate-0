"""Amadeus — section 2 of 3: MEMORY.

Two stores in one JSON file (~/.local/share/sg-shell/amadeus/memory.json):
  facts    long-term notes she chose to keep about the owner and their work ("remember" tool)
  history  the running conversation, so a restart does not wipe what was just said
Nothing here leaves the machine except as part of the prompt sent to the thinking model.
"""
import json
import os
import threading
import time

import sg_common as C

MEMORY_FILE = C.DATA_DIR / "amadeus" / "memory.json"


class Memory:
    def __init__(self, max_facts=200, keep_messages=200):
        self.max_facts = max_facts
        self.keep_messages = keep_messages
        self.lock = threading.Lock()
        self.data = {"facts": [], "history": [], "next_id": 1}
        try:
            loaded = json.loads(MEMORY_FILE.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                self.data.update({k: loaded[k] for k in self.data if k in loaded})
        except (OSError, ValueError):
            pass

    def _save(self):
        MEMORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = MEMORY_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, MEMORY_FILE)

    # ---- long-term facts ----
    def facts(self):
        with self.lock:
            return list(self.data["facts"])

    def remember(self, text):
        text = " ".join(str(text).split())[:400]
        if not text:
            return {"error": "nothing to remember"}
        with self.lock:
            for f in self.data["facts"]:
                if f["text"].lower() == text.lower():
                    return {"id": f["id"], "note": "already remembered"}
            fact = {"id": self.data["next_id"], "text": text, "ts": time.strftime("%Y-%m-%d")}
            self.data["next_id"] += 1
            self.data["facts"].append(fact)
            del self.data["facts"][:-self.max_facts]
            self._save()
        return {"id": fact["id"], "saved": True}

    def forget(self, fact_id):
        with self.lock:
            before = len(self.data["facts"])
            self.data["facts"] = [f for f in self.data["facts"] if str(f["id"]) != str(fact_id)]
            self._save()
            return {"forgotten": before != len(self.data["facts"])}

    def facts_prompt(self):
        facts = self.facts()
        if not facts:
            return "## What you remember\nNothing saved yet."
        lines = "\n".join(f"- (#{f['id']}, {f['ts']}) {f['text']}" for f in facts)
        return "## What you remember (long-term notes you saved yourself)\n" + lines

    # ---- conversation ----
    def add(self, role, text, segments=None):
        entry = {"role": role, "text": text, "ts": time.strftime("%Y-%m-%d %H:%M")}
        if segments:
            entry["segments"] = segments
        with self.lock:
            self.data["history"].append(entry)
            del self.data["history"][:-self.keep_messages]
            self._save()

    def history(self):
        with self.lock:
            return list(self.data["history"])

    def recent(self, n):
        """Last n messages, starting on a user message (the API wants user first)."""
        msgs = [m for m in self.history() if m["role"] in ("user", "model")][-n:]
        while msgs and msgs[0]["role"] != "user":
            msgs.pop(0)
        return msgs

    def clear_history(self):
        with self.lock:
            self.data["history"] = []
            self._save()
