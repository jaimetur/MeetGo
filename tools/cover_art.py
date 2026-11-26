"""Drawings of the cover gallery: places (the background of each kind of plan) and things (the big subject in front),
flat and coloured, on a 1200x630 canvas. tools/make_covers.py puts them together following tools/cover_catalog.py.

Every function returns SVG markup. Things are drawn around (0, 0) at about 240 px and placed with `put()`.
"""

from __future__ import annotations

import math
import random

W, H = 1200, 630


def put(svg: str, x: float, y: float, s: float = 1.0, rot: float = 0) -> str:
    return f'<g transform="translate({x:.1f} {y:.1f}) rotate({rot}) scale({s:.3f})">{svg}</g>'


def shade(hex_color: str, amount: float) -> str:
    c = [int(hex_color[i:i + 2], 16) for i in (1, 3, 5)]
    c = [round(v + (255 - v) * amount) if amount > 0 else round(v * (1 + amount)) for v in c]
    return "#" + "".join(f"{max(0, min(255, v)):02x}" for v in c)


def sky(c1: str, c2: str, gid: str = "sky") -> str:
    return (f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{c1}"/>'
            f'<stop offset="1" stop-color="{c2}"/></linearGradient></defs><rect width="{W}" height="{H}" fill="url(#{gid})"/>')


def shadow(x: float, y: float, rx: float, ry: float = 18, o: float = .25) -> str:
    return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="#000" opacity="{o}"/>'


# ======================================================================================== places

def p_football(r: random.Random) -> str:
    stripes = "".join(f'<path d="M{-200 + i * 160} 630 L{420 + i * 60} 300 L{450 + i * 60} 300 L{-120 + i * 160} 630Z" fill="#fff" opacity=".05"/>' for i in range(0, 10, 2))
    return (sky("#38bdf8", "#bae6fd") + '<rect y="300" width="1200" height="330" fill="#16a34a"/>' + stripes
            + '<g fill="none" stroke="#fff" stroke-width="5" opacity=".85"><path d="M120 630 L380 300 H820 L1080 630"/>'
              '<path d="M470 300 V340 H730 V300"/><ellipse cx="600" cy="470" rx="170" ry="48"/><line x1="40" y1="470" x2="1160" y2="470"/></g>'
            + '<g stroke="#fff" stroke-width="7" fill="none"><path d="M520 300 V245 H680 V300"/></g>'
            + '<g stroke="#fff" stroke-width="1.5" opacity=".6">' + "".join(f'<line x1="{520 + i * 16}" y1="245" x2="{520 + i * 16}" y2="300"/>' for i in range(11))
            + "".join(f'<line x1="520" y1="{250 + i * 10}" x2="680" y2="{250 + i * 10}"/>' for i in range(6)) + '</g>'
            + '<g fill="#0f172a" opacity=".55">' + "".join(f'<rect x="{i * 40}" y="{250 + (i % 3) * 8}" width="34" height="50" rx="10"/>' for i in range(0, 12)) + "".join(f'<rect x="{760 + i * 40}" y="{250 + (i % 3) * 8}" width="34" height="50" rx="10"/>' for i in range(0, 12)) + '</g>')


def p_court(floor: str, line: str, r: random.Random, net: bool = True, walls: bool = False) -> str:
    out = sky("#1e3a8a", "#3b82f6") + f'<rect y="250" width="1200" height="380" fill="{shade(floor, -0.25)}"/>'
    out += f'<path d="M150 630 L360 280 H840 L1050 630Z" fill="{floor}"/>'
    out += f'<g fill="none" stroke="{line}" stroke-width="5"><path d="M150 630 L360 280 H840 L1050 630"/><path d="M270 630 L420 330 H780 L930 630"/>' \
           f'<line x1="600" y1="330" x2="600" y2="630"/><line x1="245" y1="520" x2="955" y2="520"/></g>'
    if walls:
        out += '<g fill="#bae6fd" opacity=".25" stroke="#e0f2fe" stroke-width="3"><path d="M150 630 L360 280 V170 L150 470Z"/><path d="M1050 630 L840 280 V170 L1050 470Z"/><rect x="360" y="170" width="480" height="110"/></g>'
    if net:
        out += '<rect x="200" y="420" width="800" height="8" fill="#f8fafc"/><g stroke="#0f172a" stroke-width="2" opacity=".55">' + "".join(
            f'<line x1="{205 + i * 20}" y1="428" x2="{205 + i * 20}" y2="470"/>' for i in range(40)) + "".join(
            f'<line x1="200" y1="{432 + i * 9}" x2="1000" y2="{432 + i * 9}"/>' for i in range(5)) + '</g><rect x="195" y="420" width="10" height="80" fill="#e5e7eb"/><rect x="995" y="420" width="10" height="80" fill="#e5e7eb"/>'
    return out


def p_basket(r: random.Random) -> str:
    planks = "".join(f'<rect x="0" y="{340 + i * 30}" width="1200" height="2" fill="#92400e" opacity=".35"/>' for i in range(10))
    return (sky("#1e293b", "#475569") + '<rect y="330" width="1200" height="300" fill="#d97706"/>' + planks
            + '<path d="M420 630 L480 380 H720 L780 630Z" fill="#b91c1c" opacity=".55"/>'
            + '<g fill="none" stroke="#fff" stroke-width="5"><path d="M420 630 L480 380 H720 L780 630"/><ellipse cx="600" cy="380" rx="120" ry="35"/></g>'
            + '<rect x="590" y="90" width="20" height="290" fill="#334155"/>')


def p_hoop() -> str:
    return ('<rect x="-110" y="-150" width="220" height="140" rx="6" fill="#f8fafc" stroke="#ef4444" stroke-width="6"/>'
            '<rect x="-40" y="-110" width="80" height="60" fill="none" stroke="#ef4444" stroke-width="5"/>'
            '<ellipse cx="0" cy="-10" rx="56" ry="12" fill="none" stroke="#f97316" stroke-width="8"/>'
            '<path d="M-52 -6 L-34 60 M-26 -4 L-14 62 M0 -2 V62 M26 -4 L14 62 M52 -6 L34 60 M-40 25 H40 M-34 50 H34" stroke="#f8fafc" stroke-width="3" fill="none"/>')


def p_pool(r: random.Random) -> str:
    out = sky("#0ea5e9", "#7dd3fc") + '<rect y="230" width="1200" height="400" fill="#0284c7"/>'
    out += '<rect y="200" width="1200" height="40" fill="#e0f2fe"/>'
    for i in range(6):
        y = 270 + i * 62
        out += f'<g>' + "".join(f'<circle cx="{x}" cy="{y}" r="6" fill="{"#ef4444" if (x // 24) % 2 else "#facc15"}"/>' for x in range(0, 1200, 24)) + '</g>'
    out += "".join(f'<path d="M{x} {y} q30 -10 60 0 t60 0" stroke="#fff" stroke-width="3" fill="none" opacity=".35"/>' for x, y in ((100, 330), (700, 400), (300, 520), (900, 560), (500, 300)))
    return out


def p_track(r: random.Random) -> str:
    out = sky("#38bdf8", "#e0f2fe") + '<rect y="300" width="1200" height="330" fill="#16a34a"/>'
    out += '<path d="M0 420 Q600 280 1200 420 V630 H0Z" fill="#dc2626"/>'
    out += "".join(f'<path d="M0 {440 + i * 40} Q600 {300 + i * 40} 1200 {440 + i * 40}" stroke="#fff" stroke-width="3" fill="none" opacity=".8"/>' for i in range(5))
    out += '<g fill="#fff" font-family="Arial" font-weight="700" font-size="30" opacity=".85"><text x="140" y="470">1</text><text x="140" y="510">2</text><text x="140" y="550">3</text><text x="140" y="590">4</text></g>'
    return out


def p_gym(r: random.Random) -> str:
    out = sky("#64748b", "#94a3b8") + '<rect y="420" width="1200" height="210" fill="#334155"/>'
    out += "".join(f'<rect x="{x}" y="420" width="96" height="210" fill="#475569" stroke="#1e293b" stroke-width="3"/>' for x in range(0, 1200, 100))
    out += '<rect x="80" y="100" width="1040" height="240" rx="8" fill="#e2e8f0" opacity=".55"/><rect x="100" y="120" width="1000" height="200" fill="#bae6fd" opacity=".35"/>'
    out += '<g fill="#64748b"><rect x="120" y="360" width="200" height="12"/><rect x="880" y="360" width="200" height="12"/></g>'
    return out


def p_mountains(c1: str, c2: str, r: random.Random, snow: bool = True, sun: bool = True) -> str:
    out = sky(c1, c2)
    out += '<circle cx="960" cy="140" r="56" fill="#fef3c7" opacity=".9"/>' if sun else ""
    out += f'<path d="M0 420 L180 230 L320 360 L520 150 L700 380 L880 220 L1200 430 V630 H0Z" fill="{shade(c2, -0.45)}"/>'
    if snow:
        out += '<path d="M520 150 L575 210 L548 205 L520 230 L495 205 L470 210Z M180 230 L220 272 L196 268 L176 284 L160 268 L144 272Z M880 220 L930 262 L904 258 L884 276 L866 258 L842 264Z" fill="#fff"/>'
    out += f'<path d="M0 500 Q300 400 600 470 T1200 450 V630 H0Z" fill="{shade(c2, -0.6)}"/>'
    out += "".join(pine(x, y, s, shade(c2, -0.7)) for x, y, s in ((90, 520, 1), (160, 540, .8), (1040, 520, 1.1), (1120, 545, .8), (980, 550, .7)))
    return out


def pine(x: float, y: float, s: float, color: str) -> str:
    return (f'<g transform="translate({x} {y}) scale({s})"><rect x="-6" y="0" width="12" height="24" fill="#3f2a14"/>'
            f'<path d="M0 -110 L40 -40 H20 L52 10 H-52 L-20 -40 H-40Z" fill="{color}"/></g>')


def p_forest(r: random.Random) -> str:
    out = sky("#a7f3d0", "#bbf7d0") + '<path d="M0 360 Q600 300 1200 360 V630 H0Z" fill="#4ade80"/>'
    for row, (y, s, col) in enumerate(((330, .8, "#15803d"), (420, 1.1, "#166534"), (540, 1.5, "#14532d"))):
        out += "".join(pine(x + r.randint(-20, 20), y, s, col) for x in range(-20, 1240, int(140 * s)) if not (400 < x < 800 and row == 2))
    out += '<path d="M520 630 Q560 500 600 420 Q640 500 680 630Z" fill="#a16207" opacity=".6"/>'
    return out


def p_night(r: random.Random, c2: str = "#312e81") -> str:
    out = sky("#020617", c2) + "".join(f'<circle cx="{r.randint(0, W)}" cy="{r.randint(0, 380)}" r="{r.choice((1.2, 1.8, 2.5))}" fill="#fff" opacity="{r.choice((.5, .8, 1))}"/>' for _ in range(90))
    out += '<circle cx="980" cy="120" r="48" fill="#fef9c3"/><circle cx="1002" cy="104" r="44" fill="#020617" opacity=".0"/>'
    out += '<path d="M0 470 L200 330 L360 440 L560 300 L760 460 L940 340 L1200 470 V630 H0Z" fill="#0b1026"/>'
    out += '<path d="M0 540 Q400 480 800 540 T1200 530 V630 H0Z" fill="#05081a"/>'
    return out


def p_beach(r: random.Random, sunset: bool = False, sun: bool = True) -> str:
    out = sky("#f97316", "#fde68a") if sunset else sky("#38bdf8", "#e0f2fe")
    out += f'<circle cx="{900 if not sunset else 600}" cy="{130 if not sunset else 330}" r="{60 if not sunset else 90}" fill="{"#fef08a" if not sunset else "#fde047"}"/>' if sun else ""
    out += f'<rect y="320" width="1200" height="120" fill="{"#0369a1" if not sunset else "#9a3412"}"/>'
    out += "".join(f'<path d="M{x} {y} q25 -8 50 0 t50 0" stroke="#fff" stroke-width="3" fill="none" opacity=".5"/>' for x, y in ((80, 360), (420, 345), (760, 380), (1000, 350), (250, 400)))
    out += '<path d="M0 430 Q300 400 600 425 T1200 420 V630 H0Z" fill="#fcd34d"/><path d="M0 438 Q300 410 600 435 T1200 430" stroke="#fff" stroke-width="6" fill="none" opacity=".7"/>'
    return out


def p_underwater(r: random.Random) -> str:
    out = sky("#0e7490", "#082f49") + "".join(f'<path d="M{x} 0 L{x + 60} 0 L{x + 160} 630 L{x + 40} 630Z" fill="#fff" opacity=".04"/>' for x in range(0, 1200, 220))
    out += '<path d="M0 560 Q300 520 600 560 T1200 550 V630 H0Z" fill="#fcd34d" opacity=".7"/>'
    out += "".join(f'<path d="M{x} 600 q-20 -80 0 -140 q20 60 0 140" fill="{c}"/>' for x, c in ((120, "#f472b6"), (180, "#fb923c"), (1050, "#a78bfa"), (1100, "#f472b6")))
    out += "".join(f'<circle cx="{r.randint(0, W)}" cy="{r.randint(0, 500)}" r="{r.randint(4, 12)}" fill="none" stroke="#fff" stroke-width="2" opacity=".4"/>' for _ in range(25))
    return out


def p_sea(r: random.Random, c1: str = "#38bdf8", c2: str = "#bae6fd", sun: bool = True) -> str:
    out = sky(c1, c2) + ('<circle cx="980" cy="140" r="50" fill="#fef9c3"/>' if sun else "")
    for i, col in enumerate(("#0ea5e9", "#0284c7", "#0369a1", "#075985")):
        y = 340 + i * 70
        out += f'<path d="M0 {y} Q150 {y - 25} 300 {y} T600 {y} T900 {y} T1200 {y} V630 H0Z" fill="{col}"/>'
    return out


