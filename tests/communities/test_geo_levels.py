"""Interest communities at a chosen width: one per country (the default), per region or per province. Changing it joins
or splits them keeping their people; the administration sees zones and age ranges apart and is told when to split or
join; every community has an official language (its zone's by default)."""

from tests.helpers import admin_headers, make_user


async def _interest(client, headers, slug):
    return next(i for i in (await client.get("/interests", headers=headers)).json() if i["slug"] == slug)


async def _my_channel(client, headers, interest_id):
    """The community of the interest I am active in."""
    rows = (await client.get("/channels/explore", headers=headers)).json()
    return next(r for r in rows if r["interest"]["id"] == interest_id)["conversation_id"]


async def test_country_by_default_then_split_and_join(client, db_session):
    ana, _ = await make_user(client, db_session, "ana@example.com", "Ana", province="Madrid")
    bea, _ = await make_user(client, db_session, "bea@example.com", "Bea", province="Huelva")
    admin = await admin_headers(client)
    hike = await _interest(client, ana, "senderismo")
    assert hike["geo_level"] == "country"
    for h in (ana, bea):
        assert (await client.post(f"/channels/{hike['id']}/join", headers=h)).status_code == 200
    national = await _my_channel(client, ana, hike["id"])
    assert await _my_channel(client, bea, hike["id"]) == national  # one community for the whole country
    assert (await client.post(f"/conversations/{national}/messages", json={"body": "Hola a todo el país"}, headers=ana)).status_code in (200, 201)
    community = (await client.get(f"/communities/{national}", headers=ana)).json()
    assert community["language"] == "es" and community["province"] == "España"

    rows = {i["slug"]: i for i in (await client.get("/admin/interests", headers=admin)).json()}
    assert rows["senderismo"]["zones"] == 1 and rows["senderismo"]["age_bands"] == 1 and rows["senderismo"]["suggest"] is None

    # split by province: each person in their own province's community
    res = await client.patch(f"/admin/interests/{hike['id']}", json={"slug": "senderismo", "name": "Senderismo", "geo_level": "province"}, headers=admin)
    assert res.status_code == 200, res.text
    a_conv, b_conv = await _my_channel(client, ana, hike["id"]), await _my_channel(client, bea, hike["id"])
    assert a_conv != b_conv and national in (a_conv, b_conv)  # the old one stays (with its history) in one zone
    new = b_conv if a_conv == national else a_conv
    copied = (await client.get(f"/conversations/{new}/messages", headers=bea if new == b_conv else ana)).json()
    copied = copied.get("messages", copied) if isinstance(copied, dict) else copied
    assert any(m.get("body") == "Hola a todo el país" for m in copied)  # the new zone starts with the wide chat's history
    other = bea if new == b_conv else ana
    mine = {c["id"] for c in (await client.get("/conversations", headers=other)).json()}
    assert national not in mine  # moved, not left behind
    rows = {i["slug"]: i for i in (await client.get("/admin/interests", headers=admin)).json()}
    assert rows["senderismo"]["zones"] == 2 and rows["senderismo"]["suggest"] == "join"  # tiny ones: join them up

    # and back to the whole country: joined again, both people in it
    await client.patch(f"/admin/interests/{hike['id']}", json={"slug": "senderismo", "name": "Senderismo", "geo_level": "country"}, headers=admin)
    a_conv, b_conv = await _my_channel(client, ana, hike["id"]), await _my_channel(client, bea, hike["id"])
    assert a_conv == b_conv
    assert a_conv in (national, new)  # joined into one of them
    other = bea if new == b_conv else ana
    await client.post(f"/conversations/{a_conv}/messages", json={"body": "Ya estamos juntos"}, headers=other)
    msgs = (await client.get(f"/conversations/{a_conv}/messages", headers=ana)).json()
    msgs = msgs.get("messages", msgs) if isinstance(msgs, dict) else msgs
    bodies = [m.get("body") for m in msgs]
    assert "Hola a todo el país" in bodies and bodies.index("Hola a todo el país") < bodies.index("Ya estamos juntos")  # all, in order
    groups = [c for c in (await client.get("/conversations", headers=ana)).json() if c["kind"] == "group"]
    assert not groups  # no chat left behind
    members = (await client.get(f"/communities/{a_conv}/members", headers=ana)).json()
    assert {"ana@example.com", "bea@example.com"} <= {m.get("email") for m in members} or len([m for m in members if not m.get("bot")]) >= 2


async def test_official_language(client, db_session):
    ana, _ = await make_user(client, db_session, "ana@example.com", "Ana", province="Madrid")
    made = (await client.post("/communities", json={"title": "Club de lectura", "category": "ui_cat_culture"}, headers=ana)).json()
    assert made["language"] == "es"
    changed = (await client.patch(f"/communities/{made['id']}", json={"language": "en"}, headers=ana)).json()
    assert changed["language"] == "en"
    assert (await client.patch(f"/communities/{made['id']}", json={"language": "xx"}, headers=ana)).status_code == 400
    back = (await client.patch(f"/communities/{made['id']}", json={"language": ""}, headers=ana)).json()
    assert back["language"] == "es"  # "": back to its zone's (Madrid)
    bea, _ = await make_user(client, db_session, "bea@example.com", "Bea", province="Huelva")
    hers = (await client.post("/communities", json={"title": "Playas de Huelva", "category": "ui_cat_culture"}, headers=bea)).json()
    assert hers["language"] == "es"


