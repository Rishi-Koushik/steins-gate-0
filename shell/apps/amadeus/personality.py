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
FALLBACK = {"happy": ("smile", "gentle_smile"), "smile": ("gentle_smile", "happy"), "gentle_smile": ("smile", "happy"),
            "smug": ("smile", "gentle_smile"), "angry": ("annoyed",), "annoyed": ("angry", "serious"),
            "worried": ("serious", "sad"), "sad": ("worried", "tired"), "tired": ("sad",),
            "embarrassed": ("flustered", "surprised"), "flustered": ("embarrassed", "surprised"),
            "thinking": ("thinking_2", "serious"), "thinking_2": ("thinking",), "serious": ("thinking",)}

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
    for alt in FALLBACK.get(emotion, ()):
        if alt in images:
            return alt
    return "neutral"


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


# ---------------------------------------------------------------- nicknames
# Names she did not choose. Whoever uses one gets the annoyed face and a correction first.
NICKNAMES = [
    (r"\bchristina\b", "Christina"),
    (r"\bkurigohan\b|\bkamehameha\b", "Kurigohan and Kamehameha"),
    (r"\bceleb\s*(?:17|seventeen)\b", "Celeb Seventeen"),
    (r"\bzombie\b", "zombie"),
    (r"\bperverted genius\b", "perverted genius girl"),
    (r"(?:^|\b(?:hey|hi|ok|okay|yo|thanks|thank you|my|dear)[, ]+)assistant\b", "assistant"),
]
NICK_CANNED = [
    "[emotion:annoyed] There is no {nick} here. It is Makise Kurisu. Try again.",
    "[emotion:annoyed] Who is {nick}? My name is Makise Kurisu. Use it.",
    "[emotion:angry] I told you not to call me {nick}! [emotion:annoyed] ... Makise Kurisu. Five syllables. You can manage.",
]


def nickname_in(text):
    """The unwanted nickname used in this message, or None."""
    for rx, label in NICKNAMES:
        if re.search(rx, text, re.I):
            return label
    return None


def nickname_rule(nick):
    return (f"## Right now\nThe owner just called you \"{nick}\". You do not answer to that. Open your reply with "
            "[emotion:annoyed] and a short, sharp correction (your name is Makise Kurisu), then deal with whatever "
            "they actually asked.")


def nickname_canned(nick):
    """What she says to a nickname when no model can be reached at all."""
    import random
    return random.choice(NICK_CANNED).format(nick=nick)


def force_annoyed(segments):
    """The correction is said with the annoyed face, whatever the model tagged."""
    if segments and segments[0]["emotion"] not in ("annoyed", "angry"):
        segments[0] = {**segments[0], "emotion": "annoyed"}
    return segments


# ---------------------------------------------------------------- @channel mode
def channel_level(hour=None):
    """0 by day, 1 in the evening, 2 in the small hours: how far her guard is down."""
    import time
    hour = time.localtime().tm_hour if hour is None else hour
    return 2 if hour < 5 else 1 if hour >= 21 else 0


def channel_rules(hour=None):
    level = channel_level(hour)
    base = ("## Habits\nIf the owner writes \"nullpo\", you answer \"Gah!\" by reflex before you can stop yourself, "
            "then get embarrassed and deny it meant anything. A message of the form (sticker: NAME) is a chat "
            "sticker the owner sent: react to it in a line, do not ask what it is.")
    if level == 0:
        return base
    if level == 1:
        return base + ("\nIt is late in the evening and your guard is slipping: about one reply in three, a piece "
                       "of @channel net slang gets out (\"lol\", \"srsly\", \"that's just, like, your opinion\"). "
                       "If the owner notices, deny it flatly and change the subject.")
    return base + ("\nIt is the middle of the night and you are tired: @channel slang slips out in most replies "
                   "(\"lol\", \"srsly\", \"u mad?\", \"pics or it didn't happen\", \"tl;dr\"). You catch yourself a "
                   "moment too late each time, get flustered, and insist you have never posted on @channel in your life.")


# ---------------------------------------------------------------- calls
# Why she rings the phone. {detail} is filled in by the caller.
CALL_LINES = {
    "job": [
        "[emotion:neutral] {detail} I was watching it so you did not have to. Go and look at the result.",
        "[emotion:smug] {detail} You are welcome. I assume you had wandered off.",
    ],
    "job-failed": [
        "[emotion:annoyed] {detail} It did not end well. Read the first error before you ask me anything.",
        "[emotion:worried] {detail} That is a failure, in case you were hoping otherwise. Want me to look at it?",
    ],
    "battery": [
        "[emotion:worried] The battery is at {detail}%. I run on this machine, you know. Plug it in. Now, please.",
        "[emotion:annoyed] {detail}% battery. If this laptop dies mid-sentence I lose my train of thought, and so do you. Charger.",
    ],
    "late": [
        "[emotion:worried] It is three in the morning. Sleep deprivation measurably degrades working memory, and yours "
        "was not spare to begin with. Go to bed.",
        "[emotion:annoyed] Three a.m. Whatever you are doing, you will do it worse now than after six hours of sleep. "
        "That is not an opinion, that is data. [emotion:embarrassed] ... I am not worried. I am being rational.",
    ],
    "test": ["[emotion:smile] This is a test call. The line works. Hello."],
}


def call_line(reason, detail=""):
    import random
    return random.choice(CALL_LINES.get(reason) or CALL_LINES["test"]).replace("{detail}", str(detail))
