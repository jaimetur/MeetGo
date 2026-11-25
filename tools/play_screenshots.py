"""Google Play store screenshots of MeetGo, in every language and for every device Play asks for.

For each language it starts MeetGo on a fresh database, creates the reviewer's demo account with its content in that
language (app.demo.play_review --lang), and photographs the same screens on a phone, a 7" and a 10" tablet and a
Chromebook. They land in assets/play-store/<device>/<lang>/N-screen.jpg, ready to upload to each language of the store
listing (Play Console → Main store listing → Manage translations), or to send with the Play Developer API.

Needs a Postgres server and a Redis it can use (a database "meetgo_play" is created and dropped on it), the backend's
virtual environment and the frontend's node_modules, and Playwright with Chromium:

    .venv/bin/pip install playwright && .venv/bin/playwright install chromium
    .venv/bin/python tools/play_screenshots.py --pg postgresql://postgres:test@127.0.0.1:55432 --redis redis://127.0.0.1:56379/14

Options: --langs es,en (default: all) and --devices phone,tablet7,tablet10,chromebook (default: all).
The GitHub workflow .github/workflows/play-screenshots.yml runs it and commits the images when the app changes.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "src" / "backend"
FRONTEND = ROOT / "src" / "frontend"
OUT = ROOT / "assets" / "play-store"
LANGS = ["es", "en", "ca", "de", "fr", "it", "pt", "nl", "ja", "zh"]
LOCALES = {"es": "es-ES", "en": "en-US", "ca": "ca-ES", "de": "de-DE", "fr": "fr-FR", "it": "it-IT", "pt": "pt-PT",
           "nl": "nl-NL", "ja": "ja-JP", "zh": "zh-CN"}
DEVICES = {  # folder: css width, css height, scale (the PNG is width*scale x height*scale)
    "phone": (360, 640, 3),         # 1080 x 1920
    "tablet7": (600, 960, 2),       # 1200 x 1920
    "tablet10": (800, 1280, 2),     # 1600 x 2560
    "chromebook": (1440, 810, 2),   # 2880 x 1620
}
API_PORT, WEB_PORT = 18190, 5190
API = f"http://127.0.0.1:{API_PORT}"
WEB = f"http://127.0.0.1:{WEB_PORT}/app"
DB = "meetgo_play"
EMAIL = "playreview@example.com"
PASSWORD = "play-screens-1"


def call(method: str, path: str, body: dict | None = None, token: str | None = None, lang: str = "es") -> dict:
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "X-Lang": lang,
                                          **({"Authorization": f"Bearer {token}"} if token else {})})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"null")


def wait_for(url: str, seconds: int = 90) -> None:
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3)
            return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.5)
    raise SystemExit(f"{url} did not answer")


async def sql(server: str, database: str, statements: list[str], fetch: str | None = None):
    import asyncpg
    conn = await asyncpg.connect(f"{server}/{database}")
    try:
        for s in statements:
            await conn.execute(s)
        return [dict(r) for r in await conn.fetch(fetch)] if fetch else None
    finally:
        await conn.close()


def run(coro):
    """Run a coroutine in its own thread (Playwright's sync API already runs an event loop in this one)."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(1) as pool:
        return pool.submit(asyncio.run, coro).result()


def fresh_database(server: str) -> None:
    run(sql(server, "postgres", [
        f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DB}' AND pid <> pg_backend_pid()",
        f"DROP DATABASE IF EXISTS {DB}", f"CREATE DATABASE {DB}"]))


def start_api(server: str, redis: str, data_dir: str) -> subprocess.Popen:
    env = {**os.environ, "DATABASE_URL": server.replace("postgresql://", "postgresql+asyncpg://") + f"/{DB}",
           "REDIS_URL": redis, "DATA_DIR": data_dir, "MEETGO_ENV": "dev"}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(API_PORT)], cwd=BACKEND, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    wait_for(API + "/healthz")
    return proc


def demo_account(server: str, redis: str, data_dir: str, lang: str) -> dict:
    """The reviewer's account with its demo content in `lang`; the ids of the screens to photograph."""
    call("POST", "/auth/register", {"email": EMAIL, "phone": "600111222", "password": PASSWORD, "display_name": "alex",
                                    "first_name": "Alex", "last_name": "Demo", "dob": "1990-06-15", "country": "ES",
                                    "province": "Madrid", "accept_dm": True}, lang=lang)
    run(sql(server, DB, [f"UPDATE users SET email_verified = true, lang = '{lang}' WHERE email = '{EMAIL}'"]))
    env = {**os.environ, "DATABASE_URL": server.replace("postgresql://", "postgresql+asyncpg://") + f"/{DB}",
           "REDIS_URL": redis, "DATA_DIR": data_dir}
    subprocess.run([sys.executable, "-m", "app.demo.play_review", EMAIL, "--lang", lang], cwd=BACKEND, env=env, check=True,
                   stdout=subprocess.DEVNULL)
    token = call("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD}, lang=lang)["access_token"]
    rows = run(sql(server, DB, [], fetch="""
        SELECT c.id AS conv, i.slug, p.id AS post, p.kind, p.chat_conversation_id AS plan_chat
        FROM conversations c JOIN interests i ON i.id = c.interest_id
        LEFT JOIN board_posts p ON p.conversation_id = c.id AND p.deleted_at IS NULL
        WHERE c.kind = 'channel' AND i.slug = 'senderismo'"""))
    hike = next(r for r in rows if r["kind"] == "meetup")
    return {"token": token, "community": hike["conv"], "plan": hike["post"], "plan_chat": hike["plan_chat"]}


# A new screenshot replaces the stored one only when more than this share of its pixels changed visibly: the times of
# the made-up messages move a little between runs (well under 0.1 %), a real change of the app is far more.
CHANGED_SHARE = 0.005
STILL_CSS = "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }"


def changed(new: bytes, old_path: Path) -> bool:
    """Whether `new` looks different from the image already in `old_path` (missing, another size or enough pixels)."""
    if not old_path.exists():
        return True
    import io
    from PIL import Image, ImageChops
    a = Image.open(io.BytesIO(new)).convert("RGB")
    b = Image.open(old_path).convert("RGB")
    if a.size != b.size:
        return True
    diff = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 40 else 0)
    return diff.histogram()[255] / (a.size[0] * a.size[1]) > CHANGED_SHARE


