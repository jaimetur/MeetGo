"""WhatsApp-like ticks and privacy: delivered (✓✓), read (blue, both people must keep receipts on in direct messages;
always in groups) and "last seen" as each person allows it."""

from sqlalchemy import update

from app.core.models import User

from tests.helpers import befriend, make_user


async def _dm(client, a, b):
    await befriend(client, a, b)
    res = await client.post("/conversations/dm", json={"user_id": b[1]["id"]}, headers=a[0])
    return res.json()["conversation_id"]


async def _state(client, headers, cid):
    return (await client.get(f"/conversations/{cid}/read-state", headers=headers)).json()[0]


async def test_sent_delivered_read(client, db_session):
    ana = await make_user(client, db_session, "ana.ticks@example.com", "Ana")
    bea = await make_user(client, db_session, "bea.ticks@example.com", "Bea")
    cid = await _dm(client, ana, bea)
    msg = (await client.post(f"/conversations/{cid}/messages", json={"body": "hola"}, headers=ana[0])).json()
    s = await _state(client, ana[0], cid)
    assert s["last_delivered_message_id"] < msg["id"] and s["last_read_message_id"] < msg["id"]  # ✓
    await client.post("/conversations/delivered", headers=bea[0])  # Bea's app loads her chats
    s = await _state(client, ana[0], cid)
    assert s["last_delivered_message_id"] >= msg["id"] and s["last_read_message_id"] < msg["id"]  # ✓✓
    await client.post(f"/conversations/{cid}/read", json={"message_id": msg["id"]}, headers=bea[0])
    assert (await _state(client, ana[0], cid))["last_read_message_id"] >= msg["id"]  # blue


async def test_read_receipts_off_works_both_ways(client, db_session):
    ana = await make_user(client, db_session, "ana.rr@example.com", "Ana")
    bea = await make_user(client, db_session, "bea.rr@example.com", "Bea")
    cid = await _dm(client, ana, bea)
    a_msg = (await client.post(f"/conversations/{cid}/messages", json={"body": "hola"}, headers=ana[0])).json()
    b_msg = (await client.post(f"/conversations/{cid}/messages", json={"body": "hey"}, headers=bea[0])).json()
    await client.patch("/me/profile", json={"read_receipts": False}, headers=bea[0])
    await client.post(f"/conversations/{cid}/read", json={"message_id": b_msg["id"]}, headers=bea[0])
    await client.post(f"/conversations/{cid}/read", json={"message_id": b_msg["id"]}, headers=ana[0])
    seen_by_ana = await _state(client, ana[0], cid)
    assert seen_by_ana["receipts"] is False and seen_by_ana["last_read_message_id"] == 0
    assert seen_by_ana["last_delivered_message_id"] >= a_msg["id"]  # still ✓✓
    seen_by_bea = await _state(client, bea[0], cid)
    assert seen_by_bea["last_read_message_id"] == 0  # she does not see Ana's either


async def test_last_seen_as_each_person_allows(client, db_session):
    ana = await make_user(client, db_session, "ana.ls@example.com", "Ana")
    bea = await make_user(client, db_session, "bea.ls@example.com", "Bea")
    cid = await _dm(client, ana, bea)

    async def bea_seen_by_ana():
        conv = (await client.get(f"/conversations/{cid}", headers=ana[0])).json()
        return conv["other_user"]["last_seen_at"]

    assert await bea_seen_by_ana()  # everyone by default
    await client.patch("/me/profile", json={"last_seen_privacy": "friends"}, headers=bea[0])
    assert await bea_seen_by_ana()  # they are friends
    await client.patch("/me/profile", json={"last_seen_privacy": "nobody"}, headers=bea[0])
    assert await bea_seen_by_ana() is None
    await client.patch("/me/profile", json={"last_seen_privacy": "all"}, headers=bea[0])
    await client.patch("/me/profile", json={"last_seen_privacy": "nobody"}, headers=ana[0])
    assert await bea_seen_by_ana() is None  # Ana hides hers, so she does not see Bea's
    me = (await client.get("/me", headers=ana[0])).json()
    assert me["last_seen_privacy"] == "nobody" and me["read_receipts"] is True
    assert (await client.patch("/me/profile", json={"last_seen_privacy": "some"}, headers=ana[0])).status_code == 422
