"""Administration → Logs: every call to the API is kept (who, what kind, how it went) and can be filtered."""

from app.admin import request_log

from tests.helpers import admin_headers, make_user


async def test_calls_are_logged_and_filtered(client, db_session):
    ana, me = await make_user(client, db_session, "ana@example.com", "Ana")
    await client.get("/conversations", headers=ana)
    await client.get("/communities/999999", headers=ana)  # a 404
    await client.post("/auth/login", json={"email": "nobody@example.com", "password": "x"})  # nobody signed in
    admin = await admin_headers(client)
    await request_log.flush()

    assert (await client.get("/admin/logs", headers=ana)).status_code == 403
    mine = (await client.get("/admin/logs", params={"user": str(me["id"])}, headers=admin)).json()["rows"]
    assert mine and all(r["user"]["id"] == me["id"] for r in mine)
    assert any(r["path"] == "/conversations" and r["kind"] == "messages" and r["status"] == 200 for r in mine)
    by_name = (await client.get("/admin/logs", params={"user": "ana@example"}, headers=admin)).json()["rows"]
    assert {r["id"] for r in by_name} == {r["id"] for r in mine}
    errors = (await client.get("/admin/logs", params={"result": "4xx", "user": str(me["id"])}, headers=admin)).json()["rows"]
    assert errors and all(400 <= r["status"] < 500 for r in errors)
    auth = (await client.get("/admin/logs", params={"kind": "auth", "user": "-"}, headers=admin)).json()["rows"]
    assert any(r["path"] == "/auth/login" and r["user"] is None for r in auth)
    page = (await client.get("/admin/logs", params={"limit": 2}, headers=admin)).json()
    assert len(page["rows"]) == 2 and page["more"]
    nxt = (await client.get("/admin/logs", params={"limit": 2, "before_id": page["rows"][-1]["id"]}, headers=admin)).json()
    assert nxt["rows"][0]["id"] < page["rows"][-1]["id"]
