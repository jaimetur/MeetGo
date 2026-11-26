"""Automatic emails: account emails, notification choices, unsubscribe links, the unread digest and plan reminders."""

import urllib.parse
from datetime import timedelta

import pytest
from sqlalchemy import update

from app.core.models import AccessGrant, Message, User, naive_utcnow, utcnow
from app.mail import email as mailer
from app.mail import notify_email
from app.core.app_settings import set_section

from tests.helpers import befriend, make_user


@pytest.fixture
def outbox(monkeypatch):
    """Mail is configured and every queued email lands here instead of an SMTP server."""
    sent: list[dict] = []

    async def capture(db, to_email, subject, body, html=None, headers=None):
        sent.append({"to": to_email, "subject": subject, "text": body, "html": html, "headers": headers or {}})

    monkeypatch.setattr(mailer, "smtp_ready", lambda smtp: True)
    monkeypatch.setattr(mailer, "send_email_background", capture)
    return sent


def to(outbox, email):
    return [m for m in outbox if m["to"] == email]


async def test_sign_up_needs_a_real_email_and_sends_the_confirmation(client, outbox):
    base = {"phone": "611222333", "password": "secret123", "display_name": "Ana", "first_name": "Ana",
            "last_name": "Prueba", "dob": "1990-01-01", "country": "ES", "province": "Madrid"}
    for bad in ("", "ana", "ana@example", "ana@@example.com", "ana example@x.com"):
        res = await client.post("/auth/register", json={**base, "email": bad})
        assert res.status_code == 400, bad
    res = await client.post("/auth/register", json={**base, "email": "Ana@Example.com"})
    assert res.status_code == 200, res.text
    [mail] = to(outbox, "ana@example.com")
    assert "verify_token=" in mail["text"] and "<html" in mail["html"]
    assert "List-Unsubscribe" not in mail["headers"]  # account emails cannot be turned off


async def test_resend_verification_is_limited_and_silent(client, db_session, outbox):
    base = {"email": "leo@example.com", "phone": "611222334", "password": "secret123", "display_name": "Leo",
            "first_name": "Leo", "last_name": "Prueba", "dob": "1990-01-01", "country": "ES", "province": "Madrid"}
    assert (await client.post("/auth/register", json=base)).status_code == 200
    outbox.clear()
    assert (await client.post("/auth/resend-verification", json={"email": "leo@example.com"})).json() == {"ok": True}
    assert len(to(outbox, "leo@example.com")) == 1
    await client.post("/auth/resend-verification", json={"email": "leo@example.com"})
    assert len(to(outbox, "leo@example.com")) == 1  # at most every 2 minutes
    assert (await client.post("/auth/resend-verification", json={"email": "nobody@example.com"})).json() == {"ok": True}
    assert not to(outbox, "nobody@example.com")


