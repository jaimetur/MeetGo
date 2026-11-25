"""Blocking someone, and deleting my own account."""

from sqlalchemy import select

from app.core.models import Message, User

from tests.helpers import befriend, make_user


async def test_blocking_stops_dms_requests_and_follows(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana", accept_dm=True)
    bea = await make_user(client, db_session, "bea@example.com", "Bea", accept_dm=True)
    await befriend(client, ana, bea)
    dm = (await client.post("/conversations/dm", json={"user_id": bea[1]["id"]}, headers=ana[0])).json()["conversation_id"]
    assert (await client.post(f"/conversations/{dm}/messages", json={"body": "hola"}, headers=bea[0])).status_code == 200

    assert (await client.post(f"/users/{bea[1]['id']}/block", headers=ana[0])).json() == {"ok": True}
    assert [b["username"] for b in (await client.get("/me/blocks", headers=ana[0])).json()] == ["Bea"]
    # both ways: no messages in our chat, no new chat, request or follow
    assert (await client.post(f"/conversations/{dm}/messages", json={"body": "?"}, headers=bea[0])).status_code == 403
    assert (await client.post(f"/conversations/{dm}/messages", json={"body": "?"}, headers=ana[0])).status_code == 403
    assert (await client.post("/friends/requests", json={"to_user_id": ana[1]["id"]}, headers=bea[0])).status_code == 403
    assert (await client.post(f"/follow/{ana[1]['id']}", headers=bea[0])).status_code == 403
    friends = (await client.get("/friends", headers=ana[0])).json()
    assert all(f.get("id") != bea[1]["id"] for f in friends)  # no longer friends

    assert (await client.delete(f"/users/{bea[1]['id']}/block", headers=ana[0])).json() == {"ok": True}
    assert (await client.get("/me/blocks", headers=ana[0])).json() == []
    assert (await client.post(f"/conversations/{dm}/messages", json={"body": "de nuevo"}, headers=bea[0])).status_code == 200
    assert (await client.post(f"/users/{ana[1]['id']}/block", headers=ana[0])).status_code == 400


async def test_deleting_my_account(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = (await client.post("/communities", json={"title": "Mi grupo", "access_mode": "open", "board_mode": "open"}, headers=ana[0])).json()
    await client.post(f"/communities/{com['id']}/join", headers=bea[0])
    await client.post(f"/conversations/{com['id']}/messages", json={"body": "un secreto"}, headers=ana[0])

    assert (await client.request("DELETE", "/me", json={"password": "wrong"}, headers=ana[0])).status_code == 403
    assert (await client.request("DELETE", "/me", json={"password": "secret123"}, headers=ana[0])).json() == {"ok": True}
    assert (await client.get("/me", headers=ana[0])).status_code == 401
    assert (await client.post("/auth/login", json={"email": "ana@example.com", "password": "secret123"})).status_code != 200
    async with db_session() as db:
        assert (await db.execute(select(User).where(User.email == "ana@example.com"))).scalar_one_or_none() is None
        bodies = (await db.execute(select(Message.body).where(Message.conversation_id == com["id"], Message.kind == "text"))).scalars().all()
        assert "un secreto" not in bodies
    # the community passes to Bea
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).json()["role"] == "owner"