def p_road(r: random.Random, c1: str, c2: str) -> str:
    out = sky(c1, c2) + f'<path d="M0 380 L220 260 L420 360 L640 230 L860 350 L1200 280 V630 H0Z" fill="{shade(c2, -0.4)}"/>'
    out += f'<rect y="380" width="1200" height="250" fill="{shade(c2, -0.55)}"/>'
    out += '<path d="M440 630 Q520 470 590 380 L612 380 Q620 470 760 630Z" fill="#334155"/>'
    out += "".join(f'<rect x="{600 - i * 2}" y="{400 + i * 45}" width="{6 + i * 4}" height="{18 + i * 6}" fill="#facc15"/>' for i in range(5))
    return out


def p_circuit(r: random.Random) -> str:
    out = sky("#94a3b8", "#e2e8f0") + '<rect y="300" width="1200" height="330" fill="#22c55e"/>'
    out += '<path d="M0 420 Q600 330 1200 420 V560 Q600 470 0 560Z" fill="#374151"/>'
    out += "".join(f'<path d="M{x} {420 - math.sin(x / 1200 * math.pi) * 90} l40 0 l0 12 l-40 0z" fill="{"#ef4444" if i % 2 else "#fff"}"/>' for i, x in enumerate(range(0, 1200, 40)))
    out += '<g transform="translate(980 240)"><rect x="0" y="0" width="8" height="120" fill="#e5e7eb"/>' + "".join(
        f'<rect x="{8 + (i % 4) * 22}" y="{(i // 4) * 22}" width="22" height="22" fill="{"#111" if (i + i // 4) % 2 else "#fff"}"/>' for i in range(12)) + '</g>'
    return out


def p_city(r: random.Random, c1: str, c2: str, night: bool = False) -> str:
    out = sky(c1, c2) + ("" if not night else "".join(f'<circle cx="{r.randint(0, W)}" cy="{r.randint(0, 250)}" r="1.6" fill="#fff" opacity=".7"/>' for _ in range(50)))
    for layer, (base, col, op) in enumerate(((330, shade(c2, -0.3), .6), (420, shade(c2, -0.55), .9))):
        x = 0
        while x < W:
            w, h = r.choice((70, 90, 120, 150)), r.randint(120, 260) - layer * 60
            out += f'<rect x="{x}" y="{base - h + 200}" width="{w - 8}" height="{h + 300}" fill="{col}" opacity="{op}"/>'
            for wy in range(base - h + 220, 630, 30):
                for wx in range(x + 12, x + w - 20, 22):
                    if r.random() < .5:
                        out += f'<rect x="{wx}" y="{wy}" width="10" height="14" fill="{"#fde68a" if night or r.random() < .3 else "#fff"}" opacity="{.8 if night else .35}"/>'
            x += w
    out += '<rect y="580" width="1200" height="50" fill="#1f2937"/>'
    return out


def p_room(wall: str, floor: str, r: random.Random) -> str:
    return (f'<rect width="{W}" height="{H}" fill="{wall}"/><rect y="440" width="1200" height="190" fill="{floor}"/>'
            f'<rect y="436" width="1200" height="8" fill="{shade(floor, -0.3)}"/>')


def p_cafe(r: random.Random) -> str:
    out = p_room("#7c2d12", "#451a03", r) + '<rect x="0" y="0" width="1200" height="60" fill="#431407"/>'
    out += "".join(f'<g><line x1="{x}" y1="0" x2="{x}" y2="90" stroke="#1c1917" stroke-width="3"/><path d="M{x - 30} 120 Q{x} 70 {x + 30} 120Z" fill="#fbbf24"/><circle cx="{x}" cy="125" r="10" fill="#fef3c7"/></g>' for x in (200, 600, 1000))
    out += '<rect x="60" y="200" width="300" height="140" rx="8" fill="#292524"/><g fill="#fef3c7" font-family="Arial" font-size="22" opacity=".85"><text x="90" y="245">CAFÉ</text><text x="90" y="280">TÉ · BRUNCH</text><text x="90" y="315">€ 1.50</text></g>'
    out += '<rect x="0" y="380" width="1200" height="70" fill="#a16207"/><rect x="0" y="370" width="1200" height="14" fill="#ca8a04"/>'
    return out


def p_bar(r: random.Random) -> str:
    out = p_room("#1c1917", "#292524", r)
    for y in (110, 200, 290):
        out += f'<rect x="60" y="{y}" width="1080" height="8" fill="#78350f"/>'
        out += "".join(f'<rect x="{x}" y="{y - 60}" width="22" height="60" rx="6" fill="{r.choice(("#16a34a", "#b45309", "#7c3aed", "#0ea5e9", "#dc2626"))}" opacity=".85"/>' for x in range(80, 1120, 46) if r.random() < .8)
    out += '<rect x="0" y="380" width="1200" height="70" fill="#78350f"/><rect x="0" y="370" width="1200" height="14" fill="#a16207"/>'
    out += "".join(f'<circle cx="{x}" cy="40" r="14" fill="#fbbf24" opacity=".8"/>' for x in range(100, 1200, 200))
    return out


def p_table(r: random.Random, cloth: str = "#fef3c7") -> str:
    out = p_room("#7f1d1d", "#450a0a", r)
    out += "".join(f'<circle cx="{x}" cy="{y}" r="4" fill="#fde68a" opacity=".8"/>' for x, y in zip(range(40, 1200, 60), [40 + (i % 3) * 10 for i in range(20)]))
    out += f'<path d="M0 360 H1200 V630 H0Z" fill="{cloth}"/><path d="M0 360 H1200 V380 H0Z" fill="{shade(cloth, -0.15)}"/>'
    for x in (180, 1020):
        out += f'<circle cx="{x}" cy="470" r="70" fill="#fff"/><circle cx="{x}" cy="470" r="50" fill="#f1f5f9"/>'
    out += '<g><rect x="355" y="300" width="14" height="70" fill="#fef3c7"/><path d="M362 280 q8 12 0 20 q-8 -8 0 -20" fill="#f59e0b"/><rect x="831" y="300" width="14" height="70" fill="#fef3c7"/><path d="M838 280 q8 12 0 20 q-8 -8 0 -20" fill="#f59e0b"/></g>'
    return out


def p_kitchen(r: random.Random) -> str:
    out = '<rect width="1200" height="630" fill="#0f766e"/>' + "".join(
        f'<rect x="{x}" y="{y}" width="58" height="38" fill="#14b8a6" stroke="#0f766e" stroke-width="2"/>' for x in range(0, 1200, 60) for y in range(0, 360, 40))
    out += '<rect y="360" width="1200" height="270" fill="#475569"/><rect y="350" width="1200" height="20" fill="#cbd5e1"/>'
    out += "".join(f'<g><line x1="{x}" y1="40" x2="{x}" y2="120" stroke="#64748b" stroke-width="4"/><circle cx="{x}" cy="150" r="30" fill="#94a3b8"/></g>' for x in (160, 1040))
    return out


def p_club(r: random.Random) -> str:
    out = sky("#1e1b4b", "#4c1d95")
    out += "".join(f'<path d="M{x} 0 L{x + 40} 0 L{x + 260 * d} 630 L{x - 120 * d} 630Z" fill="{c}" opacity=".18"/>' for x, d, c in ((150, 1, "#f472b6"), (500, -1, "#22d3ee"), (800, 1, "#a3e635"), (1050, -1, "#fbbf24")))
    for i in range(12):
        for j in range(4):
            out += f'<rect x="{i * 100}" y="{430 + j * 50}" width="98" height="48" fill="{r.choice(("#db2777", "#7c3aed", "#0891b2", "#ca8a04", "#4338ca"))}" opacity=".55"/>'
    out += "".join(f'<circle cx="{r.randint(0, W)}" cy="{r.randint(0, 420)}" r="3" fill="#fff" opacity=".7"/>' for _ in range(40))
    return out


def p_stage(r: random.Random, c1: str, c2: str) -> str:
    out = sky(c1, c2)
    out += "".join(f'<path d="M{x} 0 L{x + 30} 0 L{x + 200 * d} 470 L{x - 150 * d} 470Z" fill="#fff" opacity=".12"/>' for x, d in ((200, 1), (560, -1), (640, 1), (1000, -1)))
    out += '<rect y="400" width="1200" height="70" fill="#111827"/><rect y="395" width="1200" height="8" fill="#374151"/>'
    out += "".join(f'<circle cx="{x}" cy="{530 + r.randint(-15, 15)}" r="{r.randint(26, 36)}" fill="#020617"/><rect x="{x - 30}" y="{545 + r.randint(-10, 10)}" width="60" height="100" rx="26" fill="#020617"/>' for x in range(30, 1200, 64))
    out += "".join(f'<path d="M{x} {470 + r.randint(30, 60)} l-10 -60 l20 0z" fill="#020617"/>' for x in range(60, 1200, 180))
    return out


def p_cinema(r: random.Random) -> str:
    out = '<rect width="1200" height="630" fill="#1c0a0a"/><rect x="160" y="40" width="880" height="300" rx="10" fill="#e0e7ff"/>'
    out += '<rect x="160" y="40" width="880" height="300" rx="10" fill="url(#scr)"/><defs><linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#93c5fd"/><stop offset="1" stop-color="#f0abfc"/></linearGradient></defs>'
    out += '<path d="M0 0 H160 V630 H0Z M1040 0 H1200 V630 H1040Z" fill="#7f1d1d"/>' + "".join(f'<line x1="{x}" y1="0" x2="{x}" y2="630" stroke="#450a0a" stroke-width="6"/>' for x in (40, 90, 130, 1070, 1110, 1160))
    for row, y in enumerate((440, 520, 600)):
        out += "".join(f'<path d="M{x} {y} q0 -40 30 -40 h40 q30 0 30 40 v20 h-100z" fill="#991b1b"/>' for x in range(-40 + row * 30, 1240, 110))
    return out


def p_theatre(r: random.Random) -> str:
    out = '<rect width="1200" height="630" fill="#450a0a"/><rect x="0" y="380" width="1200" height="250" fill="#78350f"/>'
    out += '<path d="M0 0 H1200 V70 Q900 140 600 90 Q300 140 0 70Z" fill="#991b1b"/>'
    for side in (0, 1):
        out += "".join(f'<path d="M{(x if not side else 1200 - x)} 0 V600" stroke="#7f1d1d" stroke-width="40"/>' for x in (20, 70, 120, 170))
    out += '<ellipse cx="600" cy="400" rx="300" ry="40" fill="#fde68a" opacity=".25"/>'
    return out


def p_library(r: random.Random) -> str:
    out = '<rect width="1200" height="630" fill="#78350f"/>'
    for y in range(40, 460, 105):
        out += f'<rect x="0" y="{y + 90}" width="1200" height="14" fill="#451a03"/>'
        x = 10
        while x < 1190:
            w = r.randint(16, 30)
            h = r.randint(60, 88)
            out += f'<rect x="{x}" y="{y + 90 - h}" width="{w}" height="{h}" fill="{r.choice(("#1d4ed8", "#b91c1c", "#15803d", "#a16207", "#7c3aed", "#0f766e", "#e5e7eb"))}"/>'
            x += w + 2
    out += '<rect y="470" width="1200" height="160" fill="#a16207"/>'
    return out


def p_museum(r: random.Random) -> str:
    out = '<rect width="1200" height="630" fill="#f5f5f4"/><rect y="460" width="1200" height="170" fill="#d6d3d1"/>'
    for x, y, w, h, c in ((90, 120, 220, 170, "#f97316"), (380, 90, 260, 220, "#0ea5e9"), (720, 130, 180, 150, "#a855f7"), (960, 110, 170, 200, "#22c55e")):
        out += f'<rect x="{x - 12}" y="{y - 12}" width="{w + 24}" height="{h + 24}" fill="#a16207"/><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{c}" opacity=".85"/>'
        out += f'<circle cx="{x + w * .35}" cy="{y + h * .4}" r="{min(w, h) * .2}" fill="#fff" opacity=".5"/><path d="M{x} {y + h} L{x + w * .5} {y + h * .45} L{x + w} {y + h}Z" fill="#000" opacity=".2"/>'
    out += '<rect x="520" y="430" width="160" height="40" fill="#78716c"/>'
    return out


def p_classroom(r: random.Random) -> str:
    out = p_room("#e7e5e4", "#a8a29e", r) + '<rect x="200" y="60" width="800" height="300" rx="8" fill="#14532d" stroke="#a16207" stroke-width="16"/>'
    out += '<g fill="none" stroke="#f8fafc" stroke-width="4" opacity=".8"><path d="M260 140 h140 M260 190 h220 M260 240 h180"/><path d="M640 280 q60 -120 120 -60 t120 -40"/></g>'
    out += '<g fill="#f8fafc" font-family="Arial" font-size="40" opacity=".85"><text x="660" y="160">A b c</text></g>'
    return out


def p_park(r: random.Random, c1: str = "#7dd3fc", c2: str = "#e0f2fe") -> str:
    out = sky(c1, c2) + '<circle cx="1000" cy="120" r="55" fill="#fef08a"/>'
    out += '<path d="M0 360 Q300 300 600 350 T1200 330 V630 H0Z" fill="#86efac"/><path d="M0 440 Q400 390 800 440 T1200 430 V630 H0Z" fill="#4ade80"/>'
    out += "".join(f'<g transform="translate({x} {y})"><rect x="-8" y="-10" width="16" height="70" fill="#78350f"/><circle cx="0" cy="-40" r="{s}" fill="{c}"/><circle cx="-{s * .6}" cy="-20" r="{s * .7}" fill="{c}"/><circle cx="{s * .6}" cy="-22" r="{s * .7}" fill="{c}"/></g>'
                   for x, y, s, c in ((110, 380, 60, "#16a34a"), (260, 350, 45, "#22c55e"), (980, 370, 62, "#15803d"), (1120, 400, 48, "#16a34a")))
    return out


