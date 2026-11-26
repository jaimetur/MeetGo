"""The music library of stories: an excerpt of 45 seconds of each famous work, from free recordings (public domain or
Creative Commons, chosen and checked on Wikimedia Commons), plus MeetGo's own music by mood (tools/make_moods.py).
Writes src/backend/app/feed/music/*.m4a and catalog.json (title, composer, performer, licence and source of each).

    python tools/make_music_library.py <folder with the downloaded recordings> <picked.json> [<more picked.json>…]

Each picked entry has kind "classic" (famous works, the default) or "popular" (well-known songs with lyrics).
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "backend" / "app" / "feed" / "music"
SECONDS = 45
# where the best-known part starts, in seconds (negative: from the end); the start of the recording otherwise
START = {"william_tell": -200, "new_world": -660, "blue_danube": 32, "mountain_king": 70, "toccata": 0, "beethoven_5": 0,
         "sugar_plum": 0, "swan_lake": 0, "canon": 20, "morning": 0, "habanera": 8, "hallelujah": 0, "ode_to_joy": 0}
sys.path.insert(0, str(Path(__file__).resolve().parent))
from make_moods import MOODS, slug  # noqa: E402


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout.strip()
    return float(out or 0)


def clean_performer(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    text = re.sub(r"(Composition|Original composition|Performance|Performer Pages|Conducted by)\s*:?\s*", "", text, flags=re.I)
    return text[:120]


def main(sources: Path, picked: list[Path]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = []
    entries = [p for f in picked for p in json.loads(f.read_text(encoding="utf-8"))]
    for p in sorted(entries, key=lambda e: e.get("kind", "classic") != "popular"):  # the popular songs first
        kind = p.get("kind", "classic")
        src = sources / f'{p["key"]}.{p["file"].rsplit(".", 1)[-1].lower()}'
        if not src.exists():
            print("falta", p["key"])
            continue
        total = duration(src)
        start = START.get(p["key"], 0)
        start = max(0, total + start if start < 0 else start)
        if start + SECONDS > total:
            start = max(0, total - SECONDS)
        name = f"{kind}_{p['key']}.m4a"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", str(SECONDS), "-i", str(src), "-vn", "-ac", "2",
                        "-af", f"afade=t=in:d=1.5,afade=t=out:st={SECONDS - 2.5}:d=2.5,loudnorm=I=-16:TP=-1.5",
                        "-c:a", "aac", "-b:a", "112k", str(OUT / name)], check=True)
        catalog.append({"key": f"{kind}_{p['key']}", "kind": kind, "title": p["title"], "artist": p["composer"],
                        "performer": clean_performer(p.get("performer", "")), "file": name, "duration": int(duration(OUT / name)),
                        "license": p["license"], "license_url": p.get("license_url") or None, "source_url": p.get("page")})
        print(name, f"{int(start)}s", p["license"])
    for mood in MOODS:
        name = f"mood_{mood[0]}_{slug(mood[1])}.m4a"
        if (OUT / name).exists():
            catalog.append({"key": name[:-4], "kind": "mood", "mood": mood[0], "title": mood[1], "artist": "MeetGo", "performer": "",
                            "file": name, "duration": int(duration(OUT / name)), "license": "MeetGo",
                            "license_url": None, "source_url": None})
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(catalog), "canciones")


if __name__ == "__main__":
    main(Path(sys.argv[1]), [Path(a) for a in sys.argv[2:]])
