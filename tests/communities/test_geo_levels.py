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
    assert a_conv not in (national, new)  # a new community: the zones' chats are not mixed
    chats = {c["id"]: c for c in (await client.get("/conversations", headers=ana)).json()}
    old = chats[national if national in chats else new]
    assert old["archive"] and old["archive"]["community_id"] == a_conv  # the old zone's chat, to read for a while
    res = await client.post(f"/conversations/{old['id']}/messages", json={"body": "¿sigue?"}, headers=ana)
    assert res.status_code == 403
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