def p_office(r: random.Random) -> str:
    out = p_room("#e2e8f0", "#94a3b8", r) + '<rect x="80" y="60" width="380" height="250" fill="#bae6fd" stroke="#64748b" stroke-width="10"/><line x1="270" y1="60" x2="270" y2="310" stroke="#64748b" stroke-width="8"/>'
    out += '<rect x="800" y="90" width="300" height="200" rx="8" fill="#fff" stroke="#cbd5e1" stroke-width="4"/>' + "".join(f'<rect x="{830 + i * 50}" y="{250 - h}" width="34" height="{h}" fill="#3b82f6"/>' for i, h in enumerate((50, 80, 70, 120, 140)))
    out += '<rect x="0" y="380" width="1200" height="60" fill="#78350f"/>'
    return out


def p_hall(r: random.Random, c1: str = "#1e3a8a", c2: str = "#1e40af") -> str:
    """A conference or debate hall: a screen, a backdrop, seats."""
    out = sky(c1, c2) + '<rect x="250" y="50" width="700" height="260" rx="10" fill="#f8fafc"/><rect x="290" y="80" width="300" height="28" rx="6" fill="#1e3a8a"/>' + "".join(
        f'<rect x="290" y="{130 + i * 34}" width="{260 - i * 40}" height="14" rx="6" fill="#94a3b8"/>' for i in range(4)) + "".join(
        f'<rect x="{660 + i * 56}" y="{280 - h}" width="38" height="{h}" fill="{c}"/>' for i, (h, c) in enumerate(((60, "#3b82f6"), (110, "#22c55e"), (150, "#f97316"), (90, "#a855f7"))))
    out += '<rect y="400" width="1200" height="230" fill="#0b1226"/>'
    out += "".join(f'<rect x="{x}" y="{520 + (i % 2) * 40}" width="80" height="60" rx="14" fill="#1e293b"/>' for i, x in enumerate(range(0, 1200, 100)))
    return out


def p_parliament(r: random.Random) -> str:
    out = sky("#93c5fd", "#e0f2fe") + '<rect y="500" width="1200" height="130" fill="#d6d3d1"/>'
    out += '<path d="M250 230 L600 90 L950 230Z" fill="#e7e5e4" stroke="#a8a29e" stroke-width="6"/><rect x="250" y="230" width="700" height="30" fill="#d6d3d1"/>'
    out += "".join(f'<rect x="{x}" y="260" width="44" height="220" fill="#f5f5f4" stroke="#d6d3d1" stroke-width="3"/>' for x in range(280, 930, 80))
    out += '<rect x="230" y="480" width="740" height="24" fill="#a8a29e"/><rect x="200" y="504" width="800" height="24" fill="#78716c"/>'
    out += '<line x1="600" y1="90" x2="600" y2="20" stroke="#57534e" stroke-width="4"/><path d="M600 22 h60 v30 h-60z" fill="#dc2626"/><path d="M600 32 h60 v10 h-60z" fill="#facc15"/>'
    return out


def p_polling(r: random.Random) -> str:
    out = p_room("#dbeafe", "#93c5fd", r)
    for x in (80, 960):
        out += f'<rect x="{x}" y="120" width="160" height="320" fill="#1d4ed8"/><rect x="{x + 10}" y="130" width="140" height="300" fill="#60a5fa" opacity=".4"/><rect x="{x}" y="100" width="160" height="24" fill="#1e3a8a"/>'
    out += '<rect x="300" y="380" width="600" height="60" fill="#78350f"/><rect x="290" y="370" width="620" height="16" fill="#a16207"/>'
    out += '<rect x="420" y="60" width="360" height="70" rx="8" fill="#1e3a8a"/><g fill="#fff" font-family="Arial" font-weight="700" font-size="34"><text x="510" y="108">VOTO</text></g>'
    return out


def p_party(r: random.Random, c1: str = "#7c3aed", c2: str = "#ec4899") -> str:
    out = sky(c1, c2)
    out += "".join(f'<rect x="{r.randint(0, W)}" y="{r.randint(0, H)}" width="10" height="18" rx="2" fill="{r.choice(("#fde047", "#22d3ee", "#a3e635", "#fff", "#fb7185"))}" transform="rotate({r.randint(0, 90)} {r.randint(0, W)} {r.randint(0, H)})" opacity=".85"/>' for _ in range(70))
    out += '<path d="M0 30 Q150 90 300 30 T600 30 T900 30 T1200 30" stroke="#fde047" stroke-width="4" fill="none"/>' + "".join(
        f'<path d="M{x} {30 + 30 * math.sin(x / 300 * math.pi * 2) * 0} l14 34 l14 -34z" fill="{c}"/>' for x, c in zip(range(20, 1200, 60), ["#f43f5e", "#22d3ee", "#a3e635", "#fde047"] * 6))
    return out


def p_balloons(r: random.Random) -> str:
    out = ""
    for x, y, c in ((120, 200, "#f43f5e"), (210, 150, "#facc15"), (1000, 170, "#22d3ee"), (1090, 220, "#a855f7"), (60, 300, "#22c55e"), (1140, 330, "#fb923c")):
        out += f'<line x1="{x}" y1="{y + 60}" x2="{x + 10}" y2="{y + 220}" stroke="#fff" stroke-width="2" opacity=".7"/><ellipse cx="{x}" cy="{y}" rx="44" ry="56" fill="{c}"/><ellipse cx="{x - 14}" cy="{y - 20}" rx="10" ry="16" fill="#fff" opacity=".35"/>'
    return out


def p_snow(r: random.Random) -> str:
    out = sky("#0f172a", "#1e3a8a") + "".join(f'<circle cx="{r.randint(0, W)}" cy="{r.randint(0, H)}" r="{r.choice((2, 3, 4))}" fill="#fff" opacity=".8"/>' for _ in range(120))
    out += '<path d="M0 470 Q300 430 600 460 T1200 450 V630 H0Z" fill="#f8fafc"/>'
    return out


def p_clouds(r: random.Random, c1: str = "#60a5fa", c2: str = "#dbeafe") -> str:
    out = sky(c1, c2)
    for x, y, s in ((150, 150, 1), (900, 110, 1.3), (1050, 420, .9), (220, 460, 1.1), (600, 520, .8)):
        out += f'<g transform="translate({x} {y}) scale({s})" fill="#fff" opacity=".85"><ellipse cx="0" cy="0" rx="110" ry="36"/><ellipse cx="-40" cy="-24" rx="50" ry="36"/><ellipse cx="30" cy="-34" rx="60" ry="44"/></g>'
    return out


def p_rails(r: random.Random) -> str:
    out = sky("#fb923c", "#fde68a") + '<path d="M0 380 L240 280 L460 360 L700 260 L940 350 L1200 290 V630 H0Z" fill="#a16207" opacity=".5"/>'
    out += '<rect y="430" width="1200" height="200" fill="#65a30d"/><rect y="470" width="1200" height="60" fill="#78716c"/>'
    out += "".join(f'<rect x="{x}" y="472" width="14" height="56" fill="#57534e"/>' for x in range(0, 1200, 40)) + '<rect y="480" width="1200" height="6" fill="#d6d3d1"/><rect y="514" width="1200" height="6" fill="#d6d3d1"/>'
    return out


def p_market(r: random.Random) -> str:
    out = sky("#7dd3fc", "#f0f9ff") + '<rect y="470" width="1200" height="160" fill="#d6d3d1"/>'
    for i, x in enumerate(range(0, 1200, 300)):
        c = ("#ef4444", "#22c55e", "#3b82f6", "#f59e0b")[i % 4]
        out += f'<rect x="{x + 20}" y="200" width="260" height="20" fill="{c}"/>' + "".join(f'<path d="M{x + 20 + j * 52} 220 h52 l-26 40z" fill="{c if j % 2 else "#fff"}"/>' for j in range(5))
        out += f'<rect x="{x + 30}" y="380" width="240" height="90" fill="#a16207"/><rect x="{x + 40}" y="220" width="8" height="160" fill="#78350f"/><rect x="{x + 252}" y="220" width="8" height="160" fill="#78350f"/>'
        out += "".join(f'<circle cx="{x + 60 + k * 30}" cy="370" r="14" fill="{r.choice(("#ef4444", "#f97316", "#84cc16", "#facc15"))}"/>' for k in range(7))
    return out


def p_desk(r: random.Random, wall: str = "#1e293b") -> str:
    out = f'<rect width="1200" height="630" fill="{wall}"/>' + '<rect y="420" width="1200" height="210" fill="#78350f"/><rect y="410" width="1200" height="14" fill="#a16207"/>'
    out += '<circle cx="1000" cy="150" r="80" fill="#fde68a" opacity=".12"/>'
    return out


def p_garden(r: random.Random) -> str:
    out = sky("#7dd3fc", "#e0f2fe") + '<rect y="330" width="1200" height="300" fill="#78350f"/>'
    for row, y in enumerate((360, 430, 510, 600)):
        out += f'<rect y="{y}" width="1200" height="20" fill="#5b2a0a"/>' + "".join(
            f'<g transform="translate({x} {y})"><path d="M0 0 q-20 -30 -4 -50 q8 20 4 50 M0 0 q20 -26 8 -46 q-12 18 -8 46" fill="#16a34a"/></g>' for x in range(40 + row * 30, 1200, 110))
    return out


def p_golf(r: random.Random) -> str:
    out = sky("#38bdf8", "#e0f2fe") + '<path d="M0 330 Q300 280 600 320 T1200 300 V630 H0Z" fill="#4ade80"/><path d="M0 420 Q400 370 800 420 T1200 410 V630 H0Z" fill="#22c55e"/>'
    out += '<ellipse cx="860" cy="420" rx="200" ry="50" fill="#86efac"/><ellipse cx="900" cy="425" rx="16" ry="6" fill="#14532d"/><line x1="900" y1="425" x2="900" y2="280" stroke="#e5e7eb" stroke-width="5"/><path d="M900 282 l60 18 -60 18z" fill="#ef4444"/>'
    out += '<ellipse cx="250" cy="520" rx="120" ry="30" fill="#fde68a"/>' + "".join(pine(x, y, .8, "#15803d") for x, y in ((80, 340), (1120, 330), (1060, 350)))
    return out


def p_ring(r: random.Random) -> str:
    out = sky("#111827", "#1f2937") + "".join(f'<path d="M{x} 0 L{x + 30} 0 L{x + 150 * d} 450 L{x - 120 * d} 450Z" fill="#fff" opacity=".1"/>' for x, d in ((250, 1), (950, -1)))
    out += '<path d="M120 470 L280 260 H920 L1080 470Z" fill="#1d4ed8"/><path d="M120 470 H1080 V520 H120Z" fill="#1e3a8a"/>'
    out += "".join(f'<path d="M{120 + i * 0} {470 - i * 60} L{280} {260 - i * 30 + 60 * 0} " stroke="none"/>' for i in range(0))
    for i, c in enumerate(("#ef4444", "#f8fafc", "#3b82f6")):
        y = 390 - i * 55
        out += f'<path d="M140 {y + 70} L290 {y - 120 + 70} H910 L1060 {y + 70}" fill="none" stroke="{c}" stroke-width="7"/>'
    out += '<rect x="130" y="250" width="16" height="230" fill="#e5e7eb"/><rect x="1054" y="250" width="16" height="230" fill="#e5e7eb"/>'
    out += "".join(f'<circle cx="{x}" cy="{570 + r.randint(-12, 12)}" r="26" fill="#020617"/>' for x in range(30, 1200, 60))
    return out


def p_pingpong(r: random.Random) -> str:
    out = p_room("#1e3a8a", "#1e293b", r) + '<path d="M260 480 L380 320 H820 L940 480Z" fill="#1d4ed8"/><path d="M260 480 H940 V500 H260Z" fill="#1e3a8a"/>'
    out += '<g stroke="#fff" stroke-width="5" fill="none"><path d="M260 480 L380 320 H820 L940 480Z"/><line x1="600" y1="320" x2="600" y2="480"/></g>'
    out += '<path d="M300 400 H900" stroke="#f8fafc" stroke-width="5"/><rect x="300" y="370" width="600" height="30" fill="#0f172a" opacity=".5"/>'
    out += '<rect x="300" y="500" width="14" height="120" fill="#475569"/><rect x="886" y="500" width="14" height="120" fill="#475569"/>'
    return out


def p_snow_mountains(r: random.Random) -> str:
    out = sky("#7dd3fc", "#e0f2fe") + '<path d="M0 420 L200 200 L380 360 L600 140 L820 380 L1000 230 L1200 420 V630 H0Z" fill="#e2e8f0"/>'
    out += '<path d="M0 520 Q300 420 600 480 T1200 460 V630 H0Z" fill="#f8fafc"/>' + "".join(pine(x, y, s, "#166534") for x, y, s in ((90, 470, .9), (160, 490, .7), (1060, 470, 1), (1130, 490, .7)))
    out += "".join(f'<circle cx="{r.randint(0, W)}" cy="{r.randint(0, 400)}" r="3" fill="#fff" opacity=".8"/>' for _ in range(40))
    return out


