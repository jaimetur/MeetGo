"""Another zone is looked at with my own age range only; communities suggested by my interests; interest communities
with the settings of people's communities (an age span joins them per province)."""

from sqlalchemy import select

from app.core.models import Conversation, ConversationMember, Interest

from tests.helpers import admin_headers, make_user, province_level


async def test_other_zones_always_with_my_own_age(client, db_session):
    ana = await make_user(client, db_session, "ana.zone@example.com", "Ana", dob="1980-01-01")  # 31-60
    young = await make_user(client, db_session, "young.zone@example.com", "Joven", province="Sevilla", dob="2000-01-01")
    await client.post("/me/interests", json={"interest_slugs": ["cine"]}, headers=young[0])
    res = (await client.get("/communities", params={"province": "Sevilla", "age_range": "18_30"}, headers=ana[0])).json()
    assert all(c["age_range"] == "31_60" for c in res)  # asking for 18-30 shows her own range


async def test_suggestions_by_interests(client, db_session):
    ana = await make_user(client, db_session, "ana.sug@example.com", "Ana")
    bea = await make_user(client, db_session, "bea.sug@example.com", "Bea")
    assert (await client.get("/communities/suggested", headers=bea[0])).json() == []  # no interests yet
    custom = (await client.post("/communities", json={"title": "Rutas y fotos", "interest_tags": ["senderismo", "viajes", "nope"]},
                                headers=ana[0])).json()
    assert custom["tags"] == ["senderismo", "viajes"]
    await client.post("/me/interests", json={"interest_slugs": ["senderismo", "viajes"]}, headers=bea[0])
    got = (await client.get("/communities/suggested", headers=bea[0])).json()
    assert len(got) <= 6 and got[0]["id"] == custom["id"] and set(got[0]["matches"]) == {"senderismo", "viajes"}
    assert all(not c["joined"] for c in got)  # her own interest communities are joined, not suggested
    interest = next(i for i in (await client.get("/interests")).json() if i["slug"] == "senderismo")
    assert interest["tags"][0] == "senderismo" and 1 <= len(interest["tags"]) <= 5


async def test_interest_settings_and_age_span(client, db_session):
    await province_level(db_session)
    headers = await admin_headers(client)
    young = await make_user(client, db_session, "y.span@example.com", "Joven", dob="2000-01-01")  # 18-30
    mid = await make_user(client, db_session, "m.span@example.com", "Medio", dob="1988-01-01")  # 31-60
    for u in (young, mid):
        await client.post("/me/interests", json={"interest_slugs": ["cine"]}, headers=u[0])
    cine = next(i for i in (await client.get("/admin/interests", headers=headers)).json() if i["slug"] == "cine")
    async with db_session() as db:
        before = (await db.execute(select(Conversation.id).where(Conversation.interest_id == cine["id"], Conversation.province == "Madrid"))).scalars().all()
    assert len(before) == 2  # one per age range
    res = await client.patch(f"/admin/interests/{cine['id']}", json={
        "slug": "cine", "name": "Cine", "age_mode": "span", "min_age": 20, "max_age": 45, "access_mode": "request",
        "board_mode": "admins", "retention_days": 90, "join_questions": ["¿Qué película te gusta?"]}, headers=headers)
    assert res.status_code == 200, res.text
    async with db_session() as db:
        convs = (await db.execute(select(Conversation).where(Conversation.interest_id == cine["id"], Conversation.province == "Madrid"))).scalars().all()
        assert len(convs) == 1 and convs[0].age_range == "custom" and convs[0].min_age == 20 and convs[0].retention_days == 90
        assert convs[0].access_mode == "request" and convs[0].board_mode == "admins"
        members = set((await db.execute(select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == convs[0].id, ConversationMember.away.is_(False)))).scalars().all())
    assert {young[1]["id"], mid[1]["id"]} <= members  # both ranges together now
    listed = next(c for c in (await client.get("/communities", headers=mid[0])).json() if c["slug"] == "cine")
    assert listed["join_questions"] == ["¿Qué película te gusta?"]
    # back to the fixed ranges: split again, everyone keeps a community that fits
    await client.patch(f"/admin/interests/{cine['id']}", json={"slug": "cine", "name": "Cine", "age_mode": "ranges"}, headers=headers)
    async with db_session() as db:
        convs = (await db.execute(select(Conversation).where(Conversation.interest_id == cine["id"], Conversation.province == "Madrid"))).scalars().all()
        assert all(c.age_range != "custom" and c.min_age is None for c in convs)


async def test_suggestions_tie_goes_to_more_members(client, db_session):
    ana = await make_user(client, db_session, "ana.tie@example.com", "Ana")
    leo = await make_user(client, db_session, "leo.tie@example.com", "Leo")
    bea = await make_user(client, db_session, "bea.tie@example.com", "Bea")
    # "Alfa" comes first by name, but "Zeta" gets one more member: same matches, so Zeta goes first
    alfa = (await client.post("/communities", json={"title": "Alfa ajedrez", "interest_tags": ["viajes"]}, headers=ana[0])).json()
    zeta = (await client.post("/communities", json={"title": "Zeta ajedrez", "interest_tags": ["viajes"]}, headers=ana[0])).json()
    assert (await client.post(f"/communities/{zeta['id']}/join", json={}, headers=leo[0])).status_code == 200
    await client.post("/me/interests", json={"interest_slugs": ["viajes"]}, headers=bea[0])
    got = [c["id"] for c in (await client.get("/communities/suggested", headers=bea[0])).json()]
    assert zeta["id"] in got and alfa["id"] in got and got.index(zeta["id"]) < got.index(alfa["id"])
