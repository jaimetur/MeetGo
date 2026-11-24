"""Community bots (bot-admin, bot-moderator), temporary and permanent bans, and the moderation bot's ladder."""

from sqlalchemy import select

from app.communities import automod
from app.core.models import ConversationMember, Message, User, utcnow

from tests.helpers import admin_headers, make_user


async def _create(client, headers, **kw):
    res = await client.post("/communities", json={"title": "Senderismo Sierra", "access_mode": "open",
                                                  "board_mode": "open", **kw}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def _bots(db_session):
    async with db_session() as db:
        return dict((await db.execute(select(User.bot_role, User.id).where(User.bot_role.is_not(None)))).all())


async def _say(client, headers, cid, body):
    return await client.post(f"/conversations/{cid}/messages", json={"body": body}, headers=headers)


async def test_every_community_has_the_two_bots(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    com = await _create(client, ana[0])
    bots = await _bots(db_session)
    assert set(bots) == {"admin", "moderator"}
    members = (await client.get(f"/communities/{com['id']}/members", headers=ana[0])).json()
    assert [(m["display_name"], m["role"], m["bot"]) for m in members] == [
        ("bot-admin", "admin", True), ("bot-moderator", "moderator", True), ("Ana", "owner", False)]
    assert com["member_count"] == 1  # the bots do not count
    interest = next(c for c in (await client.get("/communities", headers=ana[0])).json() if c["kind"] == "interest")
    roles = {m["display_name"]: m["role"] for m in (await client.get(f"/communities/{interest['id']}/members", headers=ana[0])).json()}
    assert roles["bot-admin"] == "admin" and roles["bot-moderator"] == "moderator"
    # Nobody moderates the bots.
    res = await client.post(f"/communities/{com['id']}/members/{bots['moderator']}/ban", json={"hours": 6}, headers=ana[0])
    assert res.status_code == 403


async def test_moderators_ban_and_only_admins_lift(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    mod = await make_user(client, db_session, "mod@example.com", "Mod")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0])
    cid = com["id"]
    for u in (mod, bea):
        await client.post(f"/communities/{cid}/join", headers=u[0])
    await client.put(f"/communities/{cid}/members/{mod[1]['id']}/role", json={"role": "moderator"}, headers=ana[0])

    # Moderators neither invite nor handle requests.
    assert (await client.post(f"/communities/{cid}/invite", headers=mod[0])).status_code == 403
    assert (await client.get(f"/communities/{cid}/requests", headers=mod[0])).status_code == 403

    res = await client.post(f"/communities/{cid}/members/{bea[1]['id']}/ban", json={"hours": 6}, headers=mod[0])
    assert res.status_code == 200, res.text
    assert (await _say(client, bea[0], cid, "hola")).status_code == 403
    res = await client.post(f"/communities/{cid}/posts", json={"kind": "thread", "title": "Hola"}, headers=bea[0])
    assert res.status_code == 403
    assert (await client.delete(f"/communities/{cid}/membership", headers=bea[0])).status_code == 409  # no way out
    bans = (await client.get(f"/communities/{cid}/bans", headers=mod[0])).json()
    assert [(b["user"]["display_name"], b["forever"]) for b in bans] == [("Bea", False)] and bans[0]["until"]
    member = next(m for m in (await client.get(f"/communities/{cid}/members", headers=ana[0])).json() if m["display_name"] == "Bea")
    assert member["ban_until"]

    assert (await client.post(f"/communities/{cid}/members/{bea[1]['id']}/unban", headers=mod[0])).status_code == 403
    assert (await client.post(f"/communities/{cid}/members/{bea[1]['id']}/unban", headers=ana[0])).status_code == 200
    assert (await _say(client, bea[0], cid, "hola")).status_code == 200

    # For good: out of the community, back only when an admin lifts it.
    await client.post(f"/communities/{cid}/members/{bea[1]['id']}/ban", json={}, headers=mod[0])
    assert (await client.post(f"/communities/{cid}/join", headers=bea[0])).status_code == 403
    assert (await client.get(f"/communities/{cid}/bans", headers=ana[0])).json()[0]["forever"] is True
    await client.post(f"/communities/{cid}/members/{bea[1]['id']}/unban", headers=ana[0])
    assert (await client.get(f"/communities/{cid}", headers=bea[0])).json()["joined"] is True


async def test_breaking_a_rule_bans_6h_then_24h_then_for_good(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0])
    cid, bea_id = com["id"], bea[1]["id"]
    await client.post(f"/communities/{cid}/join", headers=bea[0])

    async def member():
        async with db_session() as db:
            return (await db.execute(select(ConversationMember).where(
                ConversationMember.conversation_id == cid, ConversationMember.user_id == bea_id))).scalar_one()

    expected = [6, 24, None]
    for step, hours in enumerate(expected, 1):
        res = await _say(client, bea[0], cid, "llámame al 612 345 678")
        assert res.status_code == 200, res.text
        m = await member()
        assert m.strikes == step
        if hours:
            left = m.ban_until - utcnow()
            assert hours - 1 < left.total_seconds() / 3600 <= hours
            await client.post(f"/communities/{cid}/members/{bea_id}/unban", headers=ana[0])  # an admin lifts it
        else:
            assert m.banned is True
    async with db_session() as db:
        bodies = [b for b in (await db.execute(select(Message.body).where(Message.conversation_id == cid))).scalars().all()]
    assert sum("Bea" in b and "🚫" in b for b in bodies) == 3  # bot-moderator said it each time


