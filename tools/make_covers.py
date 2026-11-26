#!/usr/bin/env python3
"""The gallery of cover illustrations for plans and events (SVG, made here, no third-party art).

Each cover is a landscape scene in MeetGo's style: a two-colour gradient sky, soft shapes of its place (mountains, sea,
city, stage, hills…), the theme's icon large in the middle and a few smaller ones around it. The icons are the app's
own (src/frontend/web_user/src/ui/common.tsx), so the covers match the rest of the interface.

    python tools/make_covers.py

writes src/frontend/assets/covers/<name>.svg (served at /covers/<name>.svg), src/backend/app/board/cover_arts.py (the
names the server accepts) and src/frontend/web_user/src/coverArts.ts (the gallery, with each cover's category).
"""

from __future__ import annotations

import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMMON = ROOT / "src" / "frontend" / "web_user" / "src" / "ui" / "common.tsx"
OUT = ROOT / "src" / "frontend" / "assets" / "covers"
PY = ROOT / "src" / "backend" / "app" / "board" / "cover_arts.py"
TS = ROOT / "src" / "frontend" / "web_user" / "src" / "coverArts.ts"
W, H = 1200, 630

# name, category (as the communities'), sky colours, scene, main icon, icons around it
COVERS = [
    ("hiking", "ui_cat_nature", ("#0ea5e9", "#22c55e"), "mountains", "mountain", ["trees", "place", "camera"]),
    ("summit", "ui_cat_nature", ("#6366f1", "#f59e0b"), "mountains", "trees", ["mountain", "clock", "place"]),
    ("beach", "ui_cat_nature", ("#06b6d4", "#fde047"), "sea", "umbrella", ["waves", "camera", "coffee"]),
    ("picnic", "ui_cat_social", ("#84cc16", "#facc15"), "hills", "basket", ["trees", "food", "users"]),
    ("travel", "ui_cat_nature", ("#3b82f6", "#a855f7"), "clouds", "plane", ["place", "camera", "calendar"]),
    ("roadtrip", "ui_cat_motor", ("#f97316", "#ec4899"), "road", "car", ["place", "music", "camera"]),
    ("motorbike", "ui_cat_motor", ("#ef4444", "#f59e0b"), "road", "moto", ["place", "mountain", "clock"]),
    ("cycling", "ui_cat_sports", ("#14b8a6", "#3b82f6"), "hills", "bike", ["mountain", "trophy", "clock"]),
    ("football", "ui_cat_sports", ("#16a34a", "#0ea5e9"), "field", "ball", ["trophy", "users", "clock"]),
    ("racket", "ui_cat_sports", ("#0ea5e9", "#84cc16"), "court", "racket", ["ball", "trophy", "users"]),
    ("fitness", "ui_cat_sports", ("#f43f5e", "#f97316"), "city", "dumbbell", ["trophy", "clock", "music"]),
    ("swimming", "ui_cat_sports", ("#0284c7", "#22d3ee"), "sea", "waves", ["trophy", "umbrella", "clock"]),
    ("tournament", "ui_cat_sports", ("#eab308", "#f97316"), "stage", "trophy", ["ball", "racket", "users"]),
    ("coffee", "ui_cat_social", ("#b45309", "#f59e0b"), "city", "coffee", ["chat", "book", "users"]),
    ("drinks", "ui_cat_social", ("#d97706", "#ef4444"), "city", "beer", ["cocktail", "music", "users"]),
    ("cocktails", "ui_cat_social", ("#db2777", "#7c3aed"), "city", "cocktail", ["music", "party", "users"]),
    ("dinner", "ui_cat_social", ("#ea580c", "#facc15"), "table", "food", ["users", "coffee", "chat"]),
    ("party", "ui_cat_social", ("#7c3aed", "#ec4899"), "stage", "party", ["music", "cocktail", "dance"]),
    ("friends", "ui_cat_social", ("#0ea5e9", "#ec4899"), "hills", "users", ["chat", "coffee", "camera"]),
    ("networking", "ui_cat_social", ("#1d4ed8", "#0ea5e9"), "city", "network", ["chat", "users", "coffee"]),
    ("cinema", "ui_cat_culture", ("#1e1b4b", "#be123c"), "stage", "film", ["ticket", "users", "clock"]),
    ("concert", "ui_cat_culture", ("#4c1d95", "#db2777"), "stage", "ticket", ["music", "guitar", "drum"]),
    ("music", "ui_cat_culture", ("#7c3aed", "#06b6d4"), "stage", "music", ["guitar", "keys", "drum"]),
    ("rock", "ui_cat_culture", ("#111827", "#dc2626"), "stage", "guitar", ["drum", "music", "ticket"]),
    ("books", "ui_cat_culture", ("#9a3412", "#f59e0b"), "table", "book", ["coffee", "chat", "users"]),
    ("photography", "ui_cat_culture", ("#0f766e", "#a3e635"), "mountains", "camera", ["mountain", "trees", "place"]),
    ("art", "ui_cat_culture", ("#e11d48", "#8b5cf6"), "table", "palette", ["camera", "users", "book"]),
    ("language", "ui_cat_education", ("#2563eb", "#22d3ee"), "city", "chat", ["book", "coffee", "plane"]),
    ("workshop", "ui_cat_education", ("#0d9488", "#2563eb"), "table", "book", ["chat", "users", "clock"]),
    ("cooking", "ui_cat_skills", ("#f97316", "#84cc16"), "table", "food", ["basket", "users", "clock"]),
    ("dance", "ui_cat_skills", ("#c026d3", "#f97316"), "stage", "dance", ["music", "party", "users"]),
    ("jam", "ui_cat_skills", ("#0891b2", "#7c3aed"), "stage", "keys", ["guitar", "drum", "music"]),
    ("debate", "ui_cat_other", ("#1e3a8a", "#dc2626"), "stage", "megaphone", ["chat", "users", "calendar"]),
    ("economy", "ui_cat_other", ("#065f46", "#0ea5e9"), "city", "chart", ["network", "chat", "calendar"]),
    ("games", "ui_cat_other", ("#4338ca", "#22c55e"), "table", "gamepad", ["users", "party", "trophy"]),
    ("pets", "ui_cat_other", ("#f59e0b", "#84cc16"), "hills", "paw", ["trees", "users", "place"]),
    ("online", "ui_cat_other", ("#0f172a", "#2563eb"), "clouds", "link", ["chat", "users", "calendar"]),
    ("celebration", "ui_cat_other", ("#f43f5e", "#facc15"), "stage", "star", ["party", "cocktail", "music"]),
]


