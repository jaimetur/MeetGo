"""Communities keep their chat for a limited time: old messages (and their thread replies) are deleted, except the
pinned one."""

from datetime import timedelta

from sqlalchemy import select, update

from app.core.models import Conversation, Message, utcnow
from app.messaging.retention import purge_once

from tests.helpers import make_user


async def test_retention_choices_and_defaults(client, db_session):
    ana = await make_user(client, db_session, "ana.ret@example.com", "Ana")
    com = (await client.post("/communities", json={"title": "Club de lectura"}, headers=ana[0])).json()
    assert com["retention_days"] == 30  # new communities: one month
    assert (await client.patch(f"/communities/{com['id']}", json={"retention_days": 45}, headers=ana[0])).status_code == 400
    assert (await client.patch(f"/communities/{com['id']}", json={"retention_days": 7}, headers=ana[0])).json()["retention_days"] == 7
    other = (await client.post("/communities", json={"title": "Cine club", "retention_days": 365}, headers=ana[0])).json()
    assert other["retention_days"] == 365
    interest = next(c for c in (await client.get("/communities", headers=ana[0])).json() if c["kind"] == "interest")
    assert interest["retention_days"] == 365  # interest communities: one year, fixed
    assert (await client.patch(f"/communities/{interest['id']}", json={"retention_days": 30}, headers=ana[0])).status_code in (400, 403)


async def test_old_messages_and_their_threads_are_deleted(client, db_session):
    ana = await make_user(client, db_session, "ana.purge@example.com", "Ana")
    com = (await client.post("/communities", json={"title": "Charla", "retention_days": 1}, headers=ana[0])).json()
    cid = com["conversation_id"]
    old = (await client.post(f"/conversations/{cid}/messages", json={"body": "antiguo"}, headers=ana[0])).json()
    pinned = (await client.post(f"/conversations/{cid}/messages", json={"body": "normas: fijado"}, headers=ana[0])).json()
    reply = (await client.post(f"/conversations/{cid}/messages", json={"body": "respuesta", "thread_root_id": old["id"]}, headers=ana[0])).json()
    new = (await client.post(f"/conversations/{cid}/messages", json={"body": "reciente"}, headers=ana[0])).json()
    await client.patch(f"/conversations/{cid}", json={"pinned_message_id": pinned["id"]}, headers=ana[0])
    async with db_session() as db:
        await db.execute(update(Message).where(Message.id.in_([old["id"], pinned["id"]])).values(created_at=utcnow() - timedelta(days=2)))
        await db.commit()
        assert await purge_once(db) == 2
        left = (await db.execute(select(Message.id).where(Message.conversation_id == cid, Message.kind == "text"))).scalars().all()
        conv = await db.get(Conversation, cid)
    assert set(left) == {new["id"], pinned["id"]} and reply["id"] not in left  # the pinned one never expires
    assert conv.pinned_message_id == pinned["id"] and conv.last_message_id >= new["id"]
    async with db_session() as db:
        assert await purge_once(db) == 0  # nothing more to do
