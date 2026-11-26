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
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
COMMON = ROOT / "src" / "frontend" / "web_user" / "src" / "ui" / "common.tsx"
OUT = ROOT / "src" / "frontend" / "assets" / "covers"
PY = ROOT / "src" / "backend" / "app" / "board" / "cover_arts.py"
TS = ROOT / "src" / "frontend" / "web_user" / "src" / "coverArts.ts"
W, H = 1200, 630

from cover_art import PLACES, THINGS, put  # noqa: E402  (next to this script)
from cover_catalog import CATALOG, COMPOSE, colors  # noqa: E402


# Drawings only the covers use (24x24, stroked like the app's icons)
EXTRA_ICONS = {
    "sun": "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    "moon": "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    "tent": "M3 20h18M12 4 3 20M12 4l9 16M12 11l-3.5 9M12 11l3.5 9",
    "wine": "M8 3h8l-1 6a3 3 0 0 1-6 0zM12 12v8M8.5 20h7",
    "pizza": "M12 3 3 19c6 3 12 3 18 0zM9.5 13h.01M14 15.5h.01M12 9h.01",
    "burger": "M4 10a8 5 0 0 1 16 0zM4 14h16M5 17h14a1 1 0 0 1-1 2H6a1 1 0 0 1-1-2z",
    "cake": "M4 20h16v-7H4zM4 15c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 4 0M12 13V9M12 6v.01",
    "gift": "M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0",
    "heart": "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
    "map": "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
    "boat": "M3 16h18l-2 4H5zM12 3v13M12 4l6 9h-6",
    "globe": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
    "mask": "M4 5h16v6a8 8 0 0 1-16 0zM8 10h2M14 10h2M9 15c2 1.5 4 1.5 6 0",
    "popcorn": "M6 9h12l-2 12H8zM10 9l.5 12M14 9l-.5 12M6 9a3 3 0 0 1 3-4 3 3 0 0 1 6 0 3 3 0 0 1 3 4",
    "headphones": "M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z",
    "vinyl": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 12h.01M17 6.5a7 7 0 0 1 1.5 2.5",
    "disco": "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 12h16M12 4v16M6 7h12M6 17h12M12 2v2",
    "medal": "M8 3l4 6 4-6M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 13v4",
    "whistle": "M3 12a5 5 0 1 0 10 0h7V8H8M8 8V5",
    "goal": "M3 19V7h18v12M3 7l3 3h12l3-3M6 10v9M18 10v9M3 19h18",
    "helmet": "M4 15a8 8 0 0 1 16 0zM4 15h16v2H4zM12 7v8M8 9l2 6M16 9l-2 6",
    "wheel": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 3v6M12 15v6M3 12h6M15 12h6",
    "steering": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM3.5 10h6.5M14 10h6.5M12 14v7",
    "train": "M6 3h12v13H6zM6 10h12M9 16l-3 5M15 16l3 5M9 13h.01M15 13h.01",
    "suitcase": "M4 8h16v12H4zM9 8V5h6v3M4 13h16",
    "pencil": "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
    "gradcap": "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v5",
    "chef": "M7 13a4 4 0 0 1 1-8 4 4 0 0 1 8 0 4 4 0 0 1 1 8v5H7zM7 16h10",
    "pan": "M3 12h12a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM15 12h6",
    "surf": "M6 21c-2-6 5-16 13-18-1 8-7 16-13 18zM9 17l6-8",
    "kayak": "M3 15c4 2 14 2 18 0-4-2-14-2-18 0zM6 6l12 12M4 8l4-4M16 20l4-4",
    "swimmer": "M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M7 13l4-4 3 3M16 7a2 2 0 1 0 0 .01",
    "kettlebell": "M8 9a4 4 0 0 1 8 0M7 9h10l2 11H5z",
    "stopwatch": "M12 7a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 11v3M10 3h4M12 3v4",
    "pulse": "M3 12h4l2-5 4 10 2-5h6",
    "hoop": "M5 6h14M7 6l2 8h6l2-8M12 2v4M9 14l1 6M15 14l-1 6",
    "ballot": "M5 10h14v10H5zM8 10V4h8v6M10 7l1.5 1.5L14 6",
    "columns": "M3 9l9-5 9 5zM5 9v9M10 9v9M14 9v9M19 9v9M3 20h18",
    "newspaper": "M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7M7 16h5",
    "coin": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15 9a3 3 0 0 0-3-1.5c-1.7 0-3 1-3 2.2 0 3 6 1.6 6 4.6 0 1.2-1.3 2.2-3 2.2A3 3 0 0 1 9 15M12 6v1.5M12 16.5V18",
    "piggy": "M5 11a6 5 0 0 1 11-3h3v4l-2 1v3h-2v2h-2v-1.5a8 8 0 0 1-3 0V18H8v-2.5A5 5 0 0 1 5 11zM10 7h3M16 10h.01",
    "briefcase": "M3 8h18v11H3zM8 8V5h8v3M3 13h18",
    "leaf": "M5 19c0-9 6-14 15-14 0 9-5 15-14 15zM5 19l9-9",
    "fish": "M3 12c3-4 9-5 14-2l4-3v10l-4-3c-5 3-11 2-14-2zM15 11h.01",
    "dog": "M6 9l-2-4 4 2h6l4-2-2 4v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4zM10 12h.01M14 12h.01M11 15h2",
    "flame": "M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-2-3-2 2-3 4-3 7a6 6 0 0 0 6 6z",
    "rocket": "M12 15l-3-3c1-5 4-8 9-9-1 5-4 8-9 9zM9 12l-4 1-1 3 3-1M12 15l-1 4 3-1 1-3M15 7h.01",
    "lightbulb": "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
}


