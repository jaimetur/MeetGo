"""Administration endpoints."""

from sqlalchemy import select, update

from app.core.models import Conversation, Interest, User
from app.accounts.common import normalize_phone as _normalize_phone
from app.core.security import hash_password
from app.messaging.moderation import PHONE_RE, contains_toxicity as _contains_toxicity

from tests.helpers import register, verified_token  # noqa: F401


async def test_deleting_a_channel_in_use_is_refused_cleanly(client, db_session):
    admin = await client.post("/admin/login", json={"username": "admin@test.local", "password": "admin-test-password"})
    headers = {"Authorization": f"Bearer {admin.json()['access_token']}"}
    async with db_session() as db:
        interest = (await db.execute(select(Interest).where(Interest.slug == "cine"))).scalar_one()
        db.add(Conversation(kind="channel", province="Madrid", age_range="31_60", interest_id=interest.id,
                            slow_mode_seconds=0, rules_markdown="", policy_json={}))
        await db.commit()
        interest_id = interest.id
    res = await client.delete(f"/admin/interests/{interest_id}", headers=headers)
    assert res.status_code == 409


async def test_debug_logs_endpoint_is_off_by_default(client):
    res = await client.get("/admin/compose-logs")
    assert res.status_code == 404


async def test_overview_person_summary_and_blocking(client, db_session):
    from tests.helpers import admin_headers, make_user
    headers = await admin_headers(client)
    ana_h, ana = await make_user(client, db_session, "ana.stats@example.com", "Ana")

    stats = (await client.get("/admin/stats", headers=headers)).json()
    assert stats["users"]["total"] >= 1 and stats["users"]["new_7d"] >= 1
    assert len(stats["signups"]) == 30 and stats["signups"][-1]["count"] >= 1
    assert {"messages_24h", "communities", "upcoming_plans"} <= set(stats["activity"])
    assert any(p["province"] == "Madrid" for p in stats["provinces"])

    listed = next(u for u in (await client.get("/admin/users", headers=headers)).json() if u["id"] == ana["id"])
    assert listed["created_at"].endswith("Z") and listed["online"] is False and listed["banned_until"] is None

    summary = (await client.get(f"/admin/users/{ana['id']}/summary", headers=headers)).json()
    assert summary["messages"] == 0 and summary["friends"] == 0

    # a week's block keeps her out; lifting it lets her back in
    res = await client.post(f"/admin/users/{ana['id']}/ban", json={"days": 7}, headers=headers)
    assert res.json()["banned_until"] and not res.json()["is_banned"]
    assert (await client.get("/me", headers=ana_h)).status_code == 403
    await client.post(f"/admin/users/{ana['id']}/ban", json={"days": 0}, headers=headers)
    assert (await client.get("/me", headers=ana_h)).status_code == 200
    res = await client.post(f"/admin/users/{ana['id']}/ban", json={"days": None}, headers=headers)
    assert res.json() == {"is_banned": True, "banned_until": None}

    # ordinary people cannot see any of it
    assert (await client.get("/admin/stats", headers=ana_h)).status_code in (401, 403)
