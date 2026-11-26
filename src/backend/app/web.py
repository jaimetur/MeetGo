"""The web site (landing and the app under /app/) and the old administration address, served by this same process.

The container listens on three ports (app/serve.py): `API_PORT` for the API (api.meetgo.app), `WEB_PORT` for the web
site (www.meetgo.app) and `ADMIN_PORT` for admin.meetgo.app, which only sends people to the administration inside the
app. Requests are told apart by the port they arrive on, so nothing depends on the reverse proxy's Host header.

The web files come from `/srv/web-hot` when it holds a build (the stack folder's `web/`, copied there by a deploy
without rebuilding anything), else from `/srv/web` (the build inside the image). Same rules as the nginx that used to
serve them: hashed assets cached for good, the service worker / manifest / version always fresh, /app/* is the
single-page app, and the other pages are their .html file.
"""

from __future__ import annotations

import os
from pathlib import Path

from starlette.responses import FileResponse, PlainTextResponse, RedirectResponse
from starlette.types import ASGIApp, Receive, Scope, Send

API_PORT = int(os.getenv("API_PORT", "8000"))
WEB_PORT = int(os.getenv("WEB_PORT", "8080"))
ADMIN_PORT = int(os.getenv("ADMIN_PORT", "8081"))
WEB_BASE = os.getenv("PUBLIC_WEB_BASE", "https://www.meetgo.app").rstrip("/")
HOT_DIR = Path(os.getenv("WEB_HOT_DIR", "/srv/web-hot"))
IMAGE_DIR = Path(os.getenv("WEB_DIR", "/srv/web"))
# Paths of the web site that the API answers (Android App Links).
API_PATHS = ("/.well-known/assetlinks.json",)
NO_CACHE = {"/sw.js": "no-cache", "/app.webmanifest": "no-cache", "/version.json": "no-store"}


def web_root() -> Path | None:
    for d in (HOT_DIR, IMAGE_DIR):
        if (d / "index.html").is_file():
            return d
    return None


def _file(root: Path, rel: str) -> Path | None:
    """The file `rel` inside `root` (never outside it), if it exists."""
    path = (root / rel.lstrip("/")).resolve()
    if path != root.resolve() and root.resolve() not in path.parents:
        return None
    if path.is_dir():
        path = path / "index.html"
    return path if path.is_file() else None


def web_response(path: str):
    root = web_root()
    if root is None:
        return PlainTextResponse("MeetGo web site not built", status_code=503)
    if path.startswith("/assets/"):
        f = _file(root, path)
        return FileResponse(f, headers={"Cache-Control": "public, max-age=31536000, immutable"}) if f else PlainTextResponse("Not found", 404)
    if path in NO_CACHE:
        f = _file(root, path)
        return FileResponse(f, headers={"Cache-Control": NO_CACHE[path]}) if f else PlainTextResponse("Not found", 404)
    if path.rstrip("/") == "/landing":  # the landing page is at "/": old /landing links go there
        return RedirectResponse("/", status_code=301)
    if path == "/app" or path.startswith("/app/"):  # the single-page app
        f = _file(root, path) if path not in ("/app", "/app/") else None
        return FileResponse(f or root / "app" / "index.html", headers={"Cache-Control": "no-cache"})
    f = _file(root, path) or (_file(root, path.rstrip("/") + ".html") if path != "/" else None) or root / "index.html"
    return FileResponse(f)


class WebSite:
    """ASGI middleware: requests on the web or admin ports never reach the API (except API_PATHS)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        port = (scope.get("server") or (None, None))[1]
        if scope["type"] == "http" and port == ADMIN_PORT:
            return await RedirectResponse(f"{WEB_BASE}/app/admin", status_code=301)(scope, receive, send)
        if scope["type"] == "http" and port == WEB_PORT and scope["path"] not in API_PATHS:
            if scope["method"] not in ("GET", "HEAD"):
                return await PlainTextResponse("Method not allowed", status_code=405)(scope, receive, send)
            return await web_response(scope["path"])(scope, receive, send)
        await self.app(scope, receive, send)