def icons() -> dict[str, str]:
    text = COMMON.read_text(encoding="utf-8")
    return {**dict(re.findall(r'^\s+(\w+): "([^"]+)",', text, flags=re.MULTILINE)), **EXTRA_ICONS}


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
    if kind == "night":
        stars = "".join(f'<circle cx="{rnd.randint(0, W)}" cy="{rnd.randint(0, 380)}" r="{rnd.choice((1.5, 2, 3))}" fill="#fff" opacity=".8"/>' for _ in range(40))
        return (stars + f'<circle cx="1000" cy="130" r="56" fill="#fff" opacity=".85"/><circle cx="1024" cy="114" r="52" fill="{c1}"/>'
                f'<path d="M0 500 Q300 420 600 490 T1200 470 V630 H0Z" fill="{darker}" opacity=".8"/>')
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


def scene_cover(name: str) -> str:
    """The cover: its place, then its things, each with a soft light behind so it stands out."""
    place, things = COMPOSE[name]
    rnd = random.Random(name)  # the same picture every time
    body = PLACES[place](rnd, colors(name))
    for thing, x, y, s, rot in things:
        body += f'<ellipse cx="{x}" cy="{y}" rx="{230 * s}" ry="{200 * s}" fill="#fff" opacity=".10"/>'
        body += put(THINGS[thing](), x, y, s, rot)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">{body}</svg>'


def main() -> None:
    missing = [c[0] for c in CATALOG if c[0] not in COMPOSE]
    if missing:
        raise SystemExit(f"Covers without a picture in COMPOSE: {missing}")
    names = [c[0] for c in CATALOG]
    if len(set(names)) != len(names):
        raise SystemExit("Repeated cover names")
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.svg"):
        if old.stem not in names:
            old.unlink()
    for name, *_ in CATALOG:
        (OUT / f"{name}.svg").write_text(scene_cover(name), encoding="utf-8")
    PY.write_text('"""The cover illustrations a plan or an event can take (written by tools/make_covers.py)."""\n\n'
                  f"COVER_ARTS = {tuple(names)!r}\n", encoding="utf-8")
    TS.write_text("// The gallery of cover illustrations (written by tools/make_covers.py): name, category and interests.\n"
                  "// Each one's name in every language is the translation cover_<name>.\n"
                  "export const COVER_ARTS: [string, string, string[]][] = [\n"
                  + "".join(f'  ["{n}", "{cat}", {list(tags)!r}],\n'.replace("'", '"') for n, cat, _k, _m, _a, tags, *_ in CATALOG) + "];\n"
                  'export const coverArtUrl = (name: string) => `/covers/${name}.svg`;\n', encoding="utf-8")
    print(f"{len(CATALOG)} covers in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