PLACES = {
    "football": lambda r, c: p_football(r),
    "basket": lambda r, c: p_basket(r),
    "tennis": lambda r, c: p_court("#c2410c", "#fff", r),
    "padel": lambda r, c: p_court("#1d4ed8", "#fff", r, walls=True),
    "futsal": lambda r, c: p_court("#b45309", "#f8fafc", r, net=False) + '<g fill="none" stroke="#f8fafc" stroke-width="6"><path d="M545 280 V240 H655 V280"/></g><g stroke="#f8fafc" stroke-width="1.5" opacity=".5">' + "".join(f'<line x1="{545 + i * 11}" y1="240" x2="{545 + i * 11}" y2="280"/>' for i in range(11)) + '</g>',
    "volley": lambda r, c: p_beach(r) + '<rect x="200" y="300" width="800" height="8" fill="#f8fafc"/><g stroke="#0f172a" stroke-width="2" opacity=".5">' + "".join(f'<line x1="{205 + i * 20}" y1="308" x2="{205 + i * 20}" y2="360"/>' for i in range(40)) + '</g><rect x="195" y="300" width="10" height="200" fill="#e5e7eb"/><rect x="995" y="300" width="10" height="200" fill="#e5e7eb"/>',
    "pool": lambda r, c: p_pool(r),
    "track": lambda r, c: p_track(r),
    "gym": lambda r, c: p_gym(r),
    "mountains": lambda r, c: p_mountains(c[0], c[1], r),
    "forest": lambda r, c: p_forest(r),
    "night": lambda r, c: p_night(r, c[1]),
    "beach": lambda r, c: p_beach(r),
    "sunset": lambda r, c: p_beach(r, sunset=True),
    "underwater": lambda r, c: p_underwater(r),
    "sea": lambda r, c: p_sea(r),
    "road": lambda r, c: p_road(r, c[0], c[1]),
    "circuit": lambda r, c: p_circuit(r),
    "city": lambda r, c: p_city(r, c[0], c[1]),
    "city_night": lambda r, c: p_city(r, "#0f172a", "#312e81", night=True),
    "cafe": lambda r, c: p_cafe(r),
    "bar": lambda r, c: p_bar(r),
    "table": lambda r, c: p_table(r),
    "kitchen": lambda r, c: p_kitchen(r),
    "club": lambda r, c: p_club(r),
    "stage": lambda r, c: p_stage(r, c[0], c[1]),
    "cinema": lambda r, c: p_cinema(r),
    "theatre": lambda r, c: p_theatre(r),
    "library": lambda r, c: p_library(r),
    "museum": lambda r, c: p_museum(r),
    "classroom": lambda r, c: p_classroom(r),
    "park": lambda r, c: p_park(r),
    "office": lambda r, c: p_office(r),
    "hall": lambda r, c: p_hall(r, c[0], c[1]),
    "parliament": lambda r, c: p_parliament(r),
    "polling": lambda r, c: p_polling(r),
    "party": lambda r, c: p_party(r, c[0], c[1]),
    "birthday": lambda r, c: p_party(r, "#f472b6", "#fde68a") + p_balloons(r),
    "snow": lambda r, c: p_snow(r),
    "clouds": lambda r, c: p_clouds(r, c[0], c[1]),
    "rails": lambda r, c: p_rails(r),
    "market": lambda r, c: p_market(r),
    "desk": lambda r, c: p_desk(r),
    "garden": lambda r, c: p_garden(r),
    "mountains_nosun": lambda r, c: p_mountains(c[0], c[1], r, sun=False),
    "beach_nosun": lambda r, c: p_beach(r, sun=False),
    "sea_nosun": lambda r, c: p_sea(r, sun=False),
    "golf": lambda r, c: p_golf(r),
    "ring": lambda r, c: p_ring(r),
    "pingpong": lambda r, c: p_pingpong(r),
    "snow_mountains": lambda r, c: p_snow_mountains(r),
}


# ======================================================================================== things

def t_soccer() -> str:
    pent = lambda x, y, s: f'<path d="M{x} {y - s} L{x + s * .95} {y - s * .31} L{x + s * .59} {y + s * .81} L{x - s * .59} {y + s * .81} L{x - s * .95} {y - s * .31}Z" fill="#111827"/>'
    return (shadow(0, 118, 90) + '<circle r="110" fill="#f8fafc" stroke="#111827" stroke-width="5"/>' + pent(0, 0, 34)
            + pent(0, -92, 22) + pent(86, -30, 22) + pent(54, 76, 22) + pent(-54, 76, 22) + pent(-86, -30, 22)
            + '<g stroke="#111827" stroke-width="4"><line x1="0" y1="-34" x2="0" y2="-70"/><line x1="32" y1="-10" x2="66" y2="-22"/><line x1="20" y1="28" x2="42" y2="58"/><line x1="-20" y1="28" x2="-42" y2="58"/><line x1="-32" y1="-10" x2="-66" y2="-22"/></g>'
            '<ellipse cx="-40" cy="-50" rx="26" ry="14" fill="#fff" opacity=".5" transform="rotate(-30 -40 -50)"/>')


def t_basketball() -> str:
    return (shadow(0, 118, 90) + '<circle r="110" fill="#ea580c" stroke="#7c2d12" stroke-width="5"/>'
            '<g fill="none" stroke="#7c2d12" stroke-width="6"><line x1="-110" y1="0" x2="110" y2="0"/><line x1="0" y1="-110" x2="0" y2="110"/>'
            '<path d="M-78 -78 Q-20 0 -78 78"/><path d="M78 -78 Q20 0 78 78"/></g><ellipse cx="-44" cy="-50" rx="24" ry="12" fill="#fff" opacity=".25" transform="rotate(-35 -44 -50)"/>')


def t_tennisball(s: float = 1) -> str:
    return (f'<g transform="scale({s})"><circle r="60" fill="#d9f99d" stroke="#65a30d" stroke-width="4"/>'
            '<path d="M-58 -16 Q0 10 -16 58 M58 16 Q0 -10 16 -58" fill="none" stroke="#fff" stroke-width="7"/></g>')


def t_racket(color: str = "#1d4ed8") -> str:
    return (f'<g transform="rotate(-25)"><ellipse cx="0" cy="-60" rx="80" ry="105" fill="none" stroke="{color}" stroke-width="14"/>'
            '<g stroke="#e5e7eb" stroke-width="2.5">' + "".join(f'<line x1="{x}" y1="-160" x2="{x}" y2="40"/>' for x in range(-70, 80, 14)) + "".join(f'<line x1="-80" y1="{y}" x2="80" y2="{y}"/>' for y in range(-150, 40, 14))
            + '</g><ellipse cx="0" cy="-60" rx="80" ry="105" fill="none" stroke="' + color + '" stroke-width="14"/>'
            '<rect x="-12" y="40" width="24" height="120" rx="8" fill="#111827"/></g>')


def t_padel() -> str:
    holes = "".join(f'<circle cx="{x}" cy="{y}" r="6" fill="#0f172a"/>' for x in range(-50, 60, 24) for y in range(-140, -10, 24) if (x * x) / 65 ** 2 + ((y + 75) ** 2) / 85 ** 2 < 0.8)
    return (f'<g transform="rotate(-20)"><ellipse cx="0" cy="-75" rx="75" ry="92" fill="#f43f5e" stroke="#111827" stroke-width="6"/>'
            f'<ellipse cx="0" cy="-75" rx="58" ry="74" fill="#fb7185"/>{holes}<path d="M-26 8 L-14 30 H14 L26 8Z" fill="#111827"/>'
            '<rect x="-14" y="28" width="28" height="110" rx="10" fill="#111827"/><rect x="-14" y="120" width="28" height="18" fill="#f43f5e"/></g>')


def t_volley() -> str:
    return (shadow(0, 118, 90) + '<circle r="110" fill="#fef9c3" stroke="#1e3a8a" stroke-width="5"/>'
            '<g fill="none" stroke="#1e3a8a" stroke-width="6"><path d="M0 -110 Q-30 0 0 110"/><path d="M-100 -45 Q0 -10 100 -45"/><path d="M-90 60 Q0 20 90 60"/></g>'
            '<path d="M0 -110 Q-30 0 0 110 Q60 0 0 -110" fill="#2563eb" opacity=".35"/>')


def t_bike(color: str = "#ef4444") -> str:
    wheel = lambda x: (f'<circle cx="{x}" cy="40" r="70" fill="none" stroke="#111827" stroke-width="12"/><circle cx="{x}" cy="40" r="6" fill="#111827"/>'
                       + "".join(f'<line x1="{x}" y1="40" x2="{x + 64 * math.cos(a)}" y2="{40 + 64 * math.sin(a)}" stroke="#9ca3af" stroke-width="2"/>' for a in [i * math.pi / 8 for i in range(16)]))
    return (shadow(0, 118, 170) + wheel(-110) + wheel(110)
            + f'<g fill="none" stroke="{color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="M-110 40 L-40 -50 L70 -50 L110 40 M-40 -50 L10 40 L70 -50 M10 40 L-110 40"/></g>'
            '<path d="M-60 -70 H-20" stroke="#111827" stroke-width="12" stroke-linecap="round"/><path d="M70 -50 L60 -90 H95" stroke="#111827" stroke-width="10" fill="none" stroke-linecap="round"/>')


def t_dumbbell() -> str:
    """A barbell seen from the side: the bar, the grip and two discs at each end."""
    disc = lambda x, h, c: f'<rect x="{x - 14}" y="{-h / 2}" width="28" height="{h}" rx="8" fill="{c}"/>'
    return (shadow(0, 110, 230) + '<rect x="-230" y="-10" width="460" height="20" rx="8" fill="#9ca3af"/>'
            '<rect x="-70" y="-14" width="140" height="28" rx="8" fill="#4b5563"/>' + "".join(f'<line x1="{x}" y1="-14" x2="{x}" y2="14" stroke="#9ca3af" stroke-width="2"/>' for x in range(-60, 70, 12))
            + disc(-150, 190, "#dc2626") + disc(-118, 150, "#2563eb") + disc(150, 190, "#dc2626") + disc(118, 150, "#2563eb")
            + '<rect x="-98" y="-22" width="14" height="44" rx="4" fill="#111827"/><rect x="84" y="-22" width="14" height="44" rx="4" fill="#111827"/>')


def t_kettlebell() -> str:
    return (shadow(0, 120, 110) + '<path d="M-60 -40 Q-60 -130 0 -130 Q60 -130 60 -40" fill="none" stroke="#7c2d12" stroke-width="28"/>'
            '<circle cx="0" cy="30" r="100" fill="#ea580c"/><ellipse cx="-40" cy="-10" rx="24" ry="14" fill="#fff" opacity=".15"/><text x="0" y="50" text-anchor="middle" font-family="Arial" font-weight="700" font-size="44" fill="#facc15">16</text>')


def t_shoe() -> str:
    return (shadow(0, 70, 150) + '<path d="M-140 40 Q-150 -10 -110 -20 L-40 -60 Q-20 -10 30 -10 L120 0 Q150 10 145 40 Z" fill="#22d3ee"/>'
            '<path d="M-150 40 H150 Q150 60 120 62 H-130 Q-150 60 -150 40Z" fill="#f8fafc"/><g stroke="#fff" stroke-width="5"><line x1="-50" y1="-40" x2="-20" y2="-30"/><line x1="-60" y1="-25" x2="-30" y2="-15"/></g>'
            '<path d="M-110 -20 L-40 -60" stroke="#0e7490" stroke-width="8"/>')


def t_stopwatch() -> str:
    return (shadow(0, 128, 90) + '<rect x="-16" y="-150" width="32" height="30" rx="6" fill="#475569"/><circle r="115" fill="#f8fafc" stroke="#334155" stroke-width="12"/>'
            + "".join(f'<line x1="{90 * math.cos(a)}" y1="{90 * math.sin(a)}" x2="{100 * math.cos(a)}" y2="{100 * math.sin(a)}" stroke="#334155" stroke-width="5"/>' for a in [i * math.pi / 6 for i in range(12)])
            + '<line x1="0" y1="0" x2="0" y2="-75" stroke="#ef4444" stroke-width="8" stroke-linecap="round"/><line x1="0" y1="0" x2="50" y2="20" stroke="#334155" stroke-width="7" stroke-linecap="round"/><circle r="10" fill="#334155"/>')


def t_trophy() -> str:
    return (shadow(0, 140, 110) + '<path d="M-80 -120 H80 V-40 Q80 30 0 40 Q-80 30 -80 -40Z" fill="#fbbf24"/><path d="M-80 -100 Q-140 -100 -130 -50 Q-120 -10 -70 0" fill="none" stroke="#fbbf24" stroke-width="16"/>'
            '<path d="M80 -100 Q140 -100 130 -50 Q120 -10 70 0" fill="none" stroke="#fbbf24" stroke-width="16"/><rect x="-16" y="38" width="32" height="50" fill="#f59e0b"/>'
            '<rect x="-70" y="86" width="140" height="40" rx="6" fill="#92400e"/><path d="M-50 -110 Q-50 0 -10 20" stroke="#fff" stroke-width="8" fill="none" opacity=".45"/><path d="M0 -90 l12 24 26 4 -19 18 5 26 -24 -13 -24 13 5 -26 -19 -18 26 -4z" fill="#fff" opacity=".9"/>')


def t_medal() -> str:
    return ('<path d="M-60 -150 L-10 -30 H10 L-40 -150Z" fill="#2563eb"/><path d="M60 -150 L10 -30 H-10 L40 -150Z" fill="#dc2626"/>'
            + shadow(0, 130, 80) + '<circle cx="0" cy="30" r="90" fill="#fbbf24" stroke="#b45309" stroke-width="8"/><circle cx="0" cy="30" r="62" fill="none" stroke="#fde68a" stroke-width="4"/>'
            '<text x="0" y="58" text-anchor="middle" font-family="Arial" font-weight="800" font-size="80" fill="#b45309">1</text>')


def t_whistle() -> str:
    return (shadow(0, 90, 120) + '<circle cx="-40" cy="20" r="70" fill="#facc15"/><rect x="-40" y="-50" width="170" height="60" rx="14" fill="#facc15"/><circle cx="-40" cy="20" r="26" fill="#a16207"/>'
            '<rect x="100" y="-50" width="40" height="60" rx="8" fill="#ca8a04"/><path d="M-90 -40 Q-160 -110 -110 -160" fill="none" stroke="#ef4444" stroke-width="10"/>')