async def test_the_bot_applies_the_rules_with_claude(client, db_session, monkeypatch):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0])
    cid = com["id"]
    await client.patch(f"/communities/{cid}", json={"rules": "- Solo se habla de montaña"}, headers=ana[0])
    await client.post(f"/communities/{cid}/join", headers=bea[0])
    seen = []

    async def judge(rules, text):
        seen.append((rules, text))
        return {"violation": "fútbol" in text, "rule": "Solo se habla de montaña", "reason": "off topic"}

    monkeypatch.setattr(automod, "enabled", lambda: True)
    monkeypatch.setattr(automod, "judge", judge)
    ok = (await _say(client, bea[0], cid, "¿Ruta el sábado?")).json()
    bad = (await _say(client, bea[0], cid, "¿Quién ve el fútbol?")).json()
    await automod.check_message(cid, ok["id"])
    await automod.check_message(cid, bad["id"])
    assert seen[0] == ("- Solo se habla de montaña", "¿Ruta el sábado?")
    async with db_session() as db:
        assert (await db.get(Message, ok["id"])).deleted_at is None
        assert (await db.get(Message, bad["id"])).moderation_reason == "RULES"
    assert (await _say(client, bea[0], cid, "perdón")).status_code == 403  # 6 hours
    # Staff are not checked.
    seen.clear()
    own = (await _say(client, ana[0], cid, "fútbol")).json()
    await automod.check_message(cid, own["id"])
    assert seen == []


async def test_admins_open_a_session_as_a_bot(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    admin = await admin_headers(client)
    bots = (await client.get("/admin/bots", headers=admin)).json()
    assert {b["display_name"]: b["bot_role"] for b in bots} == {"bot-admin": "admin", "bot-moderator": "moderator"}
    assert (await client.post(f"/admin/bots/{bots[0]['id']}/session", headers=ana[0])).status_code == 403
    token = (await client.post(f"/admin/bots/{bots[0]['id']}/session", headers=admin)).json()["access_token"]
    me = (await client.get("/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["display_name"] == "bot-admin"
    com = await _create(client, ana[0])
    mine = (await client.get("/communities", params={"mine": 1}, headers={"Authorization": f"Bearer {token}"})).json()
    assert com["id"] in [c["id"] for c in mine]


async def test_admins_empty_the_community_chat(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0])
    cid = com["id"]
    await client.post(f"/communities/{cid}/join", headers=bea[0])
    for body in ("uno", "dos"):
        await _say(client, bea[0], cid, body)
    assert (await client.post(f"/communities/{cid}/clear-chat", headers=bea[0])).status_code == 403
    assert (await client.post(f"/communities/{cid}/clear-chat", headers=ana[0])).json() == {"ok": True}
    page = (await client.get(f"/conversations/{cid}/messages", headers=bea[0])).json()
    msgs = page["messages"] if isinstance(page, dict) else page
    assert [m["kind"] for m in msgs] == ["system"] and "Ana" in msgs[0]["body"]