async def test_friend_requests_email_unless_turned_off(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    cris = await make_user(client, db_session, "cris@example.com", "Cris")
    outbox.clear()

    await client.post("/friends/requests", json={"to_user_id": bea[1]["id"]}, headers=ana[0])
    [mail] = to(outbox, "bea@example.com")
    assert "Ana" in mail["subject"]
    assert "/email/unsubscribe?" in mail["text"] and mail["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"

    me = (await client.patch("/me/email-prefs", json={"requests": False, "reports": True, "categories": True}, headers=bea[0])).json()
    assert me["email_prefs"] == {"mentions": True, "messages": True, "requests": False, "plans": True}  # reports: administrators only
    await client.post("/friends/requests", json={"to_user_id": bea[1]["id"]}, headers=cris[0])
    assert len(to(outbox, "bea@example.com")) == 1

    # Accepting tells the person who asked.
    req_id = (await client.get("/friends/requests/incoming", headers=bea[0])).json()[0]["id"]
    await client.post(f"/friends/requests/{req_id}/resolve", json={"accept": True}, headers=bea[0])
    assert any("Bea" in m["subject"] for m in to(outbox, "cris@example.com") + to(outbox, "ana@example.com"))


async def test_unsubscribe_link(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    url = notify_email.unsubscribe_url(ana[1]["id"], "digest")
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
    assert (await client.get("/email/unsubscribe", params={**query, "s": "0" * 32})).status_code == 404
    res = await client.post("/email/unsubscribe", params=query)
    assert res.status_code == 200 and "<html" in res.text
    prefs = (await client.get("/me", headers=ana[0])).json()["email_prefs"]
    assert prefs["mentions"] is False and prefs["messages"] is False and prefs["requests"] is True


async def test_switch_off_in_administration_stops_notifications(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    async with db_session() as db:
        await set_section(db, "email_notifications", {"enabled": False})
        await db.commit()
    outbox.clear()
    await client.post("/friends/requests", json={"to_user_id": bea[1]["id"]}, headers=ana[0])
    assert not outbox


async def _age_messages(db_session, minutes=30):
    async with db_session() as db:
        await db.execute(update(Message).values(created_at=utcnow() - timedelta(minutes=minutes)))
        await db.execute(update(User).values(last_seen_at=naive_utcnow() - timedelta(hours=2)))
        await db.commit()


async def test_digest_of_unread_messages(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    await befriend(client, ana, bea)
    group = (await client.post("/conversations/groups", json={"title": "Ruta", "member_ids": [bea[1]["id"]]}, headers=ana[0])).json()
    gid = group.get("id") or group["conversation"]["id"]
    for text in ("¿Quedamos el sábado?", "A las 9 en Cercedilla"):
        await client.post(f"/conversations/{gid}/messages", json={"body": text}, headers=ana[0])
    outbox.clear()

    async with db_session() as db:
        assert await notify_email.digest_once(db) == 0  # too recent: she may still read it in the app
    await _age_messages(db_session)
    async with db_session() as db:
        assert await notify_email.digest_once(db) == 1
    [mail] = to(outbox, "bea@example.com")
    assert "Cercedilla" in mail["text"] and "Ruta" in mail["text"]
    assert not to(outbox, "ana@example.com")  # never about your own messages

    # Nothing twice, and nothing new during the pause between digests.
    await client.post(f"/conversations/{gid}/messages", json={"body": "¿Alguien más?"}, headers=ana[0])
    await _age_messages(db_session)
    async with db_session() as db:
        assert await notify_email.digest_once(db) == 0
        await db.execute(update(User).values(last_digest_email_at=utcnow() - timedelta(hours=4)))
        await db.commit()
        assert await notify_email.digest_once(db) == 1
        assert await notify_email.digest_once(db) == 0


async def test_digest_skips_what_was_read_and_mentions_come_first(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    await befriend(client, ana, bea)
    group = (await client.post("/conversations/groups", json={"title": "Ruta", "member_ids": [bea[1]["id"]]}, headers=ana[0])).json()
    gid = group.get("id") or group["conversation"]["id"]
    sent = (await client.post(f"/conversations/{gid}/messages", json={"body": "hola"}, headers=ana[0])).json()
    await client.post(f"/conversations/{gid}/read", json={"message_id": sent["id"]}, headers=bea[0])
    await _age_messages(db_session)
    outbox.clear()
    async with db_session() as db:
        assert await notify_email.digest_once(db) == 0

    await client.post(f"/conversations/{gid}/messages", json={"body": "@Bea mira esto", "mention_ids": [bea[1]["id"]]}, headers=ana[0])
    await _age_messages(db_session)
    async with db_session() as db:
        assert await notify_email.digest_once(db) == 1
    [mail] = to(outbox, "bea@example.com")
    assert "Ana" in mail["subject"]


async def test_moderation_email(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    bea = await make_user(client, db_session, "bea@example.com", "Bea")
    await befriend(client, ana, bea)
    group = (await client.post("/conversations/groups", json={"title": "Ruta", "member_ids": [bea[1]["id"]]}, headers=ana[0])).json()
    gid = group.get("id") or group["conversation"]["id"]
    outbox.clear()
    res = await client.post(f"/conversations/{gid}/members/{bea[1]['id']}/moderate", json={"action": "ban"}, headers=ana[0])
    assert res.status_code == 200, res.text
    [mail] = to(outbox, "bea@example.com")
    assert "Ruta" in mail["subject"]


async def test_free_access_reminders_go_out_once(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    async with db_session() as db:
        await db.execute(update(User).where(User.id == ana[1]["id"]).values(access_required=True))
        db.add(AccessGrant(user_id=ana[1]["id"], source="code:LANZAMIENTO", until=utcnow() + timedelta(days=5)))
        await db.commit()
    async with db_session() as db:
        assert await notify_email.reminders_once(db) == 0  # subscriptions off: the app is free, nothing ends
        await set_section(db, "billing", {"enabled": True})
        await db.commit()
    outbox.clear()
    async with db_session() as db:
        assert await notify_email.reminders_once(db) == 1
        assert await notify_email.reminders_once(db) == 0
    [mail] = to(outbox, "ana@example.com")
    assert "/app/account" in mail["text"]


async def test_subscriptions_off_hides_campaigns(client, db_session):
    assert (await client.get("/billing/promos")).json() == {"subscriptions": False, "promos": []}
    assert (await client.get("/settings/public")).json()["subscriptions"] is False
    async with db_session() as db:
        await set_section(db, "billing", {"enabled": True})
        await db.commit()
    data = (await client.get("/billing/promos")).json()
    assert data["subscriptions"] is True and data["promos"][0]["code"] == "LANZAMIENTO"


async def test_admin_only_emails_for_what_waits_for_review(client, db_session, outbox):
    """Reports, proposed categories and communities to join or split: email choices only administrators have."""
    from app.core.models import User
    ana = await make_user(client, db_session, "ana@example.com", "Ana")
    boss = await make_user(client, db_session, "boss@example.com", "Boss")
    async with db_session() as db:
        await db.execute(update(User).where(User.email == "boss@example.com").values(role="admin"))
        await db.commit()
    assert set((await client.get("/me", headers=boss[0])).json()["email_prefs"]) >= {"reports", "categories", "communities"}
    assert not {"reports", "categories", "communities"} & set((await client.get("/me", headers=ana[0])).json()["email_prefs"])
    me = (await client.patch("/me/email-prefs", json={"categories": True}, headers=ana[0])).json()
    assert "categories" not in me["email_prefs"]

    outbox.clear()
    res = await client.post("/communities", json={"title": "Astrónomos", "access_mode": "open", "board_mode": "open",
                                                  "category_proposal": "Astronomía"}, headers=ana[0])
    assert res.status_code == 200, res.text
    [mail] = to(outbox, "boss@example.com")
    assert "Astronomía" in mail["text"]
    assert not to(outbox, "ana@example.com")

    await client.patch("/me/email-prefs", json={"categories": False}, headers=boss[0])
    outbox.clear()
    await client.post("/communities", json={"title": "Tertulias", "access_mode": "open", "board_mode": "open",
                                            "category_proposal": "Opinión"}, headers=ana[0])
    assert not to(outbox, "boss@example.com")
