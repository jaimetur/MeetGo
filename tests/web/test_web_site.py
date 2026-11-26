"""The app container serves the web site on its own port and sends admin.meetgo.app to the administration; the API's
port is untouched (app/web.py)."""

import httpx

from app import web
from app.main import app


async def test_ports_split_the_api_the_web_site_and_the_old_admin(client, tmp_path, monkeypatch):
    (tmp_path / "app").mkdir()
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("landing")
    (tmp_path / "privacy.html").write_text("privacy")
    (tmp_path / "app" / "index.html").write_text("spa")
    (tmp_path / "assets" / "x-123.js").write_text("js")
    monkeypatch.setattr(web, "HOT_DIR", tmp_path / "missing")
    monkeypatch.setattr(web, "IMAGE_DIR", tmp_path)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url=f"http://test:{web.WEB_PORT}") as site:
        assert (await site.get("/")).text == "landing"
        assert (await site.get("/privacy")).text == "privacy"
        assert (await site.get("/app/communities/5")).text == "spa"
        res = await site.get("/assets/x-123.js")
        assert res.text == "js" and "immutable" in res.headers["cache-control"]
        assert (await site.get("/assets/nope.js")).status_code == 404
        assert (await site.get("/../../etc/passwd")).text == "landing"
        assert (await site.get("/landing")).status_code == 301
        assert (await site.post("/auth/login", json={})).status_code == 405  # never the API
        assert (await site.get("/.well-known/assetlinks.json")).status_code == 200  # this one is the API's
    async with httpx.AsyncClient(transport=transport, base_url=f"http://test:{web.ADMIN_PORT}") as admin:
        res = await admin.get("/users")
        assert res.status_code == 301 and res.headers["location"].endswith("/app/admin")
    # the API's own port (and the tests' client) are not touched
    assert (await client.get("/settings/public")).status_code == 200
    assert (await client.get("/app/")).status_code == 404
