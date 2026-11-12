"""The phone's inbox and the characters who write to it.

One mail per file under ~/.local/share/sg-shell/mail/inbox/ID.json, so the shell extension
(notifications, D-Mails, Upa) and the phone can both add mail without rewriting each other's data.

  {"id", "from", "subject", "body", "kind", "ts", "read",
   "replies": [{"key": word in the body, "say": what you answer, "answer": their next mail}],
   "replied": index of the reply that was sent}
"""
import json
import os
import random
import re
import time

import sg_common as C

INBOX = C.DATA_DIR / "mail" / "inbox"
STATE = C.DATA_DIR / "mail" / "state.json"
CHARACTERS = C.APP_DIR / "phone" / "characters.json"
KEEP = 150


def _write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _read(path):
    try:
        v = json.loads(path.read_text(encoding="utf-8"))
        return v if isinstance(v, dict) else None
    except (OSError, ValueError):
        return None


def _path(mail_id):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", str(mail_id or "")):
        return None
    return INBOX / f"{mail_id}.json"


def send(sender, subject, body, kind="mail", replies=None, ts=None):
    mail_id = f"{int(time.time() * 1000)}-{random.randrange(36 ** 4):x}"
    mail = {"id": mail_id, "from": str(sender)[:80], "subject": " ".join(str(subject).split())[:160],
            "body": str(body)[:4000], "kind": kind, "ts": int(ts or time.time()), "read": False}
    if replies:
        mail["replies"] = replies
    _write(INBOX / f"{mail_id}.json", mail)
    return mail_id


def listing():
    """Newest first, without bodies. Old mail beyond KEEP is dropped."""
    mails = []
    for f in INBOX.glob("*.json"):
        m = _read(f)
        if m:
            m["id"] = f.stem
            mails.append(m)
    mails.sort(key=lambda m: (m.get("ts", 0), m["id"]), reverse=True)
    for m in mails[KEEP:]:
        try:
            (INBOX / f"{m['id']}.json").unlink()
        except OSError:
            pass
    return [{"id": m["id"], "from": m.get("from", ""), "subject": m.get("subject", ""),
             "ts": m.get("ts", 0), "read": bool(m.get("read")), "kind": m.get("kind", "mail")}
            for m in mails[:KEEP]]


def unread():
    return sum(1 for m in listing() if not m["read"])


def load(mail_id, mark_read=True):
    path = _path(mail_id)
    m = _read(path) if path else None
    if not m:
        return {"error": "mail not found"}
    m["id"] = path.stem
    if mark_read and not m.get("read"):
        m["read"] = True
        _write(path, m)
    return m


def delete(mail_id):
    path = _path(mail_id)
    if path:
        try:
            path.unlink()
        except OSError:
            pass
    return {}


def reply(mail_id, index):
    """Record a Phone Trigger reply. Returns the mail, plus the sender's answer to deliver later."""
    path = _path(mail_id)
    m = _read(path) if path else None
    if not m:
        return {"error": "mail not found"}
    replies = m.get("replies") or []
    if m.get("replied") is not None or not isinstance(index, int) or not 0 <= index < len(replies):
        return {"error": "nothing to reply to"}
    m["replied"] = index
    _write(path, m)
    m["id"] = path.stem
    answer = replies[index].get("answer")
    return {"mail": m, "answer": {"from": m.get("from", ""), "subject": "Re: " + m.get("subject", ""),
                                  "body": answer} if answer else None}


# ---------------------------------------------------------------- characters
def _state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def event(name, detail="", cfg=None):
    """A contact reacts to something that happened (login, a failed build, low battery …)."""
    cfg = C.load_config() if cfg is None else cfg
    if C.cfg_get(cfg, "phone", "character_mails", True) is False:
        return None
    try:
        spec = json.loads(CHARACTERS.read_text(encoding="utf-8")).get(name)
    except (OSError, ValueError):
        spec = None
    if not spec or not spec.get("mails"):
        return None
    sender = spec["from"]
    # only people who are in the contact list write
    contacts = [re.sub(r"<[^>]+>|\+?\d[\d ]{6,}", "", str(c)).strip().lower()
                for c in C.cfg_get(cfg, "phone", "contacts", [])]
    if sender.lower() not in contacts:
        return None
    state, now = _state(), time.time()
    if now - state.get(name, 0) < spec.get("cooldown", 0):
        return None
    state[name] = now
    _write(STATE, state)
    mail = random.choice(spec["mails"])
    fill = lambda t: str(t).replace("{detail}", str(detail)[:120])
    replies = [{k: fill(v) for k, v in r.items()} for r in mail.get("replies", [])]
    return send(sender, fill(mail["subject"]), fill(mail["body"]), kind="chara", replies=replies)
