"""Board: posts of each kind, attendance with capacity, waiting list and approval, the plan chat, comments, feed
filters, plan reminders and reports."""

from datetime import datetime, timedelta, timezone

import pytest

from app.board.service import _period, zone
from app.mail import email as mailer
from app.mail import notify_email

from tests.helpers import admin_headers, make_user


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def capture(db, to_email, subject, body, html=None, headers=None):
        sent.append({"to": to_email, "subject": subject, "text": body})

    monkeypatch.setattr(mailer, "smtp_ready", lambda smtp: True)
    monkeypatch.setattr(mailer, "send_email_background", capture)
    return sent


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def soon(hours=48) -> str:
    return iso(datetime.now(timezone.utc) + timedelta(hours=hours))


async def _community(client, owner, *members, **kw):
    body = {"title": "Senderismo Sierra", "access_mode": "open", "board_mode": "open", **kw}
    com = (await client.post("/communities", json=body, headers=owner[0])).json()
    for m in members:
        await client.post(f"/communities/{com['id']}/join", headers=m[0])
    return com


async def _post(client, headers, com_id, **kw):
    body = {"kind": "meetup", "title": "Ruta Cercedilla", "starts_at": soon(), "place": "Estación", **kw}
    res = await client.post(f"/communities/{com_id}/posts", json=body, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


async def _chat_ids(client, headers):
    return {c["id"] for c in (await client.get("/conversations", headers=headers)).json()}


async def test_posting_each_kind_and_board_mode(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    com = await _community(client, ana, bea)

    thread = await _post(client, bea[0], com["id"], kind="thread", title="¿Botas?", body="¿Qué botas usáis?")
    assert thread["kind"] == "thread" and thread["starts_at"] is None and thread["chat_conversation_id"] is None
    assert thread["community"] == {"id": com["id"], "title": "Senderismo Sierra", "slug": "senderismo-sierra"}
    assert thread["can_edit"] is True and thread["can_comment"] is True
    notice = await _post(client, bea[0], com["id"], kind="notice", title="Aviso")
    assert notice["kind"] == "notice"
    res = await client.post(f"/communities/{com['id']}/posts", json={"kind": "meetup", "title": "Sin fecha"}, headers=bea[0])
    assert res.status_code == 400
    meetup = await _post(client, bea[0], com["id"], capacity=8)
    assert meetup["my_status"] == "going" and meetup["going_count"] == 1 and meetup["chat_conversation_id"]
    assert [a["username"] for a in meetup["attendees"]] == ["Bea"]
    event = await _post(client, bea[0], com["id"], kind="event", title="Festival", ends_at=soon(52), link_url="https://x.es")
    assert event["kind"] == "event" and event["link_url"] == "https://x.es"
    res = await client.post(f"/communities/{com['id']}/posts", json={"kind": "thread", "title": "x"}, headers=cris[0])
    assert res.status_code == 403  # not a member

    # Read-only board: only staff publish.
    await client.patch(f"/communities/{com['id']}", json={"board_mode": "admins"}, headers=ana[0])
    res = await client.post(f"/communities/{com['id']}/posts", json={"kind": "thread", "title": "x"}, headers=bea[0])
    assert res.status_code == 403
    await _post(client, ana[0], com["id"], kind="notice", title="Normas")

    # The author edits; only staff pin.
    assert (await client.patch(f"/posts/{thread['id']}", json={"pinned": True}, headers=bea[0])).status_code == 403
    assert (await client.patch(f"/posts/{thread['id']}", json={"pinned": True}, headers=ana[0])).json()["pinned"] is True
    assert (await client.patch(f"/posts/{thread['id']}", json={"title": "Botas"}, headers=bea[0])).json()["title"] == "Botas"
    page = (await client.get(f"/communities/{com['id']}/posts", headers=bea[0])).json()
    assert page["posts"][0]["id"] == thread["id"]  # pinned first in a community view


async def test_capacity_waiting_list_and_plan_chat(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    com = await _community(client, ana, bea, cris)
    post = await _post(client, ana[0], com["id"], capacity=2)
    chat = post["chat_conversation_id"]
    assert chat in await _chat_ids(client, ana[0])
    outbox.clear()

    assert (await client.post(f"/posts/{post['id']}/attend", headers=bea[0])).json() == {"status": "going"}
    assert any("Bea" in m["subject"] for m in outbox if m["to"] == "ana@example.com")
    assert (await client.post(f"/posts/{post['id']}/attend", headers=cris[0])).json() == {"status": "waitlist"}
    assert chat in await _chat_ids(client, bea[0]) and chat not in await _chat_ids(client, cris[0])
    seen = (await client.get(f"/posts/{post['id']}", headers=cris[0])).json()
    assert seen["going_count"] == 2 and seen["waitlist_count"] == 1 and seen["my_status"] == "waitlist"
    assert seen["chat_conversation_id"] is None  # only for people going and the organiser

    assert (await client.delete(f"/posts/{post['id']}/attend", headers=ana[0])).status_code == 409  # the organiser
    assert (await client.delete(f"/posts/{post['id']}/attend", headers=bea[0])).json() == {"ok": True}
    assert chat not in await _chat_ids(client, bea[0]) and chat in await _chat_ids(client, cris[0])
    assert (await client.get(f"/posts/{post['id']}", headers=cris[0])).json()["my_status"] == "going"
    assert any(m["to"] == "cris@example.com" and "Ruta Cercedilla" in m["subject"] for m in outbox)
    attendees = (await client.get(f"/posts/{post['id']}/attendees", headers=bea[0])).json()
    assert [(a["username"], a["status"]) for a in attendees] == [("Ana", "going"), ("Cris", "going")]

    plans = (await client.get("/me/plans", params={"when": "upcoming"}, headers=cris[0])).json()
    assert [p["id"] for p in plans] == [post["id"]]
    assert [p["id"] for p in (await client.get("/me/plans", params={"when": "organizing"}, headers=ana[0])).json()] == [post["id"]]
    assert (await client.get("/me/plans", params={"when": "organizing"}, headers=cris[0])).json() == []

    # Changing the date tells the people going.
    outbox.clear()
    await client.patch(f"/posts/{post['id']}", json={"starts_at": soon(72)}, headers=ana[0])
    assert [m["to"] for m in outbox] == ["cris@example.com"]

    # Deleting tells them too, and the plan chat stays, read-only.
    outbox.clear()
    assert (await client.delete(f"/posts/{post['id']}", headers=ana[0])).json() == {"ok": True}
    assert [m["to"] for m in outbox] == ["cris@example.com"]
    assert (await client.get(f"/posts/{post['id']}", headers=cris[0])).status_code == 404
    res = await client.post(f"/conversations/{chat}/messages", json={"body": "¿Y ahora?"}, headers=cris[0])
    assert res.status_code == 403


async def test_join_with_approval(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    com = await _community(client, ana, bea, cris)
    post = await _post(client, ana[0], com["id"], join_mode="approval")
    assert (await client.post(f"/posts/{post['id']}/attend", headers=bea[0])).json() == {"status": "pending"}
    assert (await client.post(f"/posts/{post['id']}/attend", headers=cris[0])).json() == {"status": "pending"}
    assert [a["status"] for a in (await client.get(f"/posts/{post['id']}/attendees", headers=bea[0])).json()] == ["going"]
    pending = [a["username"] for a in (await client.get(f"/posts/{post['id']}/attendees", headers=ana[0])).json()
               if a["status"] == "pending"]
    assert pending == ["Bea", "Cris"]

    url = f"/posts/{post['id']}/attendees"
    assert (await client.post(f"{url}/{cris[1]['id']}/resolve", json={"accept": True}, headers=bea[0])).status_code == 403
    assert (await client.post(f"{url}/{bea[1]['id']}/resolve", json={"accept": True}, headers=ana[0])).json() == {"ok": True}
    assert (await client.post(f"{url}/{cris[1]['id']}/resolve", json={"accept": False}, headers=ana[0])).json() == {"ok": True}
    assert (await client.get(f"/posts/{post['id']}", headers=bea[0])).json()["my_status"] == "going"
    assert (await client.get(f"/posts/{post['id']}", headers=cris[0])).json()["my_status"] is None
    assert post["chat_conversation_id"] in await _chat_ids(client, bea[0])


async def test_comments_modes(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    out = await make_user(client, db_session, "out@example.com", "Out")
    com = await _community(client, ana, bea, cris)

    async def comment(post, who):
        return await client.post(f"/posts/{post['id']}/comments", json={"body": "¡Me apunto!"}, headers=who[0])

    open_post = await _post(client, ana[0], com["id"], kind="thread", title="Hilo")
    assert (await comment(open_post, bea)).status_code == 200
    assert (await comment(open_post, out)).status_code == 403  # not a member
    page = (await client.get(f"/posts/{open_post['id']}/comments", headers=cris[0])).json()
    assert [c["author"]["username"] for c in page["comments"]] == ["Bea"] and page["comments"][0]["can_delete"] is False
    assert (await client.get(f"/posts/{open_post['id']}", headers=cris[0])).json()["comment_count"] == 1

    plan = await _post(client, ana[0], com["id"], comments_mode="attendees")
    assert (await comment(plan, bea)).status_code == 403
    assert (await client.get(f"/posts/{plan['id']}", headers=bea[0])).json()["can_comment"] is False
    await client.post(f"/posts/{plan['id']}/attend", headers=bea[0])
    created = await comment(plan, bea)
    assert created.status_code == 200 and created.json()["can_delete"] is True
    assert (await comment(plan, ana)).status_code == 200  # the organiser

    off = await _post(client, ana[0], com["id"], kind="notice", title="Aviso", comments_mode="off")
    assert (await comment(off, bea)).status_code == 403

    await client.patch(f"/posts/{open_post['id']}", json={"closed": True}, headers=ana[0])
    assert (await comment(open_post, bea)).status_code == 403

    # Authors and staff delete comments.
    cid = created.json()["id"]
    assert (await client.delete(f"/comments/{cid}", headers=cris[0])).status_code == 403
    assert (await client.delete(f"/comments/{cid}", headers=ana[0])).json() == {"ok": True}


async def test_feed_filters(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _community(client, ana, bea)
    other = await _community(client, ana, title="Otra")  # Bea is not in it
    now = datetime.now(timezone.utc)
    tz = zone(None)
    _, today_end = _period("today", tz, now)
    w_start, w_end = _period("weekend", tz, now)
    w_from = max(w_start, now)
    when = {
        "today": now + (today_end - now) / 2,
        "weekend": w_from + (w_end - w_from) / 2,
        "in3days": now + timedelta(days=3),
        "far": now + timedelta(days=30),
        "past": now - timedelta(days=2),
    }
    ids = {}
    for name, starts in when.items():
        ids[name] = (await _post(client, ana[0], com["id"], title=name, starts_at=iso(starts)))["id"]
    ids["thread"] = (await _post(client, ana[0], com["id"], kind="thread", title="thread"))["id"]
    await _post(client, ana[0], other["id"], kind="thread", title="elsewhere")

    async def feed(**params):
        res = await client.get("/board/feed", params=params, headers=bea[0])
        assert res.status_code == 200, res.text
        return [p["title"] for p in res.json()["posts"]]

    everything = await feed()
    assert everything[0] == "thread" and set(everything) == set(ids) and "elsewhere" not in everything
    assert await feed(kind="thread") == ["thread"]
    upcoming = await feed(when="upcoming")
    assert upcoming == sorted(["today", "weekend", "in3days", "far"], key=lambda n: when[n])
    assert await feed(when="past") == ["past"]
    assert "today" in await feed(when="today") and "far" not in await feed(when="today")
    assert "weekend" in await feed(when="weekend") and "far" not in await feed(when="weekend")
    week = await feed(when="week")
    assert {"today", "in3days"} <= set(week) and "far" not in week and "past" not in week

    first = (await client.get("/board/feed", params={"when": "upcoming", "limit": 2}, headers=bea[0])).json()
    assert first["has_more"] is True and len(first["posts"]) == 2
    rest = (await client.get("/board/feed", params={"when": "upcoming", "limit": 2, "before_id": first["posts"][-1]["id"]},
                             headers=bea[0])).json()
    assert [p["title"] for p in first["posts"] + rest["posts"]] == upcoming and rest["has_more"] is False
    assert (await client.get("/board/feed", params={"when": "soon"}, headers=bea[0])).status_code == 400

    # Past plans: in the past plans of the people who went.
    assert [p["title"] for p in (await client.get("/me/plans", params={"when": "past"}, headers=ana[0])).json()] == ["past"]
    assert (await client.post(f"/posts/{ids['past']}/attend", headers=bea[0])).status_code == 409


async def test_plan_reminders_go_out_once(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    com = await _community(client, ana, bea, cris)
    post = await _post(client, ana[0], com["id"], starts_at=soon(20))
    await _post(client, ana[0], com["id"], title="Later", starts_at=soon(60))
    await client.post(f"/posts/{post['id']}/attend", headers=bea[0])
    await client.patch("/me/email-prefs", json={"plans": False}, headers=cris[0])
    await client.post(f"/posts/{post['id']}/attend", headers=cris[0])
    outbox.clear()
    async with db_session() as db:
        assert await notify_email.plans_reminders_once(db) == 3
        assert await notify_email.plans_reminders_once(db) == 0
    assert sorted(m["to"] for m in outbox) == ["ana@example.com", "bea@example.com"]  # Cris turned plan emails off
    assert all("Ruta Cercedilla" in m["subject"] for m in outbox)
    me = (await client.get("/me", headers=bea[0])).json()
    assert me["email_prefs"]["plans"] is True

    # A new date is a new reminder.
    await client.patch(f"/posts/{post['id']}", json={"starts_at": soon(22)}, headers=ana[0])
    outbox.clear()
    async with db_session() as db:
        assert await notify_email.plans_reminders_once(db) == 3


async def test_reports_reach_the_moderation_queue(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _community(client, ana, bea)
    post = await _post(client, ana[0], com["id"], kind="thread", title="Compra aquí", body="spam spam")
    assert (await client.post(f"/posts/{post['id']}/report", json={"reason": "spam"}, headers=ana[0])).status_code == 400
    assert (await client.post(f"/posts/{post['id']}/report", json={"reason": "spam"}, headers=bea[0])).json() == {"ok": True}
    assert (await client.post(f"/posts/{post['id']}/report", json={"reason": "spam"}, headers=bea[0])).json() == {"ok": True}

    admin = await admin_headers(client)
    [report] = (await client.get("/admin/reports", headers=admin)).json()
    assert report["kind"] == "post" and report["post"]["title"] == "Compra aquí"
    assert report["message"]["sender"]["username"] == "Ana" and "spam spam" in report["message"]["body"]
    res = await client.post(f"/admin/reports/{report['id']}/resolve", json={"status": "actioned", "delete_message": True},
                            headers=admin)
    assert res.json() == {"ok": True}
    assert (await client.get(f"/posts/{post['id']}", headers=bea[0])).status_code == 404
    assert (await client.get("/admin/reports", headers=admin)).json() == []


async def test_away_communities_leave_the_feed(client, db_session):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    com = await _community(client, ana, bea)
    post = await _post(client, ana[0], com["id"], kind="thread", title="Hola")
    assert [p["id"] for p in (await client.get("/board/feed", headers=bea[0])).json()["posts"]] == [post["id"]]
    await client.patch("/me/profile", json={"province": "Sevilla"}, headers=bea[0])
    assert (await client.get("/board/feed", headers=bea[0])).json()["posts"] == []
    res = await client.post(f"/communities/{com['id']}/posts", json={"kind": "thread", "title": "x"}, headers=bea[0])
    assert res.status_code == 404


async def test_gallery_cover_and_plans_filter(client, db_session):
    """A plan can take a gallery illustration instead of a photo; the «plan» filter brings plans and events."""
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    com = await _community(client, ana)
    plan = await _post(client, ana[0], com["id"], cover_art="hiking")
    assert plan["cover_art"] == "hiking" and plan["cover_url"] is None
    bad = await client.post(f"/communities/{com['id']}/posts", headers=ana[0],
                            json={"kind": "meetup", "title": "x", "starts_at": soon(), "cover_art": "../etc/passwd"})
    assert bad.status_code == 400
    assert (await client.patch(f"/posts/{plan['id']}", json={"cover_art": "beach"}, headers=ana[0])).json()["cover_art"] == "beach"
    assert (await client.patch(f"/posts/{plan['id']}", json={"cover_art": ""}, headers=ana[0])).json()["cover_art"] is None
    event = await _post(client, ana[0], com["id"], kind="event", title="Concierto", cover_art="concert")
    await _post(client, ana[0], com["id"], kind="notice", title="Aviso", starts_at=None)
    kinds = {p["kind"] for p in (await client.get("/board/feed", params={"kind": "plan"}, headers=ana[0])).json()["posts"]}
    assert kinds == {"meetup", "event"} and event["cover_art"] == "concert"
