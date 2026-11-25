"""Subscriptions: read-only without a plan, the 50-place launch code, admin grants and Stripe webhooks."""

import hashlib
import hmac
import json
import time

from sqlalchemy import select

from app.core.models import User
from app.core.app_settings import set_section
from app.core.crypto import encrypt
from tests.helpers import admin_headers, make_user


async def _enable(client):
    res = await client.put("/admin/billing", json={"enabled": True, "trial_days": 7}, headers=await admin_headers(client))
    assert res.status_code == 200 and res.json()["enabled"]


async def _dm_with_self_check(client, headers):
    """Writing anything: create a group (needs write access)."""
    return await client.post("/conversations/groups", json={"title": "Prueba"}, headers=headers)


async def test_accounts_from_before_subscriptions_stay_free(client, db_session):
    old = await make_user(client, db_session, "old@example.com", "Old")
    await _enable(client)
    assert (await _dm_with_self_check(client, old[0])).status_code == 200
    status = (await client.get("/billing/status", headers=old[0])).json()
    assert status["active"] and status["source"] == "free"


async def test_new_accounts_without_a_plan_are_read_only(client, db_session):
    await _enable(client)
    new = await make_user(client, db_session, "new@example.com", "New")
    assert (await _dm_with_self_check(client, new[0])).status_code == 402
    assert (await client.get("/conversations", headers=new[0])).status_code == 200
    status = (await client.get("/billing/status", headers=new[0])).json()
    assert status == {**status, "active": False, "required": True, "source": None}


async def test_launch_code_gives_a_year_to_the_first_places_only(client, db_session):
    await _enable(client)
    admin = await admin_headers(client)
    res = await client.put("/admin/promo-codes", json={"code": "lanzamiento", "aliases": ["MEETGO50"], "duration": "1y",
                                                        "max_uses": 2, "public": True}, headers=admin)
    assert res.json()["left"] == 2
    a = await make_user(client, db_session, "a@example.com", "A_user", promo_code="lanzamiento")
    b = await make_user(client, db_session, "b@example.com", "B_user", promo_code="Meet Go 50")
    status = (await client.get("/billing/status", headers=a[0])).json()
    assert status["source"] == "grant" and status["grant"]["source"] == "LANZAMIENTO"
    assert status["grant"]["until"][:4] in {str(time.gmtime().tm_year + 1)}
    assert (await _dm_with_self_check(client, b[0])).status_code == 200
    assert (await client.get("/billing/promos")).json()["promos"] == []  # full: no longer advertised

    res = await client.post("/auth/register", json={"email": "c@example.com", "phone": "699000111", "password": "secret123",
                                                     "display_name": "Cecilia", "first_name": "Cecilia", "last_name": "Prueba",
                                                     "dob": "1990-01-01", "province": "Madrid",
                                                     "promo_code": "LANZAMIENTO"})
    assert res.status_code == 409
    async with db_session() as db:
        assert (await db.execute(select(User).where(User.email == "c@example.com"))).first() is None
    assert (await client.put("/admin/promo-codes", json={"code": "LANZAMIENTO", "duration": "1y", "max_uses": 1},
                             headers=admin)).status_code == 409


async def test_seeded_campaign_is_public_with_fifty_places(client):
    await _enable(client)
    promos = (await client.get("/billing/promos")).json()["promos"]
    assert promos == [{"code": "LANZAMIENTO", "duration": "1y", "max": 50, "left": 50, "expires_on": None}]
    plans = (await client.get("/billing/plans")).json()
    assert [(p["id"], p["amount"]) for p in plans["plans"]] == [("monthly", 250), ("yearly", 2500)]


async def test_admin_grants_and_redeeming_later(client, db_session):
    await _enable(client)
    user = await make_user(client, db_session, "u@example.com", "U_user")
    admin = await admin_headers(client)
    res = await client.put(f"/admin/users/{user[1]['id']}/access", json={"free_until": "lifetime"}, headers=admin)
    assert res.json()["active"] and res.json()["grant"]["until"] is None
    await client.put(f"/admin/users/{user[1]['id']}/access", json={"free_until": "none"}, headers=admin)
    assert not (await client.get("/billing/status", headers=user[0])).json()["active"]
    res = await client.post("/billing/redeem", json={"code": "lanzamiento"}, headers=user[0])
    assert res.status_code == 200 and res.json()["active"]
    assert (await client.post("/billing/redeem", json={"code": "lanzamiento"}, headers=user[0])).status_code == 409


async def test_stripe_webhook_needs_a_valid_signature_and_activates_the_plan(client, db_session):
    await _enable(client)
    user = await make_user(client, db_session, "s@example.com", "S_user")
    async with db_session() as db:
        await set_section(db, "stripe", {"webhook_enc": encrypt("whsec_test"), "secret_enc": encrypt("sk_test"),
                                         "prices": {"monthly": "price_m", "yearly": "price_y"}})
    event = {"type": "customer.subscription.updated", "data": {"object": {
        "id": "sub_1", "customer": "cus_1", "status": "trialing", "cancel_at_period_end": False,
        "metadata": {"user_id": str(user[1]["id"])},
        "items": {"data": [{"id": "si_1", "current_period_end": int(time.time()) + 7 * 86400,
                            "price": {"id": "price_y", "lookup_key": "meetgo_yearly_2500", "recurring": {"interval": "year"}}}]},
    }}}
    payload = json.dumps(event).encode()
    ts = str(int(time.time()))
    sig = hmac.new(b"whsec_test", f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    bad = await client.post("/billing/stripe/webhook", content=payload, headers={"stripe-signature": f"t={ts},v1=deadbeef"})
    assert bad.status_code == 400
    ok = await client.post("/billing/stripe/webhook", content=payload, headers={"stripe-signature": f"t={ts},v1={sig}"})
    assert ok.status_code == 200
    status = (await client.get("/billing/status", headers=user[0])).json()
    assert status["source"] == "stripe" and status["stripe"]["plan"] == "yearly" and status["stripe"]["status"] == "trialing"
    assert (await _dm_with_self_check(client, user[0])).status_code == 200
