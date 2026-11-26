"""MeetGo's own music for stories, one or two pieces per mood: composed and synthesised here (chords, bass, a melody and
drums by mood), so they belong to nobody else. Deterministic: the same seed makes the same piece.

    python tools/make_moods.py            # writes src/backend/app/feed/music/mood_*.m4a (needs ffmpeg)
"""

from __future__ import annotations

import math
import random
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

RATE = 32000
SECONDS = 30
OUT = Path(__file__).resolve().parent.parent / "src" / "backend" / "app" / "feed" / "music"

NOTE = {n: i for i, n in enumerate(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])}
MAJOR, MINOR, DORIAN = [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7, 9, 10]

# key, slug, tempo (bpm), root, scale, chord degrees (1-based), drums, lead voice, seed
MOODS = [
    ("happy", "Sol de mañana", 118, "C", MAJOR, [1, 5, 6, 4], "pop", "pluck", 1),
    ("happy", "Paseo en bici", 126, "G", MAJOR, [1, 4, 5, 4], "pop", "bell", 2),
    ("chill", "Tarde tranquila", 84, "F", MAJOR, [1, 6, 2, 5], "soft", "pad", 3),
    ("chill", "Café y lluvia", 78, "D", DORIAN, [1, 4, 1, 5], "soft", "keys", 4),
    ("romantic", "Contigo", 72, "A", MINOR, [6, 4, 1, 5], "none", "keys", 5),
    ("epic", "La gran ruta", 96, "D", MINOR, [1, 6, 3, 7], "epic", "brass", 6),
    ("sad", "Lejos de casa", 66, "E", MINOR, [1, 6, 3, 7], "none", "pad", 7),
    ("energetic", "A tope", 140, "E", MINOR, [1, 6, 7, 1], "drive", "saw", 8),
    ("mysterious", "Niebla", 76, "B", MINOR, [1, 2, 1, 6], "soft", "bell", 9),
    ("party", "Noche de fiesta", 124, "A", MINOR, [1, 6, 3, 7], "four", "saw", 10),
    ("dreamy", "Nubes", 80, "E", MAJOR, [1, 3, 6, 4], "none", "bell", 11),
    ("summer", "Verano", 108, "F", MAJOR, [1, 5, 2, 4], "latin", "pluck", 12),
]


def freq(midi: float) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(t: float, length: float, attack: float, release: float) -> float:
    if t < attack:
        return t / attack
    if t > length - release:
        return max(0.0, (length - t) / release)
    return 1.0


def voice(kind: str, f: float, t: float) -> float:
    p = 2 * math.pi * f * t
    if kind == "pad":
        return 0.5 * math.sin(p) + 0.25 * math.sin(2 * p + 0.3) + 0.15 * math.sin(p * 1.005)
    if kind == "keys":
        return (math.sin(p) + 0.4 * math.sin(2 * p) + 0.15 * math.sin(3 * p)) * math.exp(-2.2 * t)
    if kind == "bell":
        return (math.sin(p) + 0.5 * math.sin(2.76 * p) + 0.25 * math.sin(5.4 * p)) * math.exp(-3.0 * t)
    if kind == "pluck":
        return (math.sin(p) + 0.35 * math.sin(2 * p) + 0.2 * math.sin(3 * p)) * math.exp(-5.0 * t)
    if kind == "brass":
        return sum(math.sin(k * p) / k for k in range(1, 7)) * 0.55 * min(1.0, t * 12)
    if kind == "saw":
        return sum(math.sin(k * p) / k for k in range(1, 9)) * 0.45 * math.exp(-1.2 * t)
    return math.sin(p)


def render(mood: tuple, seconds: int = SECONDS) -> list[float]:
    _, _, bpm, root, scale, degrees, drums, lead, seed = mood
    rnd = random.Random(seed)
    n = RATE * seconds
    out = [0.0] * n
    beat = 60.0 / bpm
    bar = 4 * beat
    base = 48 + NOTE[root]

    def degree(d: int, octave: int = 0) -> int:
        d -= 1
        return base + scale[d % 7] + 12 * (d // 7 + octave)

    def add(start: float, length: float, f: float, kind: str, gain: float, attack=0.01, release=0.08):
        s0 = int(start * RATE)
        for i in range(int(length * RATE)):
            j = s0 + i
            if j >= n:
                break
            t = i / RATE
            out[j] += gain * env(t, length, attack, release) * voice(kind, f, t)

    def noise(start: float, length: float, gain: float, decay: float, tone: float | None = None):
        s0 = int(start * RATE)
        for i in range(int(length * RATE)):
            j = s0 + i
            if j >= n:
                break
            t = i / RATE
            v = math.sin(2 * math.pi * tone * t * (1 - t * 3)) if tone else rnd.uniform(-1, 1)
            out[j] += gain * v * math.exp(-decay * t)

    bars = int(seconds / bar) + 1
    melody_notes = list(range(1, 9))
    for b in range(bars):
        t0 = b * bar
        d = degrees[b % len(degrees)]
        chord = [degree(d), degree(d + 2), degree(d + 4)]
        pad_kind = "pad" if lead not in ("pad",) else "keys"
        for m in chord:  # the chord, held
            add(t0, bar, freq(m + 12), pad_kind, 0.06, attack=0.25, release=0.4)
        for q in range(4):  # the bass, on the beats
            add(t0 + q * beat, beat * 0.9, freq(degree(d) - 12), "pluck" if drums != "none" else "pad", 0.16 if drums != "none" else 0.08)
        # the melody: notes of the chord and the scale, two bars repeated so it is a tune
        phrase = b % 2
        rnd2 = random.Random(seed * 100 + phrase + (b // 4) * 7)
        steps = 8 if bpm < 100 else 8
        for s in range(steps):
            if rnd2.random() < (0.35 if bpm < 90 else 0.25):
                continue
            note = degree(rnd2.choice(melody_notes) if rnd2.random() < 0.4 else rnd2.choice([d, d + 2, d + 4]), 1)
            add(t0 + s * bar / steps, bar / steps * (1.6 if lead in ("pad", "brass") else 1.0), freq(note), lead, 0.11)
        # drums
        for q in range(8):
            tq = t0 + q * beat / 2
            if drums in ("pop", "drive", "four", "latin", "epic"):
                if drums == "four" and q % 2 == 0 or drums in ("pop", "drive", "latin") and q in (0, 4) or drums == "epic" and q in (0, 3, 4):
                    noise(tq, 0.25, 0.5, 18, tone=60)
                if q in (2, 6) and drums != "epic":
                    noise(tq, 0.18, 0.22, 22)
                if drums in ("drive", "four", "latin", "pop"):
                    noise(tq + (beat / 4 if drums == "latin" else 0), 0.05, 0.06, 60)
            elif drums == "soft" and q in (0, 4):
                noise(tq, 0.2, 0.18, 20, tone=55)
    # fade in and out, and keep it below clipping
    fade = int(RATE * 1.5)
    peak = max(1e-6, max(abs(x) for x in out))
    for i in range(n):
        g = min(1.0, i / fade, (n - i) / fade)
        out[i] = out[i] / peak * 0.85 * g
    return out


def write(samples: list[float], path: Path) -> None:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32000)) for s in samples))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-c:a", "aac", "-b:a", "96k", str(path)], check=True)
        Path(tmp.name).unlink()


def slug(text: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFD", text.lower()).encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() else "_" for c in s).strip("_")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1:] or None
    for mood in MOODS:
        name = f"mood_{mood[0]}_{slug(mood[1])}.m4a"
        if only and not any(o in name for o in only):
            continue
        write(render(mood), OUT / name)
        print(name)
