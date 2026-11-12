"""Amadeus — section 3 of 3: THINKING.

The reasoning model (Google Gemini Flash, free-tier API keys) and the hands it works with:
tools to look at files, change them, and write to memory. Standard library only.

Privacy: whatever she reads is sent to Google's API as part of the conversation. Secrets
(ssh/gpg keys, browser profiles, password stores, her own API keys) are refused outright.
"""
import difflib
import fnmatch
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

import sg_common as C
from . import personality

API_BASE = os.environ.get("AMADEUS_API_BASE", "https://generativelanguage.googleapis.com/v1beta")
KEYS_FILE = personality.CONFIG_DIR / "keys"
BACKUPS = C.DATA_DIR / "amadeus" / "backups"
DEFAULT_MODEL = "gemini-flash-latest"
MAX_READ = 60_000          # bytes of one file sent to the model per read
MAX_STEPS = 14             # tool rounds per message

# never read or written, wherever they are
DENY_PARTS = {".ssh", ".gnupg", ".password-store", "keyrings", ".aws", ".kube", ".docker", ".mozilla",
              ".thunderbird", "google-chrome", "chromium", "BraveSoftware", ".claude", ".gemini",
              ".netrc", ".git-credentials", ".pki", "whatsapp"}
DENY_NAMES = ("id_rsa*", "id_ed25519*", "id_ecdsa*", "*.pem", "*.key", "*.p12", "*.pfx", "*.kdbx",
              ".env", ".env.*", "*.keystore", "cookies.sqlite", "logins.json", "key4.db")
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", ".cache", "target", "build", "dist"}


class ApiError(Exception):
    pass


class NetworkError(ApiError):
    """The API could not be reached at all (offline)."""


class RateLimited(ApiError):
    """Every key is over its quota for the moment."""


# ---------------------------------------------------------------- keys
def load_keys():
    keys = []
    try:
        for line in KEYS_FILE.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and line not in keys:
                keys.append(line)
    except OSError:
        pass
    env = os.environ.get("GEMINI_API_KEY", "").strip()
    if env and env not in keys:
        keys.append(env)
    return keys


