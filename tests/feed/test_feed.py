"""Everyone's wall and stories: who sees what, reactions, comments, shares, saved posts, reports; stories for 24
hours with views, reactions and replies (as a direct message)."""

import io
from datetime import timedelta

from PIL import Image
from sqlalchemy import select, update

from app.core.models import Story, utcnow
from tests.helpers import admin_headers, befriend, make_user


async def _photo(client, headers):
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 50, 50)).save(buf, "PNG")
    res = await client.post("/uploads", files={"file": ("p.png", buf.getvalue(), "image/png")}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["id"]


async def test_wall_audiences_reactions_comments_shares(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    leo = await make_user(client, db_session, "leo@example.com", "Leo", province="Sevilla")
    await befriend(client, ana, bea)
    photo = await _photo(client, ana[0])
    res = await client.post("/feed/posts", json={"body": "Ruta de hoy @Bea", "attachment_ids": [photo]}, headers=ana[0])
    assert res.status_code == 200, res.text
    post = res.json()
    assert post["audience"] == "friends" and len(post["media"]) == 1 and post["mine"]

    # friends see it; a stranger from another province does not
    assert [p["id"] for p in (await client.get("/feed/friends", headers=bea[0])).json()["posts"]] == [post["id"]]
    assert (await client.get(f"/feed/posts/{post['id']}", headers=leo[0])).status_code == 404
    assert (await client.get(f"/feed/wall/{ana[1]['id']}", headers=leo[0])).json()["posts"] == []
    # public: people of her zone see it
    pub = (await client.post("/feed/posts", json={"body": "Para todos", "audience": "public"}, headers=ana[0])).json()
    carl = await make_user(client, db_session, "carl@example.com", "Carl")  # Madrid too
    assert (await client.get(f"/feed/posts/{pub['id']}", headers=carl[0])).status_code == 200
    assert (await client.get(f"/feed/posts/{pub['id']}", headers=leo[0])).status_code == 404

    # reactions, comments with a reply, share to my wall, save
    r = (await client.put(f"/feed/posts/{post['id']}/reaction", json={"emoji": "❤️"}, headers=bea[0])).json()
    assert r["reactions"] == {"❤️": 1} and r["my_reaction"] == "❤️"
    c = (await client.post(f"/feed/posts/{post['id']}/comments", json={"body": "¡Qué bonito!"}, headers=bea[0])).json()
    rep = (await client.post(f"/feed/posts/{post['id']}/comments", json={"body": "Gracias", "parent_id": c["id"]}, headers=ana[0])).json()
    assert rep["parent_id"] == c["id"]
    assert len((await client.get(f"/feed/posts/{post['id']}/comments", headers=bea[0])).json()) == 2
    share = (await client.post("/feed/posts", json={"body": "Mirad esto", "shared_from_id": post["id"]}, headers=bea[0])).json()
    assert share["shared"]["id"] == post["id"]
    again = (await client.get(f"/feed/posts/{post['id']}", headers=ana[0])).json()
    assert again["comments"] == 2 and again["shares"] == 1
    await client.post(f"/feed/posts/{post['id']}/save", headers=bea[0])
    assert [p["id"] for p in (await client.get("/feed/saved", headers=bea[0])).json()["posts"]] == [post["id"]]

    # only the author edits; a report reaches Moderation; deleted posts go
    assert (await client.patch(f"/feed/posts/{post['id']}", json={"body": "x"}, headers=bea[0])).status_code == 403
    assert (await client.post(f"/feed/posts/{post['id']}/report", json={"reason": "spam"}, headers=bea[0])).status_code == 200
    reports = (await client.get("/admin/reports", headers=await admin_headers(client))).json()
    assert any(x["kind"] == "feed" and x["message"]["body"].startswith("Ruta de hoy") for x in reports)
    await client.delete(f"/feed/posts/{post['id']}", headers=ana[0])
    assert (await client.get(f"/feed/posts/{post['id']}", headers=bea[0])).status_code == 404


async def test_stories(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    carl = await make_user(client, db_session, "carl@example.com", "Carl")
    await befriend(client, ana, bea)
    await befriend(client, ana, carl)
    photo = await _photo(client, ana[0])
    assert (await client.post("/stories", json={"kind": "photo", "attachment_id": photo, "text": "Hola"}, headers=ana[0])).status_code == 200
    text = (await client.post("/stories", json={"kind": "text", "text": "Buenos días", "bg": "#7c3aed",
                                                 "hidden_from": [carl[1]["id"]]}, headers=ana[0])).json()
    strip = (await client.get("/stories", headers=bea[0])).json()
    assert len(strip) == 1 and len(strip[0]["stories"]) == 2 and not strip[0]["all_seen"]
    assert len((await client.get("/stories", headers=carl[0])).json()[0]["stories"]) == 1  # hidden from Carl

    sid = strip[0]["stories"][0]["id"]
    await client.post(f"/stories/{sid}/view", json={"reaction": "🔥"}, headers=bea[0])
    viewers = (await client.get(f"/stories/{sid}/viewers", headers=ana[0])).json()
    assert viewers[0]["reaction"] == "🔥"
    assert (await client.get(f"/stories/{sid}/viewers", headers=bea[0])).status_code == 404  # only for the author
    res = await client.post(f"/stories/{text['id']}/reply", json={"body": "¡Igualmente!"}, headers=bea[0])
    assert res.status_code == 200, res.text
    chats = {c["id"] for c in (await client.get("/conversations", headers=ana[0])).json()}
    assert res.json()["conversation_id"] in chats  # the reply reaches her as a direct message

    # after 24 hours they are gone
    async with db_session() as db:
        await db.execute(update(Story).values(expires_at=utcnow() - timedelta(minutes=1)))
        await db.commit()
    assert (await client.get("/stories", headers=bea[0])).json() == []
    from app.messaging.retention import purge_stories
    async with db_session() as db:
        assert await purge_stories(db) == 2
        assert not (await db.execute(select(Story.id))).first()