async def test_new_suggestions_notify_admins(client, db_session, monkeypatch):
    """A suggestion that appears (here: two tiny province communities, to join) reaches the administrators once."""
    import app.admin.pending as pending
    from app.core.redis_conn import get_redis
    sent, events = [], []
    monkeypatch.setattr("app.push.service.push_notice", lambda users, kind, key, params, url: sent.append((key, params["name"])))

    async def fake_publish(to, event):
        events.append(event)
    monkeypatch.setattr("app.realtime.service.publish", fake_publish)
    await get_redis().delete("admin:suggestions")
    from app.core.db import SessionLocal
    async with SessionLocal() as db:
        assert await pending.check_suggestions(db) == 0  # the first round only remembers what there is
    ana, _ = await make_user(client, db_session, "ana@example.com", "Ana", province="Madrid")
    bea, _ = await make_user(client, db_session, "bea@example.com", "Bea", province="Huelva")
    admin = await admin_headers(client)
    hike = await _interest(client, ana, "senderismo")
    for h in (ana, bea):
        await client.post(f"/channels/{hike['id']}/join", headers=h)
    await client.patch(f"/admin/interests/{hike['id']}", json={"slug": "senderismo", "name": "Senderismo", "geo_level": "province"}, headers=admin)
    async with SessionLocal() as db:
        assert await pending.check_suggestions(db) >= 1
        assert await pending.check_suggestions(db) == 0  # once
    assert ("email_suggest_join", "Senderismo") in sent and {"type": "admin.pending"} in events


async def test_archived_zone_chats_go_into_their_community(client, db_session):
    """The chats kept apart for 30 days by the first version (read-only groups named «Interest · tmp:N») are moved,
    messages and people, into the community they had been joined into."""
    from sqlalchemy import select
    from app.communities.interest_settings import unarchive_once
    from app.core.app_settings import get_section, set_section
    from app.core.models import Conversation, ConversationMember, Message, utcnow
    ana, me = await make_user(client, db_session, "ana@example.com", "Ana")
    hike = await _interest(client, ana, "senderismo")
    await client.post(f"/channels/{hike['id']}/join", headers=ana)
    target = await _my_channel(client, ana, hike["id"])
    async with db_session() as db:
        old = Conversation(kind="group", title="Senderismo · tmp:2", created_at=utcnow(), rules_markdown="",
                           policy_json={"read_only": True, "archived_into": target, "archived_until": utcnow().isoformat()})
        db.add(old)
        await db.flush()
        db.add(ConversationMember(conversation_id=old.id, user_id=me["id"], role="member"))
        db.add(Message(conversation_id=old.id, sender_id=me["id"], kind="text", body="Ruta del sábado", created_at=utcnow()))
        await db.commit()
        old_id = old.id
        done = await get_section(db, "migrations")
        await set_section(db, "migrations", {**done, "unarchive": False})
        await unarchive_once(db)
        assert not (await db.execute(select(Conversation.id).where(Conversation.id == old_id))).first()
        bodies = (await db.execute(select(Message.body).where(Message.conversation_id == target))).scalars().all()
        assert "Ruta del sábado" in bodies


async def test_search_places_are_the_zone_and_what_contains_it(client, db_session):
    """A national community is found by its country, not by a province inside it; a province's, by the province, its
    region and its country."""
    bea, _ = await make_user(client, db_session, "bea@example.com", "Bea", province="Huelva")
    admin = await admin_headers(client)
    hike = await _interest(client, bea, "senderismo")
    await client.post(f"/channels/{hike['id']}/join", headers=bea)
    rows = {i["slug"]: i for i in (await client.get("/admin/interests", headers=admin)).json()}
    assert "España" in rows["senderismo"]["places"] and "Huelva" not in rows["senderismo"]["places"]
    await client.patch(f"/admin/interests/{hike['id']}", json={"slug": "senderismo", "name": "Senderismo", "geo_level": "province"}, headers=admin)
    rows = {i["slug"]: i for i in (await client.get("/admin/interests", headers=admin)).json()}
    places = set(rows["senderismo"]["places"])
    assert {"Huelva", "España"} <= places and any("Andaluc" in p for p in places)


async def test_discovering_a_country_shows_its_default_communities(client, db_session):
    """Looking at a whole country where nobody is yet, as if I had travelled there: its interest communities show
    (empty), though only my own zone's can be joined."""
    ana, _ = await make_user(client, db_session, "ana@example.com", "Ana", province="Madrid")
    res = await client.get("/communities", params={"country": "FR", "age_range": "31_60"}, headers=ana)
    assert res.status_code == 200, res.text
    rows = res.json()
    assert rows and any(c["slug"] == "senderismo" for c in rows)
    assert all(c["my_zone"] is False and c["member_count"] == 0 for c in rows)