def icons() -> dict[str, str]:
    text = COMMON.read_text(encoding="utf-8")
    return dict(re.findall(r'^\s+(\w+): "([^"]+)",', text, flags=re.MULTILINE))


def shade(hex_color: str, amount: float) -> str:
    """Darker (amount < 0) or lighter (amount > 0) version of a colour."""
    c = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    c = [round(v + (255 - v) * amount) if amount > 0 else round(v * (1 + amount)) for v in c]
    return "#" + "".join(f"{max(0, min(255, v)):02x}" for v in c)


def icon(paths: dict[str, str], name: str, cx: float, cy: float, size: float, opacity: float, width: float = 1.6) -> str:
    s = size / 24
    return (f'<g transform="translate({cx - size / 2:.1f} {cy - size / 2:.1f}) scale({s:.3f})" fill="none" stroke="#fff" '
            f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" opacity="{opacity}"><path d="{paths[name]}"/></g>')


def scene(kind: str, c1: str, c2: str, rnd: random.Random) -> str:
    dark, darker = shade(c2, -0.35), shade(c2, -0.55)
    if kind == "mountains":
        return (f'<path d="M0 470 L230 250 L380 390 L560 190 L760 420 L900 300 L1200 470 V630 H0Z" fill="{dark}" opacity=".55"/>'
                f'<path d="M560 190 L620 245 L585 240 L560 270 L530 238 L505 240Z" fill="#fff" opacity=".55"/>'
                f'<path d="M0 540 Q300 450 600 520 T1200 500 V630 H0Z" fill="{darker}" opacity=".7"/>')
    if kind == "sea":
        return (f'<circle cx="980" cy="150" r="70" fill="#fff" opacity=".35"/>'
                f'<path d="M0 450 Q150 420 300 450 T600 450 T900 450 T1200 450 V630 H0Z" fill="{dark}" opacity=".45"/>'
                f'<path d="M0 520 Q150 490 300 520 T600 520 T900 520 T1200 520 V630 H0Z" fill="{darker}" opacity=".6"/>'
                f'<path d="M0 585 Q200 560 400 585 T800 585 T1200 585 V630 H0Z" fill="#fff" opacity=".18"/>')
    if kind == "hills":
        return (f'<circle cx="1010" cy="140" r="60" fill="#fff" opacity=".3"/>'
                f'<path d="M0 470 Q260 360 520 460 T1200 430 V630 H0Z" fill="{dark}" opacity=".45"/>'
                f'<path d="M0 540 Q360 450 760 540 T1200 520 V630 H0Z" fill="{darker}" opacity=".6"/>')
    if kind == "clouds":
        clouds = "".join(f'<g fill="#fff" opacity=".22"><ellipse cx="{x}" cy="{y}" rx="90" ry="32"/><ellipse cx="{x + 50}" cy="{y - 22}" rx="60" ry="34"/></g>'
                         for x, y in ((180, 160), (900, 120), (1040, 420), (260, 470)))
        return clouds + f'<path d="M0 560 Q400 520 800 560 T1200 550 V630 H0Z" fill="{darker}" opacity=".45"/>'
    if kind == "road":
        return (f'<path d="M0 450 Q300 380 600 430 T1200 410 V630 H0Z" fill="{dark}" opacity=".5"/>'
                f'<path d="M420 630 L560 430 L640 430 L780 630Z" fill="{darker}" opacity=".75"/>'
                + "".join(f'<rect x="{596 - i * 4}" y="{450 + i * 45}" width="{8 + i * 8}" height="{14 + i * 6}" rx="3" fill="#fff" opacity=".5"/>' for i in range(4)))
    if kind == "field":
        return (f'<rect x="0" y="420" width="1200" height="210" fill="{dark}" opacity=".5"/>'
                f'<g fill="none" stroke="#fff" stroke-width="4" opacity=".35"><rect x="120" y="450" width="960" height="160"/>'
                f'<line x1="600" y1="450" x2="600" y2="610"/><circle cx="600" cy="530" r="50"/></g>')
    if kind == "court":
        return (f'<path d="M180 630 L330 420 L870 420 L1020 630Z" fill="{dark}" opacity=".55"/>'
                f'<g fill="none" stroke="#fff" stroke-width="4" opacity=".4"><path d="M180 630 L330 420 L870 420 L1020 630"/>'
                f'<line x1="255" y1="525" x2="945" y2="525"/><line x1="600" y1="420" x2="600" y2="630"/></g>')
    if kind == "city":
        out = []
        x = 0
        while x < W:
            w = rnd.choice((60, 80, 100, 120))
            h = rnd.choice((110, 150, 190, 230, 270))
            out.append(f'<rect x="{x}" y="{630 - h}" width="{w - 6}" height="{h}" fill="{darker}" opacity=".5"/>')
            for wy in range(630 - h + 18, 610, 34):
                for wx in range(x + 12, x + w - 18, 22):
                    if rnd.random() < 0.45:
                        out.append(f'<rect x="{wx}" y="{wy}" width="9" height="13" fill="#fff" opacity=".35"/>')
            x += w
        return "".join(out)
    if kind == "stage":
        return (f'<g fill="#fff" opacity=".12"><path d="M200 0 L340 0 L520 630 L80 630Z"/><path d="M860 0 L1000 0 L1120 630 L680 630Z"/></g>'
                f'<rect x="0" y="520" width="1200" height="110" fill="{darker}" opacity=".7"/>'
                + "".join(f'<circle cx="{x}" cy="{rnd.randint(540, 600)}" r="{rnd.randint(16, 26)}" fill="{shade(c1, -0.5)}" opacity=".8"/>' for x in range(40, 1200, 70)))
    if kind == "table":
        return (f'<rect x="0" y="470" width="1200" height="160" fill="{darker}" opacity=".55"/>'
                f'<rect x="0" y="470" width="1200" height="10" fill="#fff" opacity=".2"/>')
    return ""


def cover(paths: dict[str, str], name: str, c1: str, c2: str, kind: str, main: str, around: list[str]) -> str:
    rnd = random.Random(name)  # the same picture every time
    bubbles = "".join(f'<circle cx="{rnd.randint(0, W)}" cy="{rnd.randint(0, 420)}" r="{rnd.randint(40, 140)}" fill="#fff" opacity="{rnd.choice((0.05, 0.07, 0.09))}"/>'
                      for _ in range(5))
    sparkles = "".join(f'<circle cx="{rnd.randint(20, W - 20)}" cy="{rnd.randint(20, 400)}" r="{rnd.choice((2, 3, 4))}" fill="#fff" opacity=".55"/>'
                       for _ in range(18))
    spots = [(250, 200), (950, 215), (840, 400), (330, 410)]
    rnd.shuffle(spots)
    small = "".join(f'<circle cx="{x}" cy="{y}" r="54" fill="#fff" opacity=".12"/>' + icon(paths, ic, x, y, 62, 0.85, 1.7)
                    for ic, (x, y) in zip(around, spots))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
            f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>'
            f'<radialGradient id="l" cx=".5" cy=".42" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="{W}" height="{H}" fill="url(#g)"/>{bubbles}<rect width="{W}" height="{H}" fill="url(#l)"/>'
            f'{scene(kind, c1, c2, rnd)}{sparkles}{small}'
            f'<circle cx="600" cy="285" r="150" fill="#fff" opacity=".16"/><circle cx="600" cy="285" r="118" fill="#fff" opacity=".14"/>'
            f'{icon(paths, main, 600, 285, 190, 1, 1.5)}</svg>')


def main() -> None:
    paths = icons()
    missing = {ic for _, _, _, _, m, a in COVERS for ic in [m, *a] if ic not in paths}
    if missing:
        raise SystemExit(f"Icons not in common.tsx: {sorted(missing)}")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, _cat, (c1, c2), kind, main_icon, around in COVERS:
        (OUT / f"{name}.svg").write_text(cover(paths, name, c1, c2, kind, main_icon, around), encoding="utf-8")
    names = [c[0] for c in COVERS]
    PY.write_text('"""The cover illustrations a plan or an event can take (written by tools/make_covers.py)."""\n\n'
                  f"COVER_ARTS = {tuple(names)!r}\n", encoding="utf-8")
    TS.write_text("// The gallery of cover illustrations (written by tools/make_covers.py): each one's name and category.\n"
                  "export const COVER_ARTS: [string, string][] = [\n"
                  + "".join(f'  ["{n}", "{cat}"],\n' for n, cat, *_ in COVERS) + "];\n"
                  'export const coverArtUrl = (name: string) => `/covers/${name}.svg`;\n', encoding="utf-8")
    print(f"{len(COVERS)} covers in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