def t_swimmer() -> str:
    return ('<g><circle cx="90" cy="-30" r="34" fill="#f59e0b"/><path d="M60 -52 Q90 -80 124 -48" fill="#ef4444"/>'
            '<path d="M-150 0 Q-40 -60 80 -10" fill="none" stroke="#f59e0b" stroke-width="30" stroke-linecap="round"/>'
            '<path d="M40 -20 Q0 -120 -90 -100" fill="none" stroke="#f59e0b" stroke-width="24" stroke-linecap="round"/></g>'
            '<path d="M-200 30 Q-150 0 -100 30 T0 30 T100 30 T200 30" fill="none" stroke="#fff" stroke-width="10" opacity=".8"/>'
            '<path d="M-200 60 Q-150 30 -100 60 T0 60 T100 60 T200 60" fill="none" stroke="#fff" stroke-width="8" opacity=".5"/>')


def t_surf() -> str:
    return ('<g transform="rotate(-30)"><ellipse rx="60" ry="200" fill="#f97316"/><ellipse rx="44" ry="184" fill="#fdba74"/><rect x="-6" y="-180" width="12" height="360" fill="#ea580c"/><path d="M-20 150 L0 190 L20 150Z" fill="#c2410c"/></g>')


def t_kayak() -> str:
    return ('<path d="M-220 20 Q0 -40 220 20 Q0 70 -220 20Z" fill="#ef4444"/><ellipse cx="0" cy="12" rx="60" ry="16" fill="#7f1d1d"/>'
            '<g transform="rotate(30)"><rect x="-8" y="-150" width="16" height="300" rx="6" fill="#facc15"/><ellipse cx="0" cy="-160" rx="26" ry="46" fill="#111827"/><ellipse cx="0" cy="160" rx="26" ry="46" fill="#111827"/></g>'
            '<path d="M-260 50 Q-200 30 -140 50 T-20 50 T100 50 T220 50" fill="none" stroke="#fff" stroke-width="8" opacity=".7"/>')


def t_sailboat() -> str:
    return ('<path d="M-150 60 H150 L110 120 H-110Z" fill="#7c2d12"/><rect x="-6" y="-170" width="12" height="230" fill="#57534e"/>'
            '<path d="M10 -160 L130 40 H10Z" fill="#f8fafc"/><path d="M-10 -130 L-120 40 H-10Z" fill="#fca5a5"/><path d="M6 -170 h40 l-8 14 8 14 h-40z" fill="#2563eb"/>'
            '<path d="M-200 130 Q-150 110 -100 130 T0 130 T100 130 T200 130" fill="none" stroke="#fff" stroke-width="8" opacity=".7"/>')


def t_fish(color: str = "#f97316") -> str:
    return (f'<path d="M-140 0 Q-40 -90 80 0 Q-40 90 -140 0Z" fill="{color}"/><path d="M70 0 L150 -60 V60Z" fill="{shade(color, -0.2)}"/>'
            '<circle cx="-90" cy="-12" r="12" fill="#fff"/><circle cx="-90" cy="-12" r="6" fill="#111827"/><path d="M-40 -50 Q-20 0 -40 50 M0 -40 Q20 0 0 40" fill="none" stroke="#fff" stroke-width="10"/>')


def t_tent() -> str:
    return (shadow(0, 128, 200) + '<path d="M0 -150 L190 120 H-190Z" fill="#f97316"/><path d="M0 -150 L60 120 H-60Z" fill="#c2410c"/><path d="M0 -40 L40 120 H-40Z" fill="#431407"/>'
            '<line x1="0" y1="-150" x2="0" y2="-180" stroke="#57534e" stroke-width="6"/><path d="M0 -180 l30 10 -30 10z" fill="#facc15"/>')


def t_fire() -> str:
    return ('<g><rect x="-110" y="70" width="220" height="24" rx="12" fill="#78350f" transform="rotate(12)"/><rect x="-110" y="70" width="220" height="24" rx="12" fill="#92400e" transform="rotate(-12)"/>'
            '<path d="M0 80 C-90 40 -70 -40 -20 -100 C-20 -40 20 -40 10 -140 C80 -80 100 0 60 70 Z" fill="#f97316"/><path d="M0 75 C-40 40 -30 -10 0 -50 C10 -10 40 0 30 70Z" fill="#fde047"/></g>')


def t_sun(c: str = "#facc15") -> str:
    return (f'<circle r="80" fill="{c}"/>' + "".join(f'<line x1="{100 * math.cos(a)}" y1="{100 * math.sin(a)}" x2="{140 * math.cos(a)}" y2="{140 * math.sin(a)}" stroke="{c}" stroke-width="14" stroke-linecap="round"/>' for a in [i * math.pi / 6 for i in range(12)]))


def t_moon() -> str:
    return '<circle r="110" fill="#fef9c3"/><circle cx="50" cy="-30" r="100" fill="#0b1026"/><circle cx="-50" cy="30" r="12" fill="#fde68a"/><circle cx="-20" cy="-50" r="8" fill="#fde68a"/>'


def t_star(c: str = "#fde047", r1: float = 120) -> str:
    pts = " ".join(f"{(r1 if i % 2 == 0 else r1 * .45) * math.cos(-math.pi / 2 + i * math.pi / 5):.1f},{(r1 if i % 2 == 0 else r1 * .45) * math.sin(-math.pi / 2 + i * math.pi / 5):.1f}" for i in range(10))
    return f'<polygon points="{pts}" fill="{c}" stroke="{shade(c, -0.3)}" stroke-width="6" stroke-linejoin="round"/>'


def t_map() -> str:
    return (shadow(0, 130, 180) + '<path d="M-180 -110 L-60 -140 L60 -110 L180 -140 V110 L60 140 L-60 110 L-180 140Z" fill="#fef3c7"/>'
            '<path d="M-60 -140 V110 M60 -110 V140" stroke="#d6d3d1" stroke-width="4"/><path d="M-150 60 Q-60 -40 20 30 T150 -60" fill="none" stroke="#ef4444" stroke-width="6" stroke-dasharray="14 10"/>'
            '<path d="M150 -60 m0 -40 a26 26 0 0 1 26 26 c0 20 -26 46 -26 46 s-26 -26 -26 -46 a26 26 0 0 1 26 -26z" fill="#ef4444"/><circle cx="150" cy="-74" r="9" fill="#fff"/>')


def t_camera() -> str:
    return (shadow(0, 118, 160) + '<rect x="-160" y="-80" width="320" height="190" rx="24" fill="#1f2937"/><rect x="-70" y="-120" width="120" height="50" rx="10" fill="#1f2937"/>'
            '<circle cx="0" cy="15" r="72" fill="#374151"/><circle cx="0" cy="15" r="52" fill="#0ea5e9"/><circle cx="-16" cy="0" r="14" fill="#fff" opacity=".7"/><rect x="100" y="-60" width="34" height="20" rx="4" fill="#fbbf24"/>')


def t_car(color: str = "#ef4444") -> str:
    return (shadow(0, 92, 200) + f'<path d="M-200 50 V0 Q-200 -20 -170 -24 L-100 -40 L-50 -100 H70 L130 -40 L180 -30 Q200 -24 200 0 V50Z" fill="{color}"/>'
            '<path d="M-80 -40 L-40 -86 H0 V-40Z M20 -40 V-86 H62 L110 -40Z" fill="#bae6fd"/><g><circle cx="-110" cy="56" r="40" fill="#111827"/><circle cx="-110" cy="56" r="16" fill="#9ca3af"/>'
            '<circle cx="120" cy="56" r="40" fill="#111827"/><circle cx="120" cy="56" r="16" fill="#9ca3af"/></g><rect x="170" y="-10" width="24" height="14" rx="4" fill="#fde047"/>')


def t_moto() -> str:
    return (shadow(0, 110, 200) + '<circle cx="-130" cy="50" r="62" fill="#111827"/><circle cx="-130" cy="50" r="26" fill="#9ca3af"/><circle cx="140" cy="50" r="62" fill="#111827"/><circle cx="140" cy="50" r="26" fill="#9ca3af"/>'
            '<path d="M-130 50 L-40 -30 H60 L140 50" fill="none" stroke="#374151" stroke-width="14"/><path d="M-60 -50 Q0 -90 70 -40 L50 10 H-40Z" fill="#dc2626"/><path d="M-120 -40 H-30" stroke="#111827" stroke-width="18" stroke-linecap="round"/>'
            '<path d="M60 -40 L100 -100 H130" stroke="#111827" stroke-width="10" fill="none" stroke-linecap="round"/>')


def t_helmet(color: str = "#2563eb") -> str:
    return (shadow(0, 110, 150) + f'<path d="M-150 60 Q-150 -130 20 -130 Q160 -130 160 40 L160 70 H-150Z" fill="{color}"/><path d="M10 -40 H160 V40 H10 Q-10 0 10 -40Z" fill="#0f172a"/>'
            '<path d="M-100 -70 Q-40 -110 40 -100" fill="none" stroke="#fff" stroke-width="12" opacity=".5"/><rect x="-150" y="60" width="310" height="24" rx="8" fill="#111827"/>')


def t_flag() -> str:
    return ('<rect x="-150" y="-160" width="14" height="330" fill="#e5e7eb"/><g transform="translate(-136 -160)">' + "".join(
        f'<rect x="{(i % 6) * 46}" y="{(i // 6) * 46}" width="46" height="46" fill="{"#111" if (i + i // 6) % 2 else "#fff"}"/>' for i in range(24)) + '</g>')


def t_steering() -> str:
    return (shadow(0, 140, 130) + '<circle r="130" fill="none" stroke="#111827" stroke-width="30"/><circle r="40" fill="#374151"/><path d="M-120 -10 H-40 M40 -10 H120 M0 40 V120" stroke="#111827" stroke-width="30"/>'
            '<circle r="18" fill="#dc2626"/>')


def t_coffee() -> str:
    return (shadow(0, 128, 160) + '<ellipse cx="0" cy="110" rx="160" ry="26" fill="#f8fafc"/><path d="M-110 -60 H110 L90 90 Q80 110 50 110 H-50 Q-80 110 -90 90Z" fill="#f8fafc"/>'
            '<path d="M105 -30 Q170 -30 160 30 Q150 70 95 70" fill="none" stroke="#f8fafc" stroke-width="18"/><ellipse cx="0" cy="-60" rx="110" ry="22" fill="#78350f"/>'
            '<g fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".7"><path d="M-40 -100 q-20 -30 0 -60 q20 -30 0 -60"/><path d="M30 -100 q-20 -30 0 -60"/></g>')


def t_beer() -> str:
    return (shadow(0, 140, 120) + '<path d="M-90 -100 H90 V120 Q90 140 70 140 H-70 Q-90 140 -90 120Z" fill="#f59e0b"/><path d="M85 -60 Q160 -60 160 10 Q160 70 85 70" fill="none" stroke="#fcd34d" stroke-width="22"/>'
            '<path d="M-100 -100 Q-110 -150 -60 -150 Q-40 -180 0 -160 Q40 -185 70 -150 Q115 -150 100 -100Z" fill="#fff"/>'
            '<g fill="#fff" opacity=".5"><circle cx="-40" cy="20" r="8"/><circle cx="20" cy="60" r="6"/><circle cx="-10" cy="-20" r="5"/></g><rect x="-60" y="-80" width="16" height="200" fill="#fff" opacity=".25"/>')


def t_cocktail() -> str:
    return ('<path d="M-130 -110 H130 L0 30Z" fill="#ec4899" opacity=".9"/><path d="M-130 -110 H130" stroke="#fff" stroke-width="6"/><rect x="-6" y="30" width="12" height="100" fill="#e5e7eb"/>'
            '<ellipse cx="0" cy="135" rx="70" ry="14" fill="#e5e7eb"/><circle cx="90" cy="-120" r="34" fill="#a3e635" stroke="#4d7c0f" stroke-width="6"/><line x1="-40" y1="-160" x2="20" y2="-30" stroke="#fde047" stroke-width="8"/>')


def t_wine() -> str:
    one = lambda x, r: (f'<g transform="translate({x} 0) rotate({r})"><path d="M-60 -150 H60 Q70 -40 0 -10 Q-70 -40 -60 -150Z" fill="#e0f2fe" opacity=".9"/>'
                        '<path d="M-56 -100 H56 Q56 -30 0 -14 Q-56 -30 -56 -100Z" fill="#9f1239"/><rect x="-5" y="-12" width="10" height="120" fill="#e0f2fe"/><ellipse cx="0" cy="110" rx="50" ry="10" fill="#e0f2fe"/></g>')
    return shadow(0, 128, 170) + one(-70, -10) + one(70, 10)


def t_plate() -> str:
    return (shadow(0, 110, 180) + '<ellipse cx="0" cy="20" rx="170" ry="100" fill="#f8fafc"/><ellipse cx="0" cy="20" rx="120" ry="68" fill="#e2e8f0"/>'
            '<circle cx="-30" cy="10" r="34" fill="#16a34a"/><circle cx="30" cy="20" r="30" fill="#dc2626"/><ellipse cx="10" cy="40" rx="50" ry="20" fill="#f59e0b"/>'
            '<g fill="#cbd5e1"><rect x="-230" y="-80" width="14" height="200" rx="6"/><path d="M-244 -80 v60 h42 v-60" fill="none" stroke="#cbd5e1" stroke-width="8"/>'
            '<rect x="214" y="-80" width="16" height="200" rx="6"/><path d="M214 -80 q30 40 0 90" fill="#cbd5e1"/></g>')


def t_pizza() -> str:
    return (shadow(0, 120, 180) + '<circle r="170" fill="#f59e0b"/><circle r="148" fill="#ef4444"/><circle r="140" fill="#fde047" opacity=".8"/>'
            + "".join(f'<circle cx="{x}" cy="{y}" r="22" fill="#b91c1c"/>' for x, y in ((-60, -60), (50, -80), (80, 30), (-30, 60), (-90, 20), (20, 0)))
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="10" ry="6" fill="#16a34a"/>' for x, y in ((0, -40), (60, -20), (-60, 100), (40, 90)))
            + '<path d="M0 0 L170 0 A170 170 0 0 1 120 120Z" fill="#000" opacity=".12"/>')