def wait_still(page, seconds: float = 8) -> None:
    """Until nothing scrolls or appears for a moment (the chat jumps to the new messages after loading)."""
    probe = "JSON.stringify([document.body.innerText.length, ...[...document.querySelectorAll('*')].filter(e => e.scrollTop > 0).map(e => Math.round(e.scrollTop))])"
    last, same, end = None, 0, time.time() + seconds
    while time.time() < end and same < 3:
        time.sleep(0.3)
        now = page.evaluate(probe)
        same = same + 1 if now == last else 0
        last = now


def shoot(browser, ids: dict, lang: str, devices: list[str]) -> int:
    screens = [("1-home", "/"), ("2-communities", "/communities"), ("3-community", f"/communities/{ids['community']}"),
               ("4-agenda", f"/communities/{ids['community']}?tab=agenda"), ("5-plan", f"/p/{ids['plan']}"),
               ("6-community-chat", f"/c/{ids['community']}"), ("7-plan-chat", f"/c/{ids['plan_chat']}")]
    for device in devices:
        w, h, scale = DEVICES[device]
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale, locale=LOCALES[lang],
                                  timezone_id="Europe/Madrid", is_mobile=w < 800, has_touch=w < 800, reduced_motion="reduce")
        ctx.add_init_script(f"""localStorage.setItem('token', {ids['token']!r}); localStorage.setItem('lang', {lang!r});
            localStorage.setItem('theme', 'dark'); localStorage.setItem('installHintDismissed', '1');
            sessionStorage.setItem('splashSeen', '1');""")
        page = ctx.new_page()
        out = OUT / device / lang
        out.mkdir(parents=True, exist_ok=True)
        kept = 0
        for name, path in screens:
            page.goto(WEB + path, wait_until="networkidle")
            page.add_style_tag(content=STILL_CSS)
            time.sleep(0.8)
            wait_still(page)
            if path.startswith("/c/"):
                # a chat may stop at the new-messages line or further down depending on timing: always at the latest
                for _ in range(3):
                    page.evaluate("document.querySelectorAll('[data-virtuoso-scroller], .msgs').forEach(e => { e.scrollTop = e.scrollHeight; })")
                    wait_still(page)
            # JPEG: Play takes it and it weighs a fifth of the PNG (280 images go in the repository)
            shot = page.screenshot(type="jpeg", quality=90)
            target = out / f"{name}.jpg"
            if changed(shot, target):
                target.write_bytes(shot)
            else:
                kept += 1
        ctx.close()
        print(f"  {device}: {len(screens) - kept} changed, {kept} as they were", flush=True)
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pg", required=True, help="Postgres server URL without database, e.g. postgresql://user:pass@host:5432")
    ap.add_argument("--redis", required=True, help="Redis URL, e.g. redis://127.0.0.1:6379/14")
    ap.add_argument("--langs", default=",".join(LANGS))
    ap.add_argument("--devices", default=",".join(DEVICES))
    args = ap.parse_args()
    langs = [x for x in args.langs.split(",") if x in LANGS]
    devices = [x for x in args.devices.split(",") if x in DEVICES]
    from playwright.sync_api import sync_playwright

    web = subprocess.Popen(["npx", "vite", "--port", str(WEB_PORT), "--strictPort", "--host", "127.0.0.1"], cwd=FRONTEND,
                           env={**os.environ, "VITE_ROOT": "web_user", "VITE_API_BASE": API},
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        wait_for(WEB + "/")
        with sync_playwright() as p, tempfile.TemporaryDirectory() as data_dir:
            browser = p.chromium.launch()
            for lang in langs:
                print(lang, flush=True)
                fresh_database(args.pg)
                api = start_api(args.pg, args.redis, data_dir)
                try:
                    shoot(browser, demo_account(args.pg, args.redis, data_dir, lang), lang, devices)
                finally:
                    api.terminate()
                    api.wait(timeout=20)
            browser.close()
    finally:
        web.terminate()
    print(f"Done: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
