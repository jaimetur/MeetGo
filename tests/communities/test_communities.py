"""Communities: creation, access modes (open, request, invite), roles, and memberships that go away with a zone change."""

from sqlalchemy import select, update

from app.core.models import ConversationMember

from tests.helpers import make_user


async def _create(client, headers, **kw):
    body = {"title": "Senderismo Sierra", "access_mode": "open", "board_mode": "open", **kw}
    res = await client.post("/communities", json=body, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def _member(db_session, conv_id, user_id):
    async with db_session() as db:
        return (await db.execute(select(ConversationMember).where(
            ConversationMember.conversation_id == conv_id, ConversationMember.user_id == user_id))).scalar_one_or_none()


async def test_create_and_join_an_open_community(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    far = await make_user(client, db_session, "far@example.com", "Far", province="Barcelona")
    com = await _create(client, ana[0], description="Rutas")
    assert com["kind"] == "custom" and com["role"] == "owner" and com["joined"] is True
    assert com["province"] == "Madrid" and com["age_range"] == "31_50" and com["member_count"] == 1
    assert com["invite_code"] and com["conversation_id"] == com["id"]

    listed = (await client.get("/communities", headers=bea[0])).json()
    mine = next(c for c in listed if c["id"] == com["id"])
    assert mine["joined"] is False and mine["invite_code"] is None
    assert any(c["kind"] == "interest" for c in listed)  # every interest has its community in the zone
    assert (await client.get("/communities", params={"q": "sierra"}, headers=bea[0])).json()[0]["id"] == com["id"]

    assert (await client.post(f"/communities/{com['id']}/join", headers=bea[0])).json() == {"status": "joined"}
    assert [c["id"] for c in (await client.get("/communities", params={"mine": 1}, headers=bea[0])).json()] == [com["id"]]
    assert any(c["id"] == com["id"] for c in (await client.get("/conversations", headers=bea[0])).json())
    members = (await client.get(f"/communities/{com['id']}/members", headers=bea[0])).json()
    assert [(m["display_name"], m["role"]) for m in members] == [("Ana", "owner"), ("Bea", "member")]

    # Other zones neither see it nor join it.
    assert (await client.get(f"/communities/{com['id']}", headers=far[0])).status_code == 404
    assert (await client.post(f"/communities/{com['id']}/join", headers=far[0])).status_code == 403
    assert (await client.post(f"/communities/join/{com['invite_code']}", headers=far[0])).status_code == 403


async def test_request_mode_needs_approval(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    com = await _create(client, ana[0], access_mode="request")

    assert (await client.post(f"/communities/{com['id']}/join", headers=bea[0])).json() == {"status": "requested"}
    assert (await client.post(f"/communities/{com['id']}/join", headers=cris[0])).json() == {"status": "requested"}
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).json()["request_pending"] is True
    assert (await client.get(f"/communities/{com['id']}/requests", headers=bea[0])).status_code == 403
    requests = (await client.get(f"/communities/{com['id']}/requests", headers=ana[0])).json()
    assert [r["user"]["display_name"] for r in requests] == ["Bea", "Cris"]

    res = await client.post(f"/communities/{com['id']}/requests/{bea[1]['id']}/resolve", json={"accept": True}, headers=ana[0])
    assert res.json() == {"ok": True}
    await client.post(f"/communities/{com['id']}/requests/{cris[1]['id']}/resolve", json={"accept": False}, headers=ana[0])
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).json()["joined"] is True
    cris_view = (await client.get(f"/communities/{com['id']}", headers=cris[0])).json()
    assert cris_view["joined"] is False and cris_view["request_pending"] is False
    assert (await client.get(f"/communities/{com['id']}/requests", headers=ana[0])).json() == []


async def test_invite_only_community(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0], access_mode="invite")
    assert all(c["id"] != com["id"] for c in (await client.get("/communities", headers=bea[0])).json())
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).status_code == 404
    assert (await client.post(f"/communities/{com['id']}/join", headers=bea[0])).status_code == 403

    invite = (await client.post(f"/communities/{com['id']}/invite", headers=ana[0])).json()
    assert invite["url"].endswith(f"/app/join/{invite['code']}") and invite["code"] != com["invite_code"]
    assert (await client.post(f"/communities/join/{com['invite_code']}", headers=bea[0])).status_code == 404  # old link
    res = await client.post(f"/communities/join/{invite['code']}", headers=bea[0])
    assert res.json() == {"status": "joined", "community_id": com["id"]}
    assert any(c["id"] == com["id"] for c in (await client.get("/communities", headers=bea[0])).json())
    assert (await client.post(f"/communities/{com['id']}/invite", headers=bea[0])).status_code == 403