def t_burger() -> str:
    return (shadow(0, 140, 170) + '<path d="M-170 -30 Q-170 -150 0 -150 Q170 -150 170 -30Z" fill="#f59e0b"/>' + "".join(f'<ellipse cx="{x}" cy="{y}" rx="6" ry="3" fill="#fef3c7"/>' for x, y in ((-60, -100), (0, -120), (60, -95), (-20, -80), (100, -70)))
            + '<path d="M-180 -20 Q-90 20 0 -20 T180 -20 V0 H-180Z" fill="#22c55e"/><rect x="-175" y="0" width="350" height="40" rx="18" fill="#78350f"/><path d="M-180 40 L-140 70 L-100 40 L-60 70 L-20 40 L20 70 L60 40 L100 70 L140 40 L180 70 V40Z" fill="#facc15"/>'
            '<rect x="-170" y="70" width="340" height="56" rx="24" fill="#f59e0b"/>')


def t_cake() -> str:
    return (shadow(0, 140, 190) + '<rect x="-170" y="0" width="340" height="130" rx="16" fill="#f472b6"/><path d="M-170 20 Q-130 60 -90 20 T-10 20 T70 20 T150 20 L170 20 V0 H-170Z" fill="#fdf2f8"/>'
            '<rect x="-120" y="-80" width="240" height="90" rx="12" fill="#fbcfe8"/><path d="M-120 -60 Q-90 -30 -60 -60 T0 -60 T60 -60 T120 -60 V-80 H-120Z" fill="#fdf2f8"/>'
            + "".join(f'<rect x="{x - 6}" y="-150" width="12" height="70" fill="{c}"/><path d="M{x} -175 q12 14 0 24 q-12 -10 0 -24" fill="#f59e0b"/>' for x, c in ((-60, "#38bdf8"), (0, "#a3e635"), (60, "#facc15"))))


def t_paella() -> str:
    return (shadow(0, 110, 210) + '<rect x="-280" y="-14" width="80" height="28" rx="10" fill="#111827"/><rect x="200" y="-14" width="80" height="28" rx="10" fill="#111827"/>'
            '<ellipse rx="210" ry="110" fill="#1f2937"/><ellipse rx="190" ry="96" fill="#f59e0b"/>' + "".join(f'<circle cx="{x}" cy="{y}" r="4" fill="#fef3c7"/>' for x in range(-160, 170, 22) for y in range(-70, 80, 22) if (x / 190) ** 2 + (y / 96) ** 2 < .85)
            + "".join(f'<path d="M{x} {y} q30 -20 50 0 q-20 20 -50 0z" fill="#fb923c" stroke="#ea580c" stroke-width="3"/>' for x, y in ((-120, -30), (40, -50), (60, 30), (-60, 40)))
            + "".join(f'<path d="M{x} {y} l20 -6 l-4 20z" fill="#facc15"/>' for x, y in ((-20, 0), (100, -10)))
            + "".join(f'<ellipse cx="{x}" cy="{y}" rx="9" ry="5" fill="#16a34a"/>' for x, y in ((-90, 10), (10, 50), (120, 40), (-30, -60))))


def t_chef() -> str:
    return (shadow(0, 140, 140) + '<path d="M-110 20 Q-180 -60 -100 -110 Q-80 -180 0 -160 Q80 -180 100 -110 Q180 -60 110 20Z" fill="#f8fafc"/><rect x="-110" y="10" width="220" height="110" rx="10" fill="#e5e7eb"/>'
            '<line x1="-60" y1="30" x2="-60" y2="110" stroke="#cbd5e1" stroke-width="6"/><line x1="0" y1="30" x2="0" y2="110" stroke="#cbd5e1" stroke-width="6"/><line x1="60" y1="30" x2="60" y2="110" stroke="#cbd5e1" stroke-width="6"/>')


def t_guitar(color: str = "#d97706") -> str:
    return (f'<g transform="rotate(35)"><rect x="-14" y="-260" width="28" height="200" fill="#78350f"/><rect x="-24" y="-300" width="48" height="50" rx="8" fill="#451a03"/>'
            + "".join(f'<line x1="-12" y1="{-250 + i * 22}" x2="12" y2="{-250 + i * 22}" stroke="#e5e7eb" stroke-width="2"/>' for i in range(9))
            + f'<path d="M0 -80 C-120 -80 -120 20 -60 40 C-150 80 -110 210 0 210 C110 210 150 80 60 40 C120 20 120 -80 0 -80Z" fill="{color}"/>'
            '<circle cx="0" cy="40" r="34" fill="#451a03"/><rect x="-40" y="130" width="80" height="16" rx="4" fill="#451a03"/>'
            + "".join(f'<line x1="{x}" y1="-290" x2="{x}" y2="138" stroke="#f8fafc" stroke-width="1.5"/>' for x in (-9, -5, -1, 3, 7)) + '</g>')


def t_mic() -> str:
    return (shadow(0, 150, 80) + '<g transform="rotate(20)"><rect x="-22" y="0" width="44" height="170" rx="16" fill="#111827"/><circle cx="0" cy="-50" r="70" fill="#9ca3af"/>'
            '<g stroke="#6b7280" stroke-width="3">' + "".join(f'<line x1="-60" y1="{-90 + i * 14}" x2="60" y2="{-90 + i * 14}"/>' for i in range(6)) + '</g><rect x="-36" y="10" width="72" height="20" rx="6" fill="#facc15"/></g>')


def t_drum() -> str:
    return (shadow(0, 140, 190) + '<rect x="-170" y="-60" width="340" height="170" fill="#dc2626"/><ellipse cx="0" cy="110" rx="170" ry="40" fill="#b91c1c"/><ellipse cx="0" cy="-60" rx="170" ry="40" fill="#f8fafc" stroke="#d1d5db" stroke-width="8"/>'
            '<g stroke="#fbbf24" stroke-width="6">' + "".join(f'<line x1="{x}" y1="-40" x2="{x}" y2="120"/>' for x in (-140, -70, 0, 70, 140)) + '</g>'
            '<g stroke="#a16207" stroke-width="12" stroke-linecap="round"><line x1="-60" y1="-80" x2="-190" y2="-200"/><line x1="60" y1="-80" x2="190" y2="-200"/></g>')


def t_keys() -> str:
    whites = "".join(f'<rect x="{-210 + i * 42}" y="-40" width="40" height="160" rx="4" fill="#f8fafc"/>' for i in range(10))
    blacks = "".join(f'<rect x="{-210 + i * 42 + 28}" y="-40" width="26" height="96" rx="3" fill="#111827"/>' for i in range(9) if i % 7 not in (2, 6))
    return shadow(0, 140, 230) + '<rect x="-230" y="-80" width="460" height="220" rx="16" fill="#111827"/>' + whites + blacks


def t_vinyl() -> str:
    return (shadow(0, 150, 140) + '<circle r="150" fill="#111827"/>' + "".join(f'<circle r="{r}" fill="none" stroke="#374151" stroke-width="2"/>' for r in range(60, 150, 14))
            + '<circle r="52" fill="#ef4444"/><circle r="8" fill="#111827"/><path d="M-100 -100 A140 140 0 0 1 0 -140" stroke="#fff" stroke-width="8" fill="none" opacity=".25"/>')


def t_headphones() -> str:
    return ('<path d="M-130 30 V-20 A130 130 0 0 1 130 -20 V30" fill="none" stroke="#111827" stroke-width="26"/>'
            '<rect x="-170" y="10" width="70" height="130" rx="30" fill="#7c3aed"/><rect x="100" y="10" width="70" height="130" rx="30" fill="#7c3aed"/>'
            '<rect x="-150" y="30" width="30" height="90" rx="12" fill="#a78bfa"/><rect x="120" y="30" width="30" height="90" rx="12" fill="#a78bfa"/>')


def t_disco() -> str:
    tiles = "".join(f'<rect x="{x}" y="{y}" width="26" height="26" fill="{c}"/>' for x in range(-130, 130, 28) for y in range(-130, 130, 28)
                    for c in [("#e5e7eb", "#94a3b8", "#f8fafc", "#cbd5e1")[(x * 7 + y * 3) % 4]])
    return ('<line x1="0" y1="-260" x2="0" y2="-130" stroke="#e5e7eb" stroke-width="4"/><defs><clipPath id="db"><circle r="130"/></clipPath></defs>'
            f'<g clip-path="url(#db)"><rect x="-130" y="-130" width="260" height="260" fill="#64748b"/>{tiles}</g><circle r="130" fill="none" stroke="#475569" stroke-width="4"/>'
            '<path d="M-60 -80 l10 20 20 4 -16 14 4 22 -18 -10 -18 10 4 -22 -16 -14 20 -4z" fill="#fff"/>')


def t_film() -> str:
    return (shadow(0, 130, 190) + '<rect x="-180" y="-40" width="360" height="160" rx="10" fill="#111827"/><g transform="rotate(-14 -180 -40)"><rect x="-180" y="-100" width="360" height="56" rx="8" fill="#111827"/>'
            + "".join(f'<path d="M{-170 + i * 72} -100 l40 0 l-30 56 l-40 0z" fill="#f8fafc"/>' for i in range(5)) + '</g>'
            + "".join(f'<path d="M{-170 + i * 72} -40 l40 0 l-30 50 l-40 0z" fill="#f8fafc"/>' for i in range(5))
            + '<g fill="#f8fafc" font-family="Arial" font-weight="700" font-size="28"><text x="-150" y="60">ESCENA 1</text><text x="-150" y="100">TOMA 3</text></g>')


def t_popcorn() -> str:
    return (shadow(0, 150, 120) + "".join(f'<circle cx="{x}" cy="{y}" r="{r}" fill="#fef3c7" stroke="#fde68a" stroke-width="3"/>' for x, y, r in ((-70, -110, 40), (-20, -140, 44), (40, -120, 42), (80, -90, 36), (-90, -70, 34), (10, -90, 40), (60, -50, 30), (-40, -60, 30)))
            + '<path d="M-120 -60 H120 L90 150 H-90Z" fill="#f8fafc"/>' + "".join(f'<path d="M{x} -60 L{x * .75 + 4} 150 L{x * .75 + 26} 150 L{x + 30} -60Z" fill="#ef4444"/>' for x in (-110, -50, 10, 70)))


def t_masks() -> str:
    face = lambda x, r, c, mouth: (f'<g transform="translate({x} 0) rotate({r})"><path d="M-80 -110 H80 V-10 Q80 110 0 120 Q-80 110 -80 -10Z" fill="{c}"/>'
                                   f'<ellipse cx="-32" cy="-40" rx="18" ry="12" fill="#111827"/><ellipse cx="32" cy="-40" rx="18" ry="12" fill="#111827"/><path d="{mouth}" fill="none" stroke="#111827" stroke-width="10" stroke-linecap="round"/></g>')
    return shadow(0, 140, 190) + face(-80, -14, "#fde047", "M-36 40 Q0 80 36 40") + face(80, 14, "#f8fafc", "M-36 66 Q0 30 36 66")


def t_books() -> str:
    return (shadow(0, 140, 200) + '<rect x="-180" y="60" width="360" height="60" rx="6" fill="#1d4ed8"/><rect x="-170" y="70" width="340" height="40" fill="#f8fafc" opacity=".25"/>'
            '<rect x="-160" y="0" width="320" height="60" rx="6" fill="#dc2626"/><rect x="-140" y="-60" width="300" height="60" rx="6" fill="#16a34a" transform="rotate(-4)"/>'
            '<g transform="translate(60 -150) rotate(-15)"><path d="M-110 0 Q0 -30 0 -10 Q0 -30 110 0 V60 Q0 30 0 50 Q0 30 -110 60Z" fill="#f8fafc" stroke="#d1d5db" stroke-width="4"/><line x1="0" y1="-10" x2="0" y2="50" stroke="#d1d5db" stroke-width="4"/></g>')


def t_palette() -> str:
    return (shadow(0, 130, 180) + '<path d="M0 -130 C120 -130 200 -50 190 30 C180 90 110 70 90 100 C70 140 120 160 40 160 C-120 160 -200 70 -190 -10 C-180 -90 -100 -130 0 -130Z" fill="#fde68a"/>'
            '<circle cx="40" cy="110" r="28" fill="#fff" opacity=".0"/>' + "".join(f'<circle cx="{x}" cy="{y}" r="26" fill="{c}"/>' for x, y, c in ((-110, -10, "#ef4444"), (-60, -80, "#f97316"), (20, -90, "#22c55e"), (100, -40, "#3b82f6"), (-90, 80, "#a855f7")))
            + '<g transform="rotate(35)"><rect x="-10" y="-210" width="20" height="200" rx="8" fill="#92400e"/><path d="M-12 -210 Q0 -260 12 -210Z" fill="#111827"/></g>')


def t_ballot() -> str:
    return (shadow(0, 150, 200) + '<path d="M-170 -40 L-140 -80 H140 L170 -40Z" fill="#93c5fd"/><rect x="-170" y="-40" width="340" height="190" rx="10" fill="#dbeafe" stroke="#3b82f6" stroke-width="8"/>'
            '<rect x="-80" y="-66" width="160" height="14" rx="6" fill="#1e3a8a"/><g transform="translate(0 -110) rotate(-6)"><rect x="-70" y="-120" width="140" height="160" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="4"/>'
            '<rect x="-50" y="-96" width="24" height="24" fill="none" stroke="#1e3a8a" stroke-width="5"/><path d="M-48 -86 l10 10 18 -22" stroke="#16a34a" stroke-width="7" fill="none"/>'
            '<line x1="-10" y1="-84" x2="50" y2="-84" stroke="#94a3b8" stroke-width="6"/><rect x="-50" y="-50" width="24" height="24" fill="none" stroke="#1e3a8a" stroke-width="5"/><line x1="-10" y1="-38" x2="50" y2="-38" stroke="#94a3b8" stroke-width="6"/></g>'
            '<text x="0" y="90" text-anchor="middle" font-family="Arial" font-weight="800" font-size="44" fill="#1e3a8a">VOTO</text>')


