"""Administration → Business: MRR, trial conversion and periods with made-up data, the APK download counter, and no
response carrying a secret."""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.billing import service as billing
from app.business import service as biz
from app.core.models import PlaySubscription, StripeSubscription
from tests.helpers import admin_headers, make_user

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


def ts(days_ago: float) -> int:
    return int((NOW - timedelta(days=days_ago)).timestamp())


def test_mrr_counts_yearly_plans_as_a_twelfth():
    assert biz.monthly_value("monthly") == 2.5
    assert round(biz.monthly_value("yearly"), 4) == round(25 / 12, 4)
    assert biz.monthly_value("meetgo-anual") == biz.monthly_value("yearly")
    assert biz.monthly_value(None) == 0


def test_stripe_figures_collected_refunds_conversion_and_cancellations():
    charges = [
        {"created": ts(2), "status": "succeeded", "paid": True, "amount": 250, "amount_captured": 250, "amount_refunded": 0},
        {"created": ts(10), "status": "succeeded", "paid": True, "amount": 2500, "amount_captured": 2500, "amount_refunded": 2500},
        {"created": ts(3), "status": "failed", "paid": False, "amount": 250},
        {"created": ts(60), "status": "succeeded", "paid": True, "amount": 250, "amount_captured": 250},  # before the period
    ]
    subs = [
        {"status": "active", "trial_start": ts(20), "trial_end": ts(13)},  # converted
        {"status": "canceled", "trial_start": ts(15), "trial_end": ts(8), "canceled_at": ts(8.5)},  # left during the trial
        {"status": "canceled", "trial_start": ts(25), "trial_end": ts(18), "canceled_at": ts(5)},  # paid, then left
        {"status": "trialing", "trial_start": ts(2), "trial_end": int((NOW + timedelta(days=5)).timestamp())},  # not ended
    ]
    since = biz.since_of("30d", NOW)
    f = biz.stripe_figures(charges, subs, since, "30d", NOW)
    assert (f["collected"], f["refunded"], f["net"]) == (27.5, 25.0, 2.5)
    assert f["trials_ended"] == 3 and f["converted"] == 2 and f["conversion"] == round(2 / 3, 3)
    assert f["cancelled"] == 2
    assert sum(f["values"].values()) == 2.5
    every = biz.stripe_figures(charges, subs, None, "all", NOW)
    assert every["collected"] == 30.0  # all time includes the old charge


def test_periods_and_their_chart_buckets():
    assert len(biz.buckets("7d", NOW, None)) == 7 and biz.buckets("7d", NOW, None)[-1] == "2026-11-25"
    assert len(biz.buckets("30d", NOW, None)) == 30
    months = biz.buckets("12m", NOW, None)
    assert months[0] == "2025-11" and months[-1] == "2026-11"
    assert biz.buckets("all", NOW, datetime(2026, 9, 3, tzinfo=timezone.utc)) == ["2026-09", "2026-10", "2026-11"]


def test_play_reports_parse():
    installs = biz._csv_rows("Date,Package Name,Daily Device Installs,Daily User Installs\n2026-11-01,app.meetgo.android,4,3\n2026-11-02,app.meetgo.android,2,2\n".encode("utf-16"))
    assert biz.installs_from_rows(installs) == {"2026-11-01": 3, "2026-11-02": 2}
    earnings = biz._csv_rows(b"Description,Product id,Amount (Merchant Currency),Merchant Currency\nCharge,app.meetgo.android,2.06,EUR\nGoogle fee,app.meetgo.android,-0.31,EUR\n")
    assert biz.earnings_from_rows(earnings) == (1.75, "EUR")


