"""Channels, groups, direct messages, threads, reactions and attachments."""

import io

from PIL import Image

from tests.helpers import befriend, make_user


async def _channel(client, headers, slug="senderismo"):
    assert (await client.post("/me/interests", json={"interest_slugs": [slug]}, headers=headers)).status_code == 200
    convs = (await client.get("/conversations", headers=headers)).json()
    return next(c for c in convs if c["kind"] == "channel" and c["slug"] == slug)


async def _send(client, headers, conv_id, body, **extra):
    res = await client.post(f"/conversations/{conv_id}/messages", json={"body": body, **extra}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def test_choosing_an_interest_joins_the_zone_channel(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    leo = await make_user(client, db_session, "leo@example.com", "Leo", province="Sevilla")
    a = await _channel(client, ana[0])
    b = await _channel(client, bea[0])
    c = await _channel(client, leo[0])
    assert a["id"] == b["id"] != c["id"]
    assert a["title"] == "Senderismo" and a["subtitle"] == "Madrid · 31-60"
    a = next(x for x in (await client.get("/conversations", headers=ana[0])).json() if x["id"] == a["id"])
    assert a["notify"] == "mentions" and a["member_count"] == 2

    # Dropping the interest leaves the channel; the profile is the source of truth.
    await client.post("/me/interests", json={"interest_slugs": []}, headers=bea[0])
    assert not [x for x in (await client.get("/conversations", headers=bea[0])).json() if x["kind"] == "channel"]


async def test_unread_mentions_and_read_marker(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    conv = await _channel(client, ana[0])
    await _channel(client, bea[0])
    await _send(client, ana[0], conv["id"], "¡Buenos días!")
    m2 = await _send(client, ana[0], conv["id"], "@Bea ¿vienes el sábado?", mention_ids=[bea[1]["id"]])
    item = next(c for c in (await client.get("/conversations", headers=bea[0])).json() if c["id"] == conv["id"])
    assert item["unread_count"] == 2 and item["mention_count"] == 1
    assert item["last_message"]["body"].startswith("@Bea")
    mine = next(c for c in (await client.get("/conversations", headers=ana[0])).json() if c["id"] == conv["id"])
    assert mine["unread_count"] == 0

    await client.post(f"/conversations/{conv['id']}/read", json={"message_id": m2["id"]}, headers=bea[0])
    item = next(c for c in (await client.get("/conversations", headers=bea[0])).json() if c["id"] == conv["id"])
    assert item["unread_count"] == 0 and item["mention_count"] == 0
    mentions = (await client.get("/mentions", headers=bea[0])).json()
    assert [m["id"] for m in mentions] == [m2["id"]]


async def test_channel_moderation_removes_insults_but_not_similar_words(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    conv = await _channel(client, ana[0])
    ok = await _send(client, ana[0], conv["id"], "Tiene buena reputación")
    assert not ok["deleted"]
    bad = await _send(client, ana[0], conv["id"], "eres un imbécil")
    assert bad["deleted"] and bad["moderation_reason"] == "TOXICITY" and bad["body"] == ""
    # The insult carried a 60-minute silence.
    res = await client.post(f"/conversations/{conv['id']}/messages", json={"body": "hola"}, headers=ana[0])
    assert res.status_code == 403


async def test_history_pages_and_idempotent_send(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    await befriend(client, ana, bea)
    conv_id = (await client.post("/conversations/dm", json={"user_id": bea[1]["id"]}, headers=ana[0])).json()["conversation_id"]
    ids = [(await _send(client, ana[0], conv_id, f"m{i}"))["id"] for i in range(5)]
    first = await _send(client, ana[0], conv_id, "una vez", client_id="abc-1")
    again = await _send(client, ana[0], conv_id, "una vez", client_id="abc-1")
    assert first["id"] == again["id"]
    page = (await client.get(f"/conversations/{conv_id}/messages?limit=3", headers=bea[0])).json()
    assert [m["body"] for m in page["messages"]] == ["m3", "m4", "una vez"] and page["has_more_before"]
    older = (await client.get(f"/conversations/{conv_id}/messages?limit=3&before_id={page['messages'][0]['id']}", headers=bea[0])).json()
    assert [m["id"] for m in older["messages"]] == ids[:3]


async def test_direct_messages_need_friendship_or_a_request(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea", accept_dm=False)
    cris = await make_user(client, db_session, "cris@example.com", "Cris", accept_dm=True)
    assert (await client.post("/conversations/dm", json={"user_id": bea[1]["id"]}, headers=ana[0])).status_code == 403
    res = (await client.post("/conversations/dm", json={"user_id": cris[1]["id"]}, headers=ana[0])).json()
    assert res["status"] == "pending"
    reqs = (await client.get("/dm/requests", headers=cris[0])).json()
    assert reqs[0]["from_user"]["username"] == "Ana"
    conv_id = (await client.post(f"/dm/requests/{reqs[0]['id']}/resolve", json={"accept": True}, headers=cris[0])).json()["conversation_id"]
    await _send(client, ana[0], conv_id, "¡Hola Cris!")
    item = next(c for c in (await client.get("/conversations", headers=cris[0])).json() if c["id"] == conv_id)
    assert item["kind"] == "dm" and item["title"] == "Ana Prueba (Ana)" and item["unread_count"] == 1

    await befriend(client, ana, bea)
    assert "conversation_id" in (await client.post("/conversations/dm", json={"user_id": bea[1]["id"]}, headers=ana[0])).json()


async def test_groups_invites_roles_and_leaving(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    await befriend(client, ana, bea)
    res = (await client.post("/conversations/groups", json={"title": "Ruta Cercedilla", "member_ids": [bea[1]["id"], cris[1]["id"]]},
                             headers=ana[0])).json()
    gid = res["id"]
    assert res["added"] == [bea[1]["id"]]  # only friends can be added directly
    detail = (await client.get(f"/conversations/{gid}", headers=ana[0])).json()
    assert detail["role"] == "owner" and detail["invite_code"]
    assert (await client.get(f"/conversations/{gid}", headers=bea[0])).json()["invite_code"] is None
    joined = (await client.post(f"/conversations/join/{detail['invite_code']}", headers=cris[0])).json()
    assert joined["conversation_id"] == gid
    members = (await client.get(f"/conversations/{gid}/members", headers=cris[0])).json()
    assert [m["username"] for m in members][0] == "Ana" and len(members) == 3

    assert (await client.delete(f"/conversations/{gid}/members/{ana[1]['id']}", headers=bea[0])).status_code == 403
    assert (await client.delete(f"/conversations/{gid}/members/{ana[1]['id']}", headers=ana[0])).status_code == 200
    members = (await client.get(f"/conversations/{gid}/members", headers=bea[0])).json()
    assert members[0]["role"] == "owner"  # the oldest member inherits the group
    history = (await client.get(f"/conversations/{gid}/messages", headers=bea[0])).json()["messages"]
    assert [m["kind"] for m in history].count("system") >= 3


async def test_threads_reactions_edit_delete(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    conv = await _channel(client, ana[0])
    await _channel(client, bea[0])
    root = await _send(client, ana[0], conv["id"], "Propongo Siete Picos el sábado")
    r1 = await _send(client, bea[0], conv["id"], "¿A qué hora?", thread_root_id=root["id"])
    await _send(client, ana[0], conv["id"], "8:30 en el puerto", thread_root_id=root["id"], also_in_channel=True)
    main = (await client.get(f"/conversations/{conv['id']}/messages", headers=bea[0])).json()["messages"]
    assert [m["body"] for m in main] == ["Propongo Siete Picos el sábado", "8:30 en el puerto"]
    assert main[0]["thread"]["count"] == 2
    thread = (await client.get(f"/conversations/{conv['id']}/messages?thread_root_id={root['id']}", headers=bea[0])).json()
    assert [m["id"] for m in thread["messages"]][0] == r1["id"] and thread["thread_root"]["id"] == root["id"]

    reactions = (await client.put(f"/messages/{root['id']}/reactions/🥾", headers=bea[0])).json()
    assert reactions == [{"emoji": "🥾", "count": 1, "user_ids": [bea[1]["id"]]}]
    assert (await client.patch(f"/messages/{root['id']}", json={"body": "x"}, headers=bea[0])).status_code == 403
    edited = (await client.patch(f"/messages/{root['id']}", json={"body": "Propongo Siete Picos el domingo"}, headers=ana[0])).json()
    assert edited["edited_at"] and edited["reactions"][0]["me"] is False
    assert (await client.delete(f"/messages/{r1['id']}", headers=ana[0])).status_code == 403
    assert (await client.delete(f"/messages/{r1['id']}", headers=bea[0])).status_code == 200
    thread = (await client.get(f"/conversations/{conv['id']}/messages?thread_root_id={root['id']}", headers=ana[0])).json()
    assert thread["messages"][0]["deleted"] and thread["messages"][0]["body"] == ""


async def test_image_attachments_get_a_thumbnail_and_signed_links(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    await befriend(client, ana, bea)
    conv_id = (await client.post("/conversations/dm", json={"user_id": bea[1]["id"]}, headers=ana[0])).json()["conversation_id"]
    buf = io.BytesIO()
    Image.new("RGB", (1200, 800), "#1e90ff").save(buf, "PNG")
    up = await client.post("/uploads", files={"file": ("ruta.png", buf.getvalue(), "image/png")}, headers=ana[0])
    assert up.status_code == 200, up.text
    att = up.json()
    assert att["width"] == 1200 and att["thumb_url"]
    msg = await _send(client, ana[0], conv_id, "", attachment_ids=[att["id"]])
    assert msg["attachments"][0]["file_name"] == "ruta.png"
    thumb = await client.get(msg["attachments"][0]["thumb_url"])
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/webp"
    assert (await client.get(f"/files/{att['id']}/file?exp=9999999999&sig=bad")).status_code == 404
    bad = await client.post("/uploads", files={"file": ("x.exe", b"MZ....", "application/x-msdownload")}, headers=ana[0])
    assert bad.status_code == 415


async def test_search_finds_messages_only_in_your_conversations(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    leo = await make_user(client, db_session, "leo@example.com", "Leo", province="Sevilla")
    conv = await _channel(client, ana[0])
    await _send(client, ana[0], conv["id"], "Quedamos en la Pedriza el domingo")
    assert len((await client.get("/search/messages?q=pedriza", headers=ana[0])).json()) == 1
    assert (await client.get("/search/messages?q=pedriza", headers=leo[0])).json() == []


async def test_deleting_a_chat_only_for_me(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    conv = await _channel(client, ana[0])
    await _channel(client, bea[0])
    await _send(client, ana[0], conv["id"], "hola a todos")
    assert (await client.post(f"/conversations/{conv['id']}/delete-for-me", headers=bea[0])).status_code == 200
    # gone from Bea's list and history; Ana keeps everything
    assert conv["id"] not in [c["id"] for c in (await client.get("/conversations", headers=bea[0])).json()]
    assert (await client.get(f"/conversations/{conv['id']}/messages", headers=bea[0])).json()["messages"] == []
    assert [m["body"] for m in (await client.get(f"/conversations/{conv['id']}/messages", headers=ana[0])).json()["messages"]
            if m["kind"] == "text"] == ["hola a todos"]
    # someone writes again: the chat comes back with only the new message
    await _send(client, ana[0], conv["id"], "¿quedamos?")
    mine = next(c for c in (await client.get("/conversations", headers=bea[0])).json() if c["id"] == conv["id"])
    assert mine["last_message"]["body"] == "¿quedamos?"
    assert [m["body"] for m in (await client.get(f"/conversations/{conv['id']}/messages", headers=bea[0])).json()["messages"]] == ["¿quedamos?"]