async def test_roles(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    dani = await make_user(client, db_session, "dani@example.com", "Dani")
    com = await _create(client, ana[0])
    for u in (bea, cris, dani):
        await client.post(f"/communities/{com['id']}/join", headers=u[0])
    url = f"/communities/{com['id']}/members"

    assert (await client.put(f"{url}/{bea[1]['id']}/role", json={"role": "admin"}, headers=ana[0])).status_code == 200
    # An admin names moderators but not admins.
    assert (await client.put(f"{url}/{cris[1]['id']}/role", json={"role": "moderator"}, headers=bea[0])).status_code == 200
    assert (await client.put(f"{url}/{dani[1]['id']}/role", json={"role": "admin"}, headers=bea[0])).status_code == 403
    # A moderator names nobody.
    assert (await client.put(f"{url}/{dani[1]['id']}/role", json={"role": "moderator"}, headers=cris[0])).status_code == 403
    roles = {m["display_name"]: m["role"] for m in (await client.get(url, headers=dani[0])).json()}
    assert roles == {"Ana": "owner", "Bea": "admin", "Cris": "moderator", "Dani": "member"}

    # Staff remove people below them; a moderator cannot remove an admin.
    assert (await client.delete(f"{url}/{bea[1]['id']}", headers=cris[0])).status_code == 403
    assert (await client.delete(f"{url}/{dani[1]['id']}", headers=cris[0])).status_code == 200

    # PATCH: owner and admins only.
    assert (await client.patch(f"/communities/{com['id']}", json={"rules": "Sé amable"}, headers=cris[0])).status_code == 403
    res = await client.patch(f"/communities/{com['id']}", json={"rules": "Sé amable", "board_mode": "admins"}, headers=bea[0])
    assert res.json()["rules"] == "Sé amable" and res.json()["board_mode"] == "admins"

    # The owner leaves: the oldest admin takes over.
    assert (await client.delete(f"/communities/{com['id']}/membership", headers=ana[0])).json() == {"ok": True}
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).json()["role"] == "owner"


async def test_zone_change_marks_memberships_away_and_back(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0])
    await client.post(f"/communities/{com['id']}/join", headers=bea[0])
    await client.put(f"/communities/{com['id']}/members/{bea[1]['id']}/role", json={"role": "moderator"}, headers=ana[0])
    await client.post("/me/interests", json={"interest_slugs": ["senderismo"]}, headers=bea[0])
    before = {c["id"] for c in (await client.get("/conversations", headers=bea[0])).json()}
    assert com["id"] in before and len(before) >= 1

    res = await client.patch("/me/profile", json={"province": "Barcelona"}, headers=bea[0])
    assert res.status_code == 200, res.text
    assert (await client.get("/conversations", headers=bea[0])).json() == []  # nothing new joined either
    assert (await _member(db_session, com["id"], bea[1]["id"])).away is True
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).status_code == 404
    res = await client.post(f"/conversations/{com['id']}/messages", json={"body": "hola"}, headers=bea[0])
    assert res.status_code == 404
    members = (await client.get(f"/communities/{com['id']}/members", headers=ana[0])).json()
    assert [m["display_name"] for m in members] == ["Ana"]
    assert (await client.get(f"/communities/{com['id']}", headers=ana[0])).json()["member_count"] == 1

    await client.patch("/me/profile", json={"province": "Madrid"}, headers=bea[0])
    assert {c["id"] for c in (await client.get("/conversations", headers=bea[0])).json()} == before
    assert (await client.get(f"/communities/{com['id']}", headers=bea[0])).json()["role"] == "moderator"


async def test_joining_restores_an_away_membership_without_approval(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0], access_mode="request")
    await client.post(f"/communities/{com['id']}/join", headers=bea[0])
    await client.post(f"/communities/{com['id']}/requests/{bea[1]['id']}/resolve", json={"accept": True}, headers=ana[0])
    async with db_session() as db:
        await db.execute(update(ConversationMember).where(ConversationMember.user_id == bea[1]["id"]).values(away=True))
        await db.commit()
    assert (await client.post(f"/communities/{com['id']}/join", headers=bea[0])).json() == {"status": "joined"}
    assert (await _member(db_session, com["id"], bea[1]["id"])).away is False


async def test_explore_follows_communities(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    channels = (await client.get("/channels/explore", headers=ana[0])).json()
    first = channels[0]
    res = await client.post(f"/channels/{first['interest']['id']}/join", headers=ana[0])
    cid = res.json()["conversation_id"]
    explored = {c["conversation_id"]: c for c in (await client.get("/channels/explore", headers=ana[0])).json()}
    assert explored[cid]["joined"] is True and explored[cid]["access_mode"] == "open"
    community = (await client.get(f"/communities/{cid}", headers=ana[0])).json()
    assert community["kind"] == "interest" and community["joined"] is True
    assert community["title"] == first["interest"]["name"] and community["slug"] == first["interest"]["slug"]


async def test_remove_lets_rejoin_but_expel_does_not(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _create(client, ana[0])
    cid, bea_id = com["id"], bea[1]["id"]
    await client.post(f"/communities/{cid}/join", headers=bea[0])

    assert (await client.delete(f"/communities/{cid}/members/{bea_id}", headers=ana[0])).status_code == 200
    assert (await client.post(f"/communities/{cid}/join", headers=bea[0])).json() == {"status": "joined"}

    assert (await client.delete(f"/communities/{cid}/members/{bea_id}", params={"ban": 1}, headers=ana[0])).status_code == 200
    assert (await client.post(f"/communities/{cid}/join", headers=bea[0])).status_code == 403
    assert not any(c["id"] == cid for c in (await client.get("/conversations", headers=bea[0])).json())
    members = (await client.get(f"/communities/{cid}/members", headers=ana[0])).json()
    assert [m["display_name"] for m in members] == ["Ana"]