def save_keys(keys):
    KEYS_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(KEYS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("# Google AI Studio API keys for Amadeus, one per line\n" + "".join(k + "\n" for k in keys))
    os.chmod(KEYS_FILE, 0o600)


# ---------------------------------------------------------------- Gemini client
class Gemini:
    """generateContent over plain HTTPS. Rotates to the next key when one is rate-limited or rejected."""

    def __init__(self, model=""):
        self.model = model or DEFAULT_MODEL
        self.key_index = 0

    def _post(self, key, path, body=None, timeout=90):
        req = urllib.request.Request(
            f"{API_BASE}/{path}", data=json.dumps(body).encode() if body is not None else None,
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
            method="POST" if body is not None else "GET")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def _pick_model(self, key):
        """The configured model does not exist for this key: take the newest stable Flash."""
        models = self._post(key, "models?pageSize=200").get("models", [])
        names = [m["name"].split("/", 1)[-1] for m in models
                 if "generateContent" in m.get("supportedGenerationMethods", [])]
        flash = [n for n in names if re.fullmatch(r"gemini-[\d.]+-flash(-preview)?", n)]
        if not flash:
            raise ApiError(f"model '{self.model}' is not available and no Flash model was found")

        def rank(n):
            ver = tuple(int(x) for x in re.findall(r"\d+", n.split("-")[1]))
            return (not n.endswith("-preview"), ver)
        stable = [n for n in flash if not n.endswith("-preview")] or flash
        return max(stable, key=rank)

    def generate(self, body):
        keys = load_keys()
        if not keys:
            raise ApiError("no API key")
        last = "no answer"
        for attempt in range(len(keys) + 2):
            key = keys[self.key_index % len(keys)]
            try:
                return self._post(key, f"models/{self.model}:generateContent", body)
            except urllib.error.HTTPError as e:
                try:
                    detail = json.loads(e.read().decode("utf-8", "replace"))["error"]["message"]
                except Exception:
                    detail = e.reason
                last = f"{e.code}: {str(detail)[:300]}"
                if e.code == 404:
                    picked = self._pick_model(key)
                    if picked == self.model:
                        raise ApiError(last)
                    self.model = picked
                elif e.code in (429, 401, 403) or (e.code == 400 and "API key" in str(detail)):
                    self.key_index += 1          # next key
                    if attempt >= len(keys) - 1 and e.code == 429:
                        raise RateLimited("every API key is rate-limited right now (free tier). "
                                       "Wait a minute or add another key. " + last)
                elif e.code >= 500:
                    time.sleep(2)
                else:
                    raise ApiError(last)
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                last = f"network: {e}"
                time.sleep(1)
        raise (NetworkError if last.startswith("network:") else ApiError)(last)


# ---------------------------------------------------------------- Salieri: the offline stand-in
class Salieri:
    """A local model (Ollama) that answers when Amadeus cannot be reached: no network, or no API key.
    Plain conversation only: no file tools. [amadeus.salieri] enabled = "auto" | "off"."""

    def __init__(self, cfg=None):
        cfg = cfg or {}
        enabled = cfg.get("enabled", "auto")
        self.enabled = enabled is not False and str(enabled).lower() not in ("off", "false", "no")
        self.url = str(cfg.get("url") or os.environ.get("AMADEUS_SALIERI_URL") or "http://127.0.0.1:11434").rstrip("/")
        self.model = str(cfg.get("model") or "")

    def _req(self, path, body=None, timeout=4):
        req = urllib.request.Request(
            f"{self.url}{path}", data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json"}, method="POST" if body is not None else "GET")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def pick_model(self):
        if not self.model:
            models = [m.get("name", "") for m in self._req("/api/tags").get("models", [])]
            models = [m for m in models if m and "embed" not in m]
            if not models:
                raise ApiError("the local model server has no model installed (ollama pull …)")
            self.model = models[0]
        return self.model

    def chat(self, system, messages):
        """messages: [{"role": "user" | "model", "text": …}] → reply text. Raises ApiError."""
        if not self.enabled:
            raise ApiError("Salieri is switched off")
        try:
            body = {"model": self.pick_model(), "stream": False, "options": {"temperature": 0.9},
                    "messages": [{"role": "system", "content": system}] + [
                        {"role": "assistant" if m["role"] == "model" else "user", "content": m["text"]}
                        for m in messages]}
            text = (self._req("/api/chat", body, timeout=180).get("message") or {}).get("content", "").strip()
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as e:
            raise ApiError(f"no local model at {self.url} ({e})")
        if not text:
            raise ApiError("the local model gave no answer")
        return text


def think_offline(salieri, memory, user_name, history_messages=24, extra=""):
    """Answer the newest user message with the local model. Returns the raw reply text."""
    system = "\n\n".join(filter(None, [
        personality.user_personality(user_name),
        personality.emotion_rules(),
        memory.facts_prompt(),
        extra,
        "## Now\nThe link to the Amadeus servers is down. You are running as Salieri, the small offline copy "
        "on this laptop: you can talk, but you cannot open or change files until the link is back. "
        "Say so if the owner asks for that. Keep replies short. "
        f"It is {time.strftime('%A %Y-%m-%d %H:%M')}. The owner is {user_name}.",
    ]))
    return salieri.chat(system, memory.recent(history_messages))


# ---------------------------------------------------------------- file tools
def _schema(props, required):
    return {"type": "OBJECT", "properties": {k: {"type": t, "description": d} for k, (t, d) in props.items()},
            "required": required}


TOOL_DECLS = [
    {"name": "list_dir", "description": "List a folder: names, sizes, which entries are folders.",
     "parameters": _schema({"path": ("STRING", "Folder path. '~' is the owner's home.")}, ["path"])},
    {"name": "find_files", "description": "Find files by name pattern under a folder (recursive).",
     "parameters": _schema({"path": ("STRING", "Folder to search."),
                            "pattern": ("STRING", "Shell-style name pattern, e.g. '*.java' or 'Main*'.")},
                           ["path", "pattern"])},
    {"name": "search_text", "description": "Search file contents under a folder (or one file) for a regular expression.",
     "parameters": _schema({"path": ("STRING", "Folder or file."), "regex": ("STRING", "Python regular expression."),
                            "name_pattern": ("STRING", "Optional file-name pattern such as '*.py'.")},
                           ["path", "regex"])},
    {"name": "read_file", "description": "Read a text file with line numbers. Always read a file before changing it.",
     "parameters": _schema({"path": ("STRING", "File path."),
                            "start_line": ("INTEGER", "First line to read (default 1)."),
                            "max_lines": ("INTEGER", "How many lines (default 400).")}, ["path"])},
    {"name": "edit_file", "description": "Change part of a file: replace old_text (must appear exactly once, "
                                         "copied exactly from the file without line numbers) with new_text.",
     "parameters": _schema({"path": ("STRING", "File path."), "old_text": ("STRING", "Exact text to replace."),
                            "new_text": ("STRING", "Replacement text."),
                            "reason": ("STRING", "One short sentence: what this fixes.")},
                           ["path", "old_text", "new_text"])},
    {"name": "write_file", "description": "Create a new file or replace a whole file with new content.",
     "parameters": _schema({"path": ("STRING", "File path."), "content": ("STRING", "Full new content."),
                            "reason": ("STRING", "One short sentence: why.")}, ["path", "content"])},
    {"name": "remember", "description": "Save one lasting fact about the owner or their work to your long-term memory.",
     "parameters": _schema({"text": ("STRING", "The fact, one sentence.")}, ["text"])},
    {"name": "forget", "description": "Delete a long-term memory by its number.",
     "parameters": _schema({"id": ("INTEGER", "Memory number, as shown in 'What you remember'.")}, ["id"])},
]

TOOL_RULES = """\
## Your hands
You can look at and change files on this laptop with your tools. The owner wants you to find
and fix mistakes in their programs and files.
- Look before you answer: list, search and read instead of guessing. Never invent file contents.
- To fix something, read the file, then use edit_file with a small exact replacement (or
  write_file for a new file). Each change is shown to the owner for approval and the original
  is backed up, so make one focused change at a time and say what you changed and why.
- If a tool returns an error, say so honestly. Do not claim a change that was refused or failed.
- You cannot run programs. If something needs running to verify, tell the owner what to run.
- Use remember for lasting facts worth keeping (their name, projects, preferences), not chit-chat.
"""


class Tools:
    """mode: "ask" (changes need approval), "allow", "read-only", "off"."""

    def __init__(self, memory, mode, roots, confirm, status):
        self.memory, self.mode = memory, mode
        self.roots = [Path(os.path.realpath(os.path.expanduser(r))) for r in roots] or [C.HOME]
        self.confirm, self.status = confirm, status
        self.changed = []

    def declarations(self):
        if self.mode == "off":
            names = {"remember", "forget"}
        elif self.mode == "read-only":
            names = {d["name"] for d in TOOL_DECLS} - {"edit_file", "write_file"}
        else:
            names = {d["name"] for d in TOOL_DECLS}
        return [d for d in TOOL_DECLS if d["name"] in names]

    # ---- paths ----
    def resolve(self, raw):
        p = Path(os.path.expanduser(str(raw or "").strip() or "~"))
        if not p.is_absolute():
            p = C.HOME / p
        real = Path(os.path.realpath(p))
        if not any(real == r or r in real.parents for r in self.roots):
            raise PermissionError(f"{real} is outside the folders you may use ({', '.join(map(str, self.roots))})")
        if self.denied(real):
            raise PermissionError(f"{real} is private (keys, passwords, browser data) and stays off-limits")
        return real

    @staticmethod
    def denied(real):
        if DENY_PARTS.intersection(real.parts) or any(fnmatch.fnmatch(real.name, pat) for pat in DENY_NAMES):
            return True
        return personality.CONFIG_DIR in (real, *real.parents) and real.name == "keys"

    @staticmethod
    def short(path):
        try:
            return "~/" + str(Path(path).relative_to(C.HOME))
        except ValueError:
            return str(path)

    @staticmethod
    def read_text(path, limit=2_000_000):
        if path.stat().st_size > limit:
            raise ValueError("file is too large")
        raw = path.read_bytes()
        if b"\0" in raw[:4096]:
            raise ValueError("this is a binary file, not text")
        return raw.decode("utf-8", "replace")

    # ---- dispatcher ----
    def call(self, name, args):
        allowed = {d["name"] for d in self.declarations()}
        if name not in allowed:
            return {"error": f"tool {name} is not available"}
        try:
            return getattr(self, "t_" + name)(**{k: v for k, v in (args or {}).items()})
        except TypeError as e:
            return {"error": f"bad arguments: {e}"}
        except (OSError, ValueError, re.error) as e:
            return {"error": str(e)}

    # ---- reading ----
    def t_list_dir(self, path):
        d = self.resolve(path)
        self.status(f"looking in {self.short(d)}")
        entries = []
        for e in sorted(d.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if self.denied(e):
                continue
            try:
                entries.append({"name": e.name + ("/" if e.is_dir() else ""),
                                **({} if e.is_dir() else {"bytes": e.stat().st_size})})
            except OSError:
                pass
            if len(entries) >= 300:
                break
        return {"path": str(d), "entries": entries, "truncated": len(entries) >= 300}

    def walk(self, root):
        if root.is_file():
            yield root
            return
        for folder, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS and not self.denied(Path(folder) / x))
            for f in sorted(files):
                p = Path(folder) / f
                if not self.denied(p):
                    yield p

    def t_find_files(self, path, pattern):
        root = self.resolve(path)
        self.status(f"searching {self.short(root)} for {pattern}")
        hits, seen = [], 0
        for p in self.walk(root):
            seen += 1
            if fnmatch.fnmatch(p.name, pattern):
                hits.append(str(p))
            if len(hits) >= 200 or seen > 60_000:
                break
        return {"files": hits, "truncated": len(hits) >= 200 or seen > 60_000}

    def t_search_text(self, path, regex, name_pattern=""):
        root = self.resolve(path)
        rx = re.compile(regex)
        self.status(f"searching {self.short(root)}")
        hits, seen = [], 0
        for p in self.walk(root):
            if name_pattern and not fnmatch.fnmatch(p.name, name_pattern):
                continue
            seen += 1
            if seen > 4000:
                break
            try:
                text = self.read_text(p, 1_000_000)
            except (OSError, ValueError):
                continue
            for n, line in enumerate(text.splitlines(), 1):
                if rx.search(line):
                    hits.append({"file": str(p), "line": n, "text": line.strip()[:200]})
                    if len(hits) >= 80:
                        return {"matches": hits, "truncated": True}
        return {"matches": hits, "truncated": seen > 4000}

    def t_read_file(self, path, start_line=1, max_lines=400):
        p = self.resolve(path)
        self.status(f"reading {self.short(p)}")
        lines = self.read_text(p).splitlines()
        start = max(1, int(start_line or 1))
        out, size = [], 0
        for n in range(start, min(len(lines), start + max(1, int(max_lines or 400)) - 1) + 1):
            row = f"{n}\t{lines[n - 1]}"
            size += len(row) + 1
            if size > MAX_READ:
                break
            out.append(row)
        last = start + len(out) - 1
        return {"path": str(p), "total_lines": len(lines), "shown": f"{start}-{last}",
                "more": last < len(lines), "content": "\n".join(out)}

    # ---- changing ----
    def _apply(self, p, old, new, reason):
        if self.mode not in ("ask", "allow"):
            return {"error": "file changes are switched off"}
        if old == new:
            return {"error": "that changes nothing"}
        a, b = (old or "").splitlines(), new.splitlines()
        diff = list(difflib.unified_diff(a, b, "before", "after", lineterm="", n=2))
        plus = sum(1 for l in diff[2:] if l.startswith("+"))
        minus = sum(1 for l in diff[2:] if l.startswith("-"))
        if self.mode == "ask":
            self.status(f"waiting for your OK to change {self.short(p)}")
            ok = self.confirm({"path": self.short(p), "new": old is None, "plus": plus, "minus": minus,
                               "reason": str(reason or "")[:200], "diff": "\n".join(diff[2:])[:6000]})
            if not ok:
                return {"error": "the owner refused this change; nothing was written"}
        backup = None
        if old is not None:
            backup = BACKUPS / time.strftime("%Y%m%d-%H%M%S") / str(p).lstrip("/")
            backup.parent.mkdir(parents=True, exist_ok=True)
            backup.write_bytes(p.read_bytes())
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".amadeus-tmp")
        tmp.write_text(new, encoding="utf-8")
        if old is not None:
            os.chmod(tmp, p.stat().st_mode & 0o7777)
        os.replace(tmp, p)
        self.changed.append(self.short(p))
        self.status(f"changed {self.short(p)}")
        return {"written": str(p), "lines_added": plus, "lines_removed": minus,
                **({"backup": str(backup)} if backup else {})}

    def t_edit_file(self, path, old_text, new_text, reason=""):
        p = self.resolve(path)
        text = self.read_text(p)
        count = text.count(old_text) if old_text else 0
        if count != 1:
            return {"error": f"old_text appears {count} times in the file; it must appear exactly once. "
                             "Read the file again and copy the exact text, with more context if needed."}
        return self._apply(p, text, text.replace(old_text, new_text, 1), reason)

    def t_write_file(self, path, content, reason=""):
        p = self.resolve(path)
        if p.is_dir():
            return {"error": "that is a folder"}
        return self._apply(p, self.read_text(p) if p.exists() else None, content, reason)

    # ---- memory ----
    def t_remember(self, text):
        self.status("saving a memory")
        return self.memory.remember(text)

    def t_forget(self, id):
        return self.memory.forget(id)


# ---------------------------------------------------------------- one turn
def think(gemini, memory, tools, user_name, history_messages=24, extra=""):
    """Answer the newest user message (already in memory). Returns the raw reply text."""
    system = "\n\n".join(filter(None, [
        personality.user_personality(user_name),
        personality.emotion_rules(),
        memory.facts_prompt(),
        TOOL_RULES if tools.mode != "off" else "",
        extra,
        f"## Now\nIt is {time.strftime('%A %Y-%m-%d %H:%M')}. The owner is {user_name}; their home folder is {C.HOME}.",
    ]))
    contents = []
    for m in memory.recent(history_messages):
        if contents and contents[-1]["role"] == m["role"]:      # e.g. a message whose answer failed
            contents[-1]["parts"].append({"text": m["text"]})
        else:
            contents.append({"role": m["role"], "parts": [{"text": m["text"]}]})
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.9, "maxOutputTokens": 8192},
    }
    decls = tools.declarations()
    if decls:
        body["tools"] = [{"functionDeclarations": decls}]

    for _ in range(MAX_STEPS):
        tools.status("thinking")
        data = gemini.generate(body)
        cand = (data.get("candidates") or [{}])[0]
        content = cand.get("content") or {}
        parts = content.get("parts") or []
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
            if text:
                return text
            reason = cand.get("finishReason") or (data.get("promptFeedback") or {}).get("blockReason") or "empty"
            raise ApiError(f"the model gave no answer ({reason})")
        # keep the model's turn exactly as sent (it carries thought signatures), then answer every call
        contents.append({"role": "model", "parts": parts})
        answers = []
        for call in calls:
            result = tools.call(call.get("name", ""), call.get("args") or {})
            resp = {"name": call.get("name", ""), "response": result}
            if call.get("id"):
                resp["id"] = call["id"]
            answers.append({"functionResponse": resp})
        contents.append({"role": "user", "parts": answers})
    raise ApiError("too many steps for one message; ask again in smaller pieces")