def t_podium() -> str:
    return (shadow(0, 150, 160) + '<path d="M-120 -20 H120 L100 150 H-100Z" fill="#1e3a8a"/><rect x="-140" y="-40" width="280" height="30" rx="6" fill="#1d4ed8"/>'
            '<circle cx="0" cy="50" r="38" fill="#facc15"/><path d="M0 28 l7 14 16 2 -12 11 3 16 -14 -8 -14 8 3 -16 -12 -11 16 -2z" fill="#1e3a8a"/>'
            '<path d="M-30 -40 Q-40 -110 0 -140" fill="none" stroke="#111827" stroke-width="8"/><rect x="-10" y="-176" width="34" height="50" rx="14" fill="#111827" transform="rotate(20 0 -150)"/>')


def t_columns() -> str:
    return (shadow(0, 150, 200) + '<path d="M-200 -70 L0 -160 L200 -70Z" fill="#e7e5e4" stroke="#a8a29e" stroke-width="6"/><rect x="-200" y="-70" width="400" height="24" fill="#d6d3d1"/>'
            + "".join(f'<rect x="{x}" y="-46" width="36" height="150" fill="#f5f5f4" stroke="#d6d3d1" stroke-width="3"/>' for x in (-180, -100, -18, 64, 144))
            + '<rect x="-210" y="104" width="420" height="22" fill="#a8a29e"/><rect x="-230" y="126" width="460" height="22" fill="#78716c"/>')


def t_newspaper() -> str:
    return (shadow(0, 140, 190) + '<rect x="-180" y="-140" width="360" height="270" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="4" transform="rotate(-5)"/>'
            '<g transform="rotate(-5)"><rect x="-160" y="-120" width="320" height="44" fill="#111827"/><text x="0" y="-86" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="34" fill="#f8fafc">DIARIO</text>'
            '<rect x="-160" y="-60" width="150" height="100" fill="#94a3b8"/>' + "".join(f'<rect x="10" y="{-60 + i * 18}" width="150" height="8" fill="#cbd5e1"/>' for i in range(6))
            + "".join(f'<rect x="-160" y="{56 + i * 18}" width="320" height="8" fill="#cbd5e1"/>' for i in range(4)) + '</g>')


def t_chart() -> str:
    return (shadow(0, 150, 200) + '<rect x="-200" y="-140" width="400" height="270" rx="16" fill="#0f172a"/><g stroke="#1e293b" stroke-width="2">' + "".join(f'<line x1="-180" y1="{y}" x2="180" y2="{y}"/>' for y in range(-110, 120, 40)) + '</g>'
            + "".join(f'<rect x="{-160 + i * 64}" y="{100 - h}" width="40" height="{h}" rx="4" fill="#22c55e" opacity=".85"/>' for i, h in enumerate((60, 90, 70, 130, 170, 200)))
            + '<path d="M-160 50 L-90 20 L-30 40 L30 -30 L100 -70 L170 -120" fill="none" stroke="#facc15" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M170 -120 l-34 4 l20 26z" fill="#facc15"/>')


def t_coins() -> str:
    stack = lambda x, n: "".join(f'<ellipse cx="{x}" cy="{100 - i * 22}" rx="70" ry="22" fill="#f59e0b" stroke="#b45309" stroke-width="4"/>' for i in range(n))
    return (shadow(0, 130, 220) + stack(-120, 4) + stack(0, 7) + stack(120, 5)
            + '<circle cx="60" cy="-120" r="70" fill="#fbbf24" stroke="#b45309" stroke-width="8"/><text x="60" y="-96" text-anchor="middle" font-family="Arial" font-weight="800" font-size="72" fill="#b45309">€</text>')


def t_piggy() -> str:
    return (shadow(0, 140, 180) + '<ellipse cx="0" cy="10" rx="170" ry="120" fill="#f9a8d4"/><circle cx="-130" cy="-20" r="20" fill="#f472b6"/><ellipse cx="-175" cy="10" rx="34" ry="28" fill="#f472b6"/>'
            '<circle cx="-185" cy="4" r="5" fill="#9d174d"/><circle cx="-165" cy="4" r="5" fill="#9d174d"/><circle cx="-100" cy="-40" r="10" fill="#111827"/><path d="M-80 -110 l30 -40 l20 46z" fill="#f472b6"/>'
            + "".join(f'<rect x="{x}" y="100" width="34" height="50" rx="8" fill="#f472b6"/>' for x in (-110, -40, 50, 110))
            + '<rect x="-30" y="-115" width="70" height="12" rx="6" fill="#9d174d"/><circle cx="5" cy="-160" r="34" fill="#fbbf24" stroke="#b45309" stroke-width="6"/>')


def t_briefcase() -> str:
    return (shadow(0, 140, 190) + '<rect x="-60" y="-140" width="120" height="50" rx="14" fill="none" stroke="#451a03" stroke-width="16"/><rect x="-190" y="-100" width="380" height="230" rx="20" fill="#92400e"/>'
            '<rect x="-190" y="-10" width="380" height="14" fill="#451a03"/><rect x="-26" y="-24" width="52" height="40" rx="6" fill="#fbbf24"/>')


def t_bulb() -> str:
    return ('<circle r="140" fill="#fde047" opacity=".25"/><path d="M0 -150 C90 -150 120 -60 80 0 C50 40 50 60 50 90 H-50 C-50 60 -50 40 -80 0 C-120 -60 -90 -150 0 -150Z" fill="#fde047"/>'
            '<rect x="-50" y="90" width="100" height="22" fill="#9ca3af"/><rect x="-46" y="114" width="92" height="20" fill="#6b7280"/><rect x="-30" y="136" width="60" height="18" rx="8" fill="#4b5563"/>'
            '<path d="M-20 80 V0 L0 -30 L20 0 V80" fill="none" stroke="#f59e0b" stroke-width="6"/>')


def t_rocket() -> str:
    return ('<g transform="rotate(35)"><path d="M0 -200 C80 -120 80 0 60 80 H-60 C-80 0 -80 -120 0 -200Z" fill="#f8fafc"/><circle cy="-60" r="34" fill="#38bdf8" stroke="#1e3a8a" stroke-width="8"/>'
            '<path d="M-60 20 L-120 120 L-60 90Z M60 20 L120 120 L60 90Z" fill="#ef4444"/><path d="M-40 80 Q0 220 40 80Z" fill="#f97316"/><path d="M-20 80 Q0 170 20 80Z" fill="#fde047"/></g>')


def t_globe() -> str:
    return (shadow(0, 160, 120) + '<circle r="150" fill="#38bdf8"/><path d="M-90 -100 Q-40 -120 -20 -80 Q-60 -40 -30 0 Q-80 20 -110 -20 Q-140 -60 -90 -100Z M30 -130 Q90 -110 120 -40 Q70 -20 60 30 Q100 60 80 110 Q20 90 30 30 Q0 -20 40 -60 Q10 -100 30 -130Z M-80 60 Q-40 70 -40 120 Q-90 110 -80 60Z" fill="#22c55e"/>'
            '<circle r="150" fill="none" stroke="#0369a1" stroke-width="6"/><ellipse rx="150" ry="50" fill="none" stroke="#fff" stroke-width="3" opacity=".4"/><ellipse rx="60" ry="150" fill="none" stroke="#fff" stroke-width="3" opacity=".4"/>')


def t_plane() -> str:
    return ('<g transform="rotate(-15)"><path d="M-200 0 Q-200 -26 -170 -26 H150 Q210 -26 210 0 Q210 26 150 26 H-170 Q-200 26 -200 0Z" fill="#f8fafc"/>'
            '<path d="M-20 -20 L-110 -150 H-60 L60 -20Z M-20 20 L-110 150 H-60 L60 20Z" fill="#cbd5e1"/><path d="M-170 -20 L-200 -90 H-160 L-120 -20Z" fill="#ef4444"/>'
            + "".join(f'<circle cx="{x}" cy="-6" r="7" fill="#38bdf8"/>' for x in range(-110, 140, 30)) + '</g>')


def t_train() -> str:
    return (shadow(0, 150, 230) + '<rect x="-220" y="-110" width="440" height="220" rx="40" fill="#dc2626"/><rect x="-200" y="-80" width="140" height="80" rx="10" fill="#bae6fd"/><rect x="-40" y="-80" width="100" height="80" rx="10" fill="#bae6fd"/>'
            '<rect x="80" y="-80" width="120" height="80" rx="10" fill="#bae6fd"/><rect x="-220" y="40" width="440" height="20" fill="#f8fafc"/>' + "".join(f'<circle cx="{x}" cy="120" r="34" fill="#111827"/><circle cx="{x}" cy="120" r="12" fill="#9ca3af"/>' for x in (-150, -60, 60, 150)))


def t_suitcase() -> str:
    return (shadow(0, 150, 160) + '<rect x="-50" y="-170" width="100" height="50" rx="14" fill="none" stroke="#374151" stroke-width="14"/><rect x="-150" y="-130" width="300" height="270" rx="28" fill="#0ea5e9"/>'
            + "".join(f'<rect x="{x}" y="-130" width="18" height="270" fill="#0369a1"/>' for x in (-90, 72))
            + '<circle cx="-100" cy="150" r="16" fill="#111827"/><circle cx="100" cy="150" r="16" fill="#111827"/><rect x="-60" y="-60" width="80" height="50" rx="8" fill="#fde047" transform="rotate(-10)"/><circle cx="60" cy="40" r="30" fill="#f472b6"/>')


def t_dice() -> str:
    die = lambda x, y, r, dots: (f'<g transform="translate({x} {y}) rotate({r})"><rect x="-80" y="-80" width="160" height="160" rx="26" fill="#f8fafc" stroke="#cbd5e1" stroke-width="6"/>'
                                 + "".join(f'<circle cx="{dx}" cy="{dy}" r="14" fill="#dc2626"/>' for dx, dy in dots) + '</g>')
    return shadow(0, 140, 200) + die(-90, 20, -12, ((-40, -40), (0, 0), (40, 40))) + die(100, -10, 14, ((-40, -40), (40, -40), (-40, 40), (40, 40), (0, 0)))


def t_gamepad() -> str:
    return (shadow(0, 130, 210) + '<path d="M-150 -70 H150 Q220 -70 230 20 Q240 120 180 120 Q140 120 110 60 H-110 Q-140 120 -180 120 Q-240 120 -230 20 Q-220 -70 -150 -70Z" fill="#4338ca"/>'
            '<path d="M-150 -30 V40 M-185 5 H-115" stroke="#e0e7ff" stroke-width="22" stroke-linecap="round"/>' + "".join(f'<circle cx="{x}" cy="{y}" r="16" fill="{c}"/>' for x, y, c in ((140, -20, "#22c55e"), (175, 10, "#ef4444"), (105, 10, "#3b82f6"), (140, 40, "#facc15"))))


def t_gift() -> str:
    return (shadow(0, 150, 170) + '<rect x="-150" y="-40" width="300" height="180" rx="10" fill="#dc2626"/><rect x="-170" y="-90" width="340" height="60" rx="10" fill="#ef4444"/>'
            '<rect x="-20" y="-90" width="40" height="230" fill="#facc15"/><path d="M0 -90 C-40 -170 -140 -150 -90 -100 Z M0 -90 C40 -170 140 -150 90 -100 Z" fill="none" stroke="#facc15" stroke-width="18"/>')


def t_tree_xmas() -> str:
    return (shadow(0, 160, 150) + '<rect x="-20" y="120" width="40" height="40" fill="#78350f"/><path d="M0 -180 L80 -60 H40 L110 40 H60 L140 130 H-140 L-60 40 H-110 L-40 -60 H-80Z" fill="#15803d"/>'
            + "".join(f'<circle cx="{x}" cy="{y}" r="12" fill="{c}"/>' for x, y, c in ((-30, -60, "#ef4444"), (40, -20, "#facc15"), (-60, 40, "#38bdf8"), (60, 80, "#ef4444"), (-10, 100, "#facc15"), (10, 10, "#a855f7")))
            + t_star("#fde047", 34).replace("<polygon", '<polygon transform="translate(0 -185)"'))


def t_balloons() -> str:
    return "".join(f'<g transform="translate({x} {y})"><path d="M0 70 Q-10 150 10 220" stroke="#fff" stroke-width="3" fill="none"/><ellipse rx="60" ry="76" fill="{c}"/><ellipse cx="-20" cy="-28" rx="14" ry="22" fill="#fff" opacity=".35"/><path d="M-8 74 h16 l-8 -10z" fill="{c}"/></g>'
                   for x, y, c in ((-110, -40, "#f43f5e"), (0, -90, "#facc15"), (110, -40, "#22d3ee")))


def t_dog() -> str:
    return (shadow(0, 150, 170) + '<ellipse cx="0" cy="70" rx="140" ry="80" fill="#d97706"/><circle cx="-110" cy="-40" r="80" fill="#f59e0b"/><ellipse cx="-180" cy="-20" rx="40" ry="30" fill="#fde68a"/>'
            '<circle cx="-210" cy="-26" r="12" fill="#111827"/><circle cx="-120" cy="-60" r="10" fill="#111827"/><path d="M-80 -110 Q-30 -150 -40 -60 Q-60 -80 -80 -110Z" fill="#92400e"/>'
            + "".join(f'<rect x="{x}" y="110" width="36" height="60" rx="12" fill="#d97706"/>' for x in (-110, -40, 40, 100)) + '<path d="M130 40 Q200 -40 180 -80" stroke="#d97706" stroke-width="24" fill="none" stroke-linecap="round"/>'
            '<rect x="-160" y="10" width="100" height="18" rx="8" fill="#ef4444"/>')


