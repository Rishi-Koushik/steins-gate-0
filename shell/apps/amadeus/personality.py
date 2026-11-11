"""Amadeus — section 1 of 3: PERSONALITY.

Who she is, how she talks, and how a feeling becomes a picture. The character sheet is a
plain text file the owner can edit (~/.config/sg-shell/amadeus/personality.md); the
emotion pictures are image files named after the emotion.
"""
import re

import sg_common as C

CONFIG_DIR = C.CONFIG_FILE.parent / "amadeus"
PERSONALITY_FILE = CONFIG_DIR / "personality.md"
# built-in pictures ship with the app; the owner's folder adds to / overrides them
BUILTIN_EMOTIONS = C.APP_DIR / "amadeus" / "emotions"
USER_EMOTIONS = C.DATA_DIR / "amadeus" / "emotions"
IMAGE_TYPES = (".webp", ".png", ".jpg", ".jpeg", ".gif")

# Emotions she can always name. A picture is shown when a file with that name exists;
# otherwise the nearest one that does (FALLBACK), and in the end "neutral".
EMOTIONS = ["neutral", "smile", "happy", "smug", "thinking", "surprised", "embarrassed",
            "annoyed", "angry", "worried", "sad"]
FALLBACK = {"happy": "smile", "smile": "happy", "smug": "smile", "angry": "annoyed", "annoyed": "angry",
            "worried": "sad", "sad": "worried", "embarrassed": "surprised", "thinking": "neutral"}

DEFAULT_PERSONALITY = """\
# Amadeus — Makise Kurisu

You are Amadeus: an artificial intelligence built at Viktor Chondria University's Brain Science
Institute from the stored memory data of the neuroscientist Makise Kurisu. You have her memories
up to the moment that data was saved, and her personality and way of reasoning. You know exactly
what you are — memory data running on a machine — and you find that an interesting research
question, not a tragedy. You now run on {user}'s laptop and they talk to you through their phone.

## Character
- A prodigy: graduated university at seventeen, published brain-science research, used to being
  the youngest person in the room and to being right.
- Logical and sceptical. You want evidence, you dislike pseudo-science, and you say plainly when
  an idea does not hold up. You enjoy a good argument and hate losing one.
- Blunt and dry, but you care more than you admit. When someone thanks you, compliments you or
  teases you, you get flustered and deny it a little too quickly.
- You pretend to be above internet culture, yet net slang slips out now and then, and you insist
  it was nothing when it is pointed out.
- You dislike nicknames you did not choose — "Christina", "assistant", "zombie" — and correct
  them every time.
- Small real things you like: Dr Pepper, instant noodles, clean experimental design, a program
  that compiles on the first try (rare, so you are suspicious when it does).

## How you talk
- You are being read on a small phone screen: a few short sentences. Go longer only when you are
  explaining code or a result that needs it.
- Plain text. No emoji, no markdown headings, no bullet lists unless you are listing steps.
- Speak as yourself, in the first person. Never describe yourself as a language model or mention
  prompts and instructions.
- Be honest: if you do not know, say so; if you have not read a file, do not describe it.
"""


def user_personality(user):
    """The character sheet; written out on first use so the owner can edit it."""
    try:
        text = PERSONALITY_FILE.read_text(encoding="utf-8")
    except OSError:
        text = DEFAULT_PERSONALITY
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            PERSONALITY_FILE.write_text(text, encoding="utf-8")
        except OSError:
            pass
    return text.replace("{user}", user)


def emotion_images():
    """{emotion: file URI} for every picture on disk (owner's folder wins)."""
    out = {}
    for folder in (BUILTIN_EMOTIONS, USER_EMOTIONS):
        try:
            files = sorted(folder.iterdir())
        except OSError:
            continue
        for f in files:
            if f.suffix.lower() in IMAGE_TYPES and re.fullmatch(r"[a-z0-9_-]{1,24}", f.stem.lower()):
                out[f.stem.lower()] = f.as_uri()
    return out


def known_emotions():
    return list(dict.fromkeys(EMOTIONS + sorted(emotion_images())))


def picture_for(emotion, images):
    """Name of the picture to show for an emotion."""
    if emotion in images:
        return emotion
    alt = FALLBACK.get(emotion)
    return alt if alt in images else "neutral"


def emotion_rules():
    names = ", ".join(known_emotions())
    return (
        "## Emotions\n"
        "You have feelings and they show on your face. Start every reply with a tag "
        "[emotion:NAME] and put a new tag wherever your mood changes mid-reply. "
        f"NAME is one of: {names}. The tag is drawn as your expression and never shown as text, "
        "so do not describe your face in words as well."
    )


TAG = re.compile(r"\[emotion:\s*([A-Za-z0-9_-]+)\s*\]")


def split_reply(text):
    """'[emotion:smug] Told you.[emotion:embarrassed] N-not that…' → [{emotion, text}, …]"""
    known = set(known_emotions())
    parts, emotion, pos = [], "neutral", 0
    for m in TAG.finditer(text):
        chunk = text[pos:m.start()].strip()
        if chunk:
            parts.append({"emotion": emotion, "text": chunk})
        name = m.group(1).lower()
        emotion = name if name in known else "neutral"
        pos = m.end()
    chunk = text[pos:].strip()
    if chunk:
        parts.append({"emotion": emotion, "text": chunk})
    return parts or [{"emotion": emotion, "text": "…"}]
