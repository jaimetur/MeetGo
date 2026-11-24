"""A coffee, a beer and drinks became one interest and one community per zone: "Quedar para tomar algo"."""

from sqlalchemy import func, select, text

from app.core.models import Conversation, ConversationMember, Interest, Message, UserInterest
from app.core.seed import MERGED_INTERESTS, merge_interests

from tests.helpers import make_user


async def test_merges_communities_members_messages_and_interests(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    # The old interests, as an existing server still has them.
    async with db_session() as db:
        for slug in MERGED_INTERESTS:
            db.add(Interest(slug=slug, name=slug))
        await db.commit()
        ids = dict((await db.execute(select(Interest.slug, Interest.id))).all())
    await client.post("/me/interests", json={"interest_slugs": ["cafe", "cerveza"]}, headers=ana[0])
    await client.post("/me/interests", json={"interest_slugs": ["copas"]}, headers=bea[0])
    convs = {c["title"]: c["id"] for c in (await client.get("/conversations", headers=ana[0])).json()}
    for cid in convs.values():
        await client.post(f"/conversations/{cid}/messages", json={"body": "hola"}, headers=ana[0])
    copas = next(c["id"] for c in (await client.get("/conversations", headers=bea[0])).json())
    await client.post(f"/conversations/{copas}/messages", json={"body": "¿unas copas?"}, headers=bea[0])

    async with db_session() as db:
        await merge_interests(db, MERGED_INTERESTS, "tomar_algo")
        await merge_interests(db, MERGED_INTERESTS, "tomar_algo")  # nothing left to do
        slugs = set((await db.execute(select(Interest.slug))).scalars().all())
        assert "tomar_algo" in slugs and not slugs & set(MERGED_INTERESTS)
        channels = (await db.execute(select(Conversation).where(
            Conversation.kind == "channel", Conversation.interest_id == ids["tomar_algo"]))).scalars().all()
        assert len(channels) == 1
        target = channels[0]
        members = set((await db.execute(select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == target.id))).scalars().all())
        assert {ana[1]["id"], bea[1]["id"]} <= members
        assert (await db.execute(select(func.count()).select_from(Message).where(
            Message.conversation_id == target.id, Message.kind == "text"))).scalar_one() == 3
        chosen = set((await db.execute(select(UserInterest.user_id).where(UserInterest.interest_id == ids["tomar_algo"]))).scalars().all())
        assert chosen == {ana[1]["id"], bea[1]["id"]}
        assert (await db.execute(text("SELECT count(*) FROM conversations WHERE id = ANY(:o)"), {"o": [c for c in convs.values() if c != target.id]})).scalar() == 0
    mine = (await client.get("/communities", params={"mine": 1}, headers=bea[0])).json()
    assert [c["slug"] for c in mine] == ["tomar_algo"] and mine[0]["title"] == "Quedar para tomar algo"