def t_heart() -> str:
    return (shadow(0, 150, 130) + '<path d="M0 140 C-180 20 -180 -120 -80 -130 C-30 -135 0 -100 0 -70 C0 -100 30 -135 80 -130 C180 -120 180 20 0 140Z" fill="#f43f5e"/>'
            '<path d="M-90 -90 Q-130 -60 -110 -10" stroke="#fff" stroke-width="14" fill="none" opacity=".4" stroke-linecap="round"/>')


def t_plant() -> str:
    return (shadow(0, 150, 110) + '<path d="M-90 40 H90 L70 150 H-70Z" fill="#c2410c"/><rect x="-100" y="20" width="200" height="30" rx="8" fill="#ea580c"/>'
            '<path d="M0 30 V-80" stroke="#15803d" stroke-width="10"/><path d="M0 -20 Q-110 -40 -110 -140 Q-20 -120 0 -20Z M0 -50 Q110 -70 110 -170 Q20 -150 0 -50Z M0 -80 Q-40 -160 0 -210 Q40 -160 0 -80Z" fill="#22c55e"/>')


def t_basket() -> str:
    return (shadow(0, 140, 180) + '<path d="M-110 -40 Q0 -200 110 -40" fill="none" stroke="#92400e" stroke-width="16"/><path d="M-170 -40 H170 L140 130 H-140Z" fill="#d97706"/>'
            + "".join(f'<line x1="{x}" y1="-40" x2="{x * .82}" y2="130" stroke="#92400e" stroke-width="5"/>' for x in range(-150, 160, 30)) + "".join(f'<line x1="{-170 + i * 4}" y1="{-10 + i * 30}" x2="{170 - i * 4}" y2="{-10 + i * 30}" stroke="#92400e" stroke-width="5"/>' for i in range(5))
            + '<path d="M-170 -40 H170 V-10 H-170Z" fill="#ef4444"/>' + "".join(f'<rect x="{-170 + i * 40}" y="-40" width="20" height="30" fill="#fff"/>' for i in range(9))
            + '<circle cx="-60" cy="-70" r="30" fill="#ef4444"/><circle cx="30" cy="-80" r="26" fill="#84cc16"/><path d="M80 -70 q30 -40 60 0 q-30 20 -60 0z" fill="#fde047"/>')


def t_calendar() -> str:
    return (shadow(0, 150, 170) + '<rect x="-160" y="-120" width="320" height="270" rx="20" fill="#f8fafc"/><rect x="-160" y="-120" width="320" height="70" rx="20" fill="#ef4444"/><rect x="-160" y="-70" width="320" height="20" fill="#ef4444"/>'
            '<rect x="-110" y="-150" width="22" height="60" rx="10" fill="#475569"/><rect x="88" y="-150" width="22" height="60" rx="10" fill="#475569"/>'
            + "".join(f'<rect x="{-130 + (i % 5) * 54}" y="{-30 + (i // 5) * 50}" width="40" height="36" rx="6" fill="{"#fde047" if i == 8 else "#e2e8f0"}"/>' for i in range(15)))


def t_laptop() -> str:
    return (shadow(0, 140, 230) + '<rect x="-170" y="-140" width="340" height="220" rx="16" fill="#1f2937"/><rect x="-150" y="-120" width="300" height="180" fill="#38bdf8"/>'
            '<path d="M-220 90 H220 L190 130 H-190Z" fill="#9ca3af"/><circle cx="-60" cy="-50" r="34" fill="#f8fafc"/><circle cx="60" cy="-50" r="34" fill="#fde047"/><rect x="-100" y="0" width="200" height="22" rx="10" fill="#f8fafc" opacity=".7"/>')


def t_chat() -> str:
    return ('<path d="M-200 -120 H40 Q70 -120 70 -90 V0 Q70 30 40 30 H-110 L-160 80 V30 H-200 Q-230 30 -230 0 V-90 Q-230 -120 -200 -120Z" fill="#3b82f6"/>'
            '<path d="M200 -40 H-20 Q-50 -40 -50 -10 V80 Q-50 110 -20 110 H120 L170 160 V110 H200 Q230 110 230 80 V-10 Q230 -40 200 -40Z" fill="#22c55e"/>'
            '<g fill="#fff"><circle cx="-130" cy="-45" r="14"/><circle cx="-80" cy="-45" r="14"/><circle cx="-30" cy="-45" r="14"/></g><g fill="#fff" font-family="Arial" font-weight="700" font-size="44"><text x="40" y="52">Hi!</text></g>')


def t_gradcap() -> str:
    return (shadow(0, 140, 170) + '<path d="M-100 0 V80 Q0 140 100 80 V0" fill="#1e293b"/><path d="M-220 -40 L0 -140 L220 -40 L0 60Z" fill="#334155"/>'
            '<path d="M180 -30 V80" stroke="#facc15" stroke-width="8"/><circle cx="180" cy="90" r="16" fill="#facc15"/>')


def t_users() -> str:
    person = lambda x, s, c: f'<g transform="translate({x} 0) scale({s})"><circle cy="-80" r="50" fill="#fde68a"/><path d="M-90 120 Q-90 -10 0 -10 Q90 -10 90 120Z" fill="{c}"/></g>'
    return shadow(0, 140, 230) + person(-130, .85, "#22c55e") + person(130, .85, "#f97316") + person(0, 1.05, "#3b82f6")


def t_network() -> str:
    pts = ((0, -120), (-150, -20), (150, -30), (-90, 120), (100, 120))
    return ("".join(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="#e0f2fe" stroke-width="8"/>' for i, a in enumerate(pts) for b in pts[i + 1:])
            + "".join(f'<circle cx="{x}" cy="{y}" r="46" fill="{c}" stroke="#fff" stroke-width="8"/>' for (x, y), c in zip(pts, ("#3b82f6", "#22c55e", "#f97316", "#a855f7", "#ef4444"))))


def t_link() -> str:
    return t_laptop()


def t_party() -> str:
    return ('<g transform="rotate(-20)"><path d="M-120 150 L0 -170 L120 150Z" fill="#a855f7"/>' + "".join(f'<path d="M{-120 + i * 24} {150 - i * 64} L{120 - i * 24} {150 - i * 64}" stroke="#fde047" stroke-width="16"/>' for i in range(1, 5))
            + '<circle cx="0" cy="-180" r="22" fill="#f43f5e"/></g>')


def t_dancers() -> str:
    one = lambda x, c, r: (f'<g transform="translate({x} 0) rotate({r})"><circle cy="-130" r="30" fill="#fde68a"/><path d="M0 -100 L0 30" stroke="{c}" stroke-width="30" stroke-linecap="round"/>'
                           f'<path d="M0 -80 L-70 -140 M0 -80 L70 -40" stroke="#fde68a" stroke-width="16" stroke-linecap="round"/><path d="M0 30 L-50 140 M0 30 L50 140" stroke="#1f2937" stroke-width="20" stroke-linecap="round"/>'
                           f'<path d="M-50 10 Q0 90 50 10Z" fill="{c}"/></g>')
    return shadow(0, 150, 200) + one(-80, "#e11d48", -8) + one(80, "#2563eb", 8)


def t_leaf() -> str:
    return t_plant()


def t_pan() -> str:
    return t_paella()


def t_umbrella() -> str:
    return (shadow(60, 150, 150) + '<line x1="0" y1="-120" x2="60" y2="150" stroke="#78350f" stroke-width="10"/>'
            '<path d="M-200 -60 Q-10 -230 180 -60 Q140 -90 90 -60 Q40 -100 -10 -60 Q-60 -100 -110 -60 Q-150 -90 -200 -60Z" fill="#ef4444"/>'
            '<path d="M-10 -170 Q-60 -110 -110 -60 Q-60 -100 -10 -60Z M-10 -170 Q40 -110 90 -60 Q40 -100 -10 -60Z" fill="#f8fafc"/>'
            '<rect x="-60" y="110" width="140" height="22" rx="8" fill="#38bdf8" transform="rotate(-6)"/>')


def t_golf() -> str:
    return (shadow(0, 140, 160) + '<g transform="rotate(25)"><rect x="-8" y="-230" width="16" height="320" rx="6" fill="#9ca3af"/><path d="M-10 80 H70 Q90 80 90 100 V110 H-10Z" fill="#475569"/><rect x="-14" y="-240" width="28" height="70" rx="10" fill="#111827"/></g>'
            '<circle cx="-90" cy="110" r="42" fill="#f8fafc" stroke="#cbd5e1" stroke-width="4"/>' + "".join(f'<circle cx="{-90 + dx}" cy="{110 + dy}" r="4" fill="#cbd5e1"/>' for dx, dy in ((-14, -10), (8, -16), (16, 6), (-6, 12), (-20, 8), (4, 0))))


def t_skis() -> str:
    return (shadow(0, 150, 170) + '<g transform="rotate(-25)"><rect x="-80" y="-200" width="34" height="380" rx="17" fill="#ef4444"/><rect x="40" y="-200" width="34" height="380" rx="17" fill="#2563eb"/>'
            '<rect x="-92" y="-10" width="58" height="40" rx="8" fill="#111827"/><rect x="28" y="-10" width="58" height="40" rx="8" fill="#111827"/></g>'
            '<g stroke="#374151" stroke-width="8" stroke-linecap="round"><line x1="-170" y1="-170" x2="-110" y2="170"/><line x1="170" y1="-170" x2="110" y2="170"/></g>'
            '<circle cx="-115" cy="140" r="16" fill="none" stroke="#374151" stroke-width="5"/><circle cx="115" cy="140" r="16" fill="none" stroke="#374151" stroke-width="5"/>')


def t_gloves() -> str:
    glove = lambda x, r, c: (f'<g transform="translate({x} 0) rotate({r})"><path d="M-70 -40 Q-80 -130 0 -130 Q90 -130 80 -30 Q80 40 40 60 H-40 Q-80 40 -70 -40Z" fill="{c}"/>'
                             f'<path d="M-70 -20 Q-110 -30 -100 20 Q-90 50 -60 40" fill="{c}"/><rect x="-46" y="56" width="92" height="70" rx="10" fill="#f8fafc"/><rect x="-46" y="80" width="92" height="12" fill="{c}"/>'
                             '<path d="M-30 -100 Q20 -120 50 -80" stroke="#fff" stroke-width="10" fill="none" opacity=".35"/></g>')
    return shadow(0, 150, 200) + glove(-90, -18, "#dc2626") + glove(90, 18, "#dc2626")


def t_pingpong() -> str:
    return ('<g transform="rotate(-30)"><circle cx="0" cy="-50" r="100" fill="#dc2626" stroke="#111827" stroke-width="10"/><rect x="-18" y="40" width="36" height="120" rx="10" fill="#92400e"/></g>'
            '<circle cx="150" cy="-110" r="28" fill="#f8fafc" stroke="#e5e7eb" stroke-width="3"/>')


def t_skateboard() -> str:
    return (shadow(0, 110, 200) + '<g transform="rotate(-12)"><rect x="-220" y="-30" width="440" height="50" rx="25" fill="#7c3aed"/><path d="M-140 -10 h60 M-20 -10 h60 M100 -10 h40" stroke="#fde047" stroke-width="10" stroke-linecap="round"/>'
            '<rect x="-160" y="20" width="60" height="14" fill="#9ca3af"/><rect x="100" y="20" width="60" height="14" fill="#9ca3af"/>'
            + "".join(f'<circle cx="{x}" cy="56" r="26" fill="#f97316"/><circle cx="{x}" cy="56" r="10" fill="#fde68a"/>' for x in (-160, -100, 100, 160)) + '</g>')


THINGS = {
    "soccer": t_soccer, "basketball": t_basketball, "tennisball": t_tennisball, "racket": t_racket, "padel": t_padel,
    "volley": t_volley, "bike": t_bike, "dumbbell": t_dumbbell, "kettlebell": t_kettlebell, "shoe": t_shoe,
    "stopwatch": t_stopwatch, "trophy": t_trophy, "medal": t_medal, "whistle": t_whistle, "swimmer": t_swimmer,
    "surf": t_surf, "kayak": t_kayak, "sailboat": t_sailboat, "fish": t_fish, "tent": t_tent, "fire": t_fire,
    "sun": t_sun, "moon": t_moon, "star": t_star, "map": t_map, "camera": t_camera, "car": t_car, "moto": t_moto,
    "helmet": t_helmet, "flag": t_flag, "steering": t_steering, "coffee": t_coffee, "beer": t_beer,
    "cocktail": t_cocktail, "wine": t_wine, "plate": t_plate, "pizza": t_pizza, "burger": t_burger, "cake": t_cake,
    "paella": t_paella, "chef": t_chef, "guitar": t_guitar, "mic": t_mic, "drum": t_drum, "keys": t_keys,
    "vinyl": t_vinyl, "headphones": t_headphones, "disco": t_disco, "film": t_film, "popcorn": t_popcorn,
    "masks": t_masks, "books": t_books, "palette": t_palette, "ballot": t_ballot, "podium": t_podium,
    "columns": t_columns, "newspaper": t_newspaper, "chart": t_chart, "coins": t_coins, "piggy": t_piggy,
    "briefcase": t_briefcase, "bulb": t_bulb, "rocket": t_rocket, "globe": t_globe, "plane": t_plane,
    "train": t_train, "suitcase": t_suitcase, "dice": t_dice, "gamepad": t_gamepad, "gift": t_gift,
    "xmas_tree": t_tree_xmas, "balloons": t_balloons, "dog": t_dog, "heart": t_heart, "plant": t_plant,
    "basket": t_basket, "calendar": t_calendar, "laptop": t_laptop, "chat": t_chat, "gradcap": t_gradcap,
    "users": t_users, "network": t_network, "party": t_party, "dancers": t_dancers, "hoop": p_hoop,
    "umbrella": t_umbrella, "golf": t_golf, "skis": t_skis, "gloves": t_gloves, "pingpong": t_pingpong, "skateboard": t_skateboard,
}
