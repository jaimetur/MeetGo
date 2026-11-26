"""Who runs a community made by people: the owner who no longer fits it has 30 days to hand it over, then MeetGo hands
it over; every change of owner or co-administrator is emailed to the people concerned."""

from datetime import date, timedelta

import pytest
from sqlalchemy import select, update

from app.communities.ownership import grace_once
from app.core.models import Conversation, ConversationMember, User, utcnow
from app.mail import email as mailer

from tests.helpers import make_user


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def capture(db, to_email, subject, body, html=None, headers=None):
        sent.append({"to": to_email, "subject": subject})

    monkeypatch.setattr(mailer, "smtp_ready", lambda smtp: True)
    monkeypatch.setattr(mailer, "send_email_background", capture)
    return sent


def _dob(age: int) -> str:
    return f"{date.today().year - age - 1}-01-15"


def subjects(outbox, email):
    return [m["subject"] for m in outbox if m["to"] == email and "Confirma" not in m["subject"]]


async def _member(db_session, conv_id, user_id):
    async with db_session() as db:
        return (await db.execute(select(ConversationMember).where(
            ConversationMember.conversation_id == conv_id, ConversationMember.user_id == user_id))).scalar_one()


async def _community(client, headers, **kw):
    res = await client.post("/communities", json={"title": "Club 30-40", "access_mode": "open", "board_mode": "open", **kw}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()["id"]


async def test_coadmins_are_told_and_an_owner_out_of_range_has_30_days(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana", dob=_dob(35))
    bea = await make_user(client, db_session, "bea@example.com", "Bea", dob=_dob(38))
    cid = await _community(client, ana[0], min_age=30, max_age=40)
    assert (await client.post(f"/communities/{cid}/join", headers=bea[0])).status_code == 200

    # naming and removing a co-administrator: an email each time
    await client.put(f"/communities/{cid}/members/{bea[1]['id']}/role", json={"role": "admin"}, headers=ana[0])
    await client.put(f"/communities/{cid}/members/{bea[1]['id']}/role", json={"role": "member"}, headers=ana[0])
    assert subjects(outbox, "bea@example.com") == ["Eres coadministrador de Club 30-40", "Ya no eres coadministrador de Club 30-40"]

    # Ana's birthday takes her out of 30-40: 30 days, an email, and she still runs it
    async with db_session() as db:
        await db.execute(update(User).where(User.email == "ana@example.com").values(dob=_dob(42)))
        await db.commit()
        assert await grace_once(db) == 0
    assert subjects(outbox, "ana@example.com") == ["Tienes 30 días para ceder Club 30-40"]
    filters = (await client.get(f"/communities/{cid}/filters", headers=ana[0])).json()
    assert filters["owner_deadline"]
    async with db_session() as db:
        assert await grace_once(db) == 0  # a second round sends nothing new
    assert len(subjects(outbox, "ana@example.com")) == 1

    # the 30 days are up: Bea (the only other member) runs it, Ana is out; both are told
    async with db_session() as db:
        await db.execute(update(Conversation).where(Conversation.id == cid).values(owner_out_since=utcnow() - timedelta(days=31)))
        await db.commit()
        assert await grace_once(db) == 1
    assert (await _member(db_session, cid, bea[1]["id"])).role == "owner"
    old = await _member(db_session, cid, ana[1]["id"])
    assert old.role == "member" and old.away is True
    assert subjects(outbox, "bea@example.com")[-1] == "Ahora diriges Club 30-40"
    assert subjects(outbox, "ana@example.com")[-1] == "Ya no diriges Club 30-40"


async def test_widening_the_ages_ends_the_grace(client, db_session, outbox):
    ana = await make_user(client, db_session, "ana@example.com", "Ana", dob=_dob(35))
    cid = await _community(client, ana[0], min_age=30, max_age=40)
    async with db_session() as db:
        await db.execute(update(User).where(User.email == "ana@example.com").values(dob=_dob(42)))
        await db.commit()
        await grace_once(db)
    res = await client.post(f"/communities/{cid}/filters", json={"scope_kind": "province", "age_limit": True, "min_age": 30, "max_age": 50}, headers=ana[0])
    assert res.status_code == 200, res.text
    async with db_session() as db:
        await grace_once(db)
        assert (await db.get(Conversation, cid)).owner_out_since is None


async def test_the_owner_hands_the_community_over(client, db_session, outbox):
    leo = await make_user(client, db_session, "leo@example.com", "Leo")
    eva = await make_user(client, db_session, "eva@example.com", "Eva")
    cid = await _community(client, leo[0])
    await client.post(f"/communities/{cid}/join", headers=eva[0])
    assert (await client.post(f"/communities/{cid}/owner", json={"user_id": leo[1]["id"]}, headers=leo[0])).status_code == 404
    res = await client.post(f"/communities/{cid}/owner", json={"user_id": eva[1]["id"]}, headers=leo[0])
    assert res.status_code == 200, res.text
    assert (await _member(db_session, cid, eva[1]["id"])).role == "owner"
    assert (await _member(db_session, cid, leo[1]["id"])).role == "admin"  # still fits: co-administrator
    assert subjects(outbox, "eva@example.com") == ["Ahora diriges Club 30-40"]
    assert subjects(outbox, "leo@example.com") == ["Ya no diriges Club 30-40"]
    # only the owner hands it over
    assert (await client.post(f"/communities/{cid}/owner", json={"user_id": eva[1]["id"]}, headers=leo[0])).status_code == 403