async def test_dashboard_with_real_data_and_no_secret(client, db_session, monkeypatch):
    headers = await admin_headers(client)
    _, ana = await make_user(client, db_session, "ana@example.com", "Ana")
    _, bea = await make_user(client, db_session, "bea@example.com", "Bea")
    _, cris = await make_user(client, db_session, "cris@example.com", "Cris")
    async with db_session() as db:
        db.add(StripeSubscription(user_id=ana["id"], customer_id="cus_1", subscription_id="sub_1", plan="monthly", status="active"))
        db.add(StripeSubscription(user_id=bea["id"], customer_id="cus_2", subscription_id="sub_2", plan="yearly", status="trialing"))
        db.add(PlaySubscription(user_id=cris["id"], token_hash="h", token_enc="x", product_id="meetgo", base_plan="yearly",
                                state="SUBSCRIPTION_STATE_ACTIVE", expiry=datetime.now(timezone.utc) + timedelta(days=200)))
        await db.commit()

    # the APK: each download counts
    apk = Path(os.environ["DATA_DIR"]) / "downloads" / "meetgo-android.apk"
    apk.parent.mkdir(parents=True, exist_ok=True)
    apk.write_bytes(b"PK apk")
    for _ in range(2):
        assert (await client.get("/downloads/android.apk")).status_code == 200

    for period in ("7d", "30d", "12m", "all"):
        d = (await client.get("/admin/business", params={"period": period}, headers=headers)).json()
        assert d["period"] == period and d["users"]["total"] >= 3 and d["users"]["series"]
    d = (await client.get("/admin/business", params={"period": "30d"}, headers=headers)).json()
    s = d["subscriptions"]
    assert s["paid"] == 2 and s["trialing"] == 1 and s["by_plan"] == {"monthly": 1, "yearly": 1}
    assert s["by_channel"] == {"web": 1, "play": 1}
    assert d["revenue"]["mrr"]["total"] == round(2.5 + 25 / 12, 2)
    assert d["revenue"]["stripe"]["state"] == "unconfigured" and d["play"]["tracks"]["state"] == "unconfigured"
    assert d["downloads"]["apk"]["total"] == 2 and d["downloads"]["apk"]["period"] == 2
    assert d["downloads"]["play"]["state"] == "unconfigured"
    assert d["health"]["disk"]["free"] > 0
    assert (await client.get("/admin/business", headers=(await make_user(client, db_session, "dan@example.com"))[0])).status_code == 403

    # secrets go in, but never come back: only their last characters
    secret, webhook = "sk_test_SECRETVALUE1234567890abcd", "whsec_WEBHOOKSECRET0987654321wxyz"

    async def prices(_secret):
        return {"monthly": "price_m", "yearly": "price_y"}
    monkeypatch.setattr(billing, "stripe_ensure_prices", prices)
    res = await client.put("/admin/billing", json={"stripe": {"secret": secret, "webhook": webhook},
                                                   "play": {"reports_bucket": "gs://pubsite_prod_123"}}, headers=headers)
    assert res.status_code == 200, res.text
    got = res.json()
    assert got["stripe"]["secret_ends"] == "abcd" and got["stripe"]["webhook_ends"] == "wxyz"
    assert got["play"]["reports_bucket"] == "gs://pubsite_prod_123"
    settings = await client.put("/admin/settings", json={"smtp": {"host": "smtp.example.com", "password": "MAILPASSWORD-123"}}, headers=headers)
    assert settings.json()["smtp"]["password"] == "" and settings.json()["smtp"]["password_set"] is True
    # saved again without retyping it: the stored one stays
    again = await client.put("/admin/settings", json={"smtp": {**settings.json()["smtp"], "host": "smtp2.example.com"}}, headers=headers)
    assert again.json()["smtp"]["password_set"] is True

    async def no_network(*a, **k):
        raise RuntimeError("Stripe unreachable")
    monkeypatch.setattr(billing, "stripe_call", no_network)
    biz.clear_cache()
    d = (await client.get("/admin/business", params={"period": "30d"}, headers=headers)).json()
    assert d["revenue"]["stripe"]["state"] == "error" and "unreachable" in d["revenue"]["stripe"]["error"]
    test = (await client.post("/admin/business/test", json={"source": "stripe"}, headers=headers)).json()
    assert test["ok"] is False
    for text in [
        (await client.get("/admin/billing", headers=headers)).text,
        (await client.get("/admin/settings", headers=headers)).text,
        (await client.get("/admin/business", params={"period": "all"}, headers=headers)).text,
        str(test),
    ]:
        for value in (secret, webhook, "MAILPASSWORD-123"):
            assert value not in text
