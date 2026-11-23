"""Subscriptions: 2.50 €/month or 25 €/year through Stripe (web) or Google Play (Android app),
plus free-access grants from promotional codes (the launch campaign: one year free for the
first 50 accounts) or from an administrator.

Accounts created before subscriptions were switched on keep free access (access_required is
false). An account without an active plan or grant can read but not write (HTTP 402).
"""

import calendar
import hashlib
import hmac
import json
import time
import unicodedata
from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException
from jose import jwt
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import t
from app.core.models import AccessGrant, PlaySubscription, PromoCode, StripeSubscription, User, utcnow
from app.core.app_settings import app_base_url, get_section
from app.core.crypto import decrypt, sha256

MADRID = ZoneInfo("Europe/Madrid")
CURRENCY = "eur"
PLANS = {
    "monthly": {"amount": 250, "interval": "month", "lookup_key": "meetgo_monthly_250"},
    "yearly": {"amount": 2500, "interval": "year", "lookup_key": "meetgo_yearly_2500"},
}
DEFAULT_TRIAL_DAYS = 7
STRIPE_ACTIVE = {"active", "trialing", "past_due"}
PLAY_ACTIVE = {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"}
PLAY_RECHECK = timedelta(hours=1)
DURATIONS = {"1m": 1, "3m": 3, "6m": 6, "1y": 12}


# ---------- settings ----------

async def billing_config(db: AsyncSession) -> dict:
    cfg = await get_section(db, "billing")
    return {"enabled": bool(cfg.get("enabled")), "trial_days": int(cfg.get("trial_days", DEFAULT_TRIAL_DAYS))}


async def stripe_config(db: AsyncSession) -> dict:
    cfg = await get_section(db, "stripe")
    return {"secret": decrypt(cfg.get("secret_enc", "")), "webhook": decrypt(cfg.get("webhook_enc", "")),
            "prices": cfg.get("prices") or {}}


async def play_config(db: AsyncSession) -> dict:
    cfg = await get_section(db, "play")
    return {"package": cfg.get("package") or "app.meetgo.android", "product": cfg.get("product") or "meetgo",
            "service_account": decrypt(cfg.get("service_account_enc", "")), "store_url": cfg.get("store_url") or ""}


# ---------- entitlement ----------

def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def access_status(db: AsyncSession, user: User, refresh: bool = False) -> dict:
    now = utcnow()
    grant = await db.get(AccessGrant, user.id)
    stripe_sub = await db.get(StripeSubscription, user.id)
    play_sub = await db.get(PlaySubscription, user.id)
    if refresh and play_sub and play_sub.state in PLAY_ACTIVE | {"SUBSCRIPTION_STATE_CANCELED"} \
            and (_aware(play_sub.expiry) or now) <= now and now - _aware(play_sub.checked_at) > PLAY_RECHECK:
        try:
            await play_refresh(db, play_sub)
        except Exception:
            pass

    grant_active = bool(grant and (grant.until is None or _aware(grant.until) > now))
    stripe_active = bool(stripe_sub and stripe_sub.status in STRIPE_ACTIVE)
    play_active = bool(play_sub and (_aware(play_sub.expiry) or now) > now
                       and play_sub.state in PLAY_ACTIVE | {"SUBSCRIPTION_STATE_CANCELED"})
    source = "grant" if grant_active else "stripe" if stripe_active else "play" if play_active else None
    if not source and not user.access_required:
        source = "free"
    return {
        "active": source is not None,
        "required": bool(user.access_required),
        "source": source,
        "grant": {"source": grant.source, "until": _iso(grant.until)} if grant else None,
        "stripe": {"plan": stripe_sub.plan, "status": stripe_sub.status, "period_end": _iso(stripe_sub.period_end),
                   "cancel_at_period_end": stripe_sub.cancel_at_period_end} if stripe_sub else None,
        "play": {"plan": play_sub.base_plan, "state": play_sub.state, "expiry": _iso(play_sub.expiry)} if play_sub else None,
    }


def _iso(dt: datetime | None) -> str | None:
    dt = _aware(dt)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


async def has_write_access(db: AsyncSession, user: User) -> bool:
    if not user.access_required or user.role == "admin":
        return True
    return (await access_status(db, user))["active"]


# ---------- promotional codes ----------

def normalise_code(code: str) -> str:
    folded = "".join(c for c in unicodedata.normalize("NFD", code or "") if unicodedata.category(c) != "Mn")
    return "".join(folded.split()).upper()


def grant_until(duration: str, today: date | None = None) -> datetime | None:
    """End of the last day (Madrid time) of the free period; None means for life."""
    if duration == "life":
        return None
    today = today or datetime.now(MADRID).date()
    if duration in DURATIONS:
        months = DURATIONS[duration]
        y, m = divmod(today.month - 1 + months, 12)
        year, month = today.year + y, m + 1
        last = date(year, month, min(today.day, calendar.monthrange(year, month)[1]))
    else:
        last = date.fromisoformat(duration)
    return datetime.combine(last, dtime(23, 59, 59), MADRID).astimezone(timezone.utc)


def promo_out(p: PromoCode) -> dict:
    left = None if p.max_uses is None else max(p.max_uses - p.used, 0)
    return {"code": p.code, "aliases": p.aliases or [], "duration": p.duration, "max": p.max_uses, "used": p.used,
            "left": left, "public": p.public, "expires_on": p.expires_on}


async def public_promos(db: AsyncSession) -> list[dict]:
    today = datetime.now(MADRID).date().isoformat()
    res = await db.execute(select(PromoCode).where(PromoCode.public.is_(True)).order_by(PromoCode.created_at))
    out = []
    for p in res.scalars().all():
        if p.expires_on and p.expires_on < today:
            continue
        item = promo_out(p)
        if item["left"] == 0:
            continue
        out.append({k: item[k] for k in ("code", "duration", "max", "left", "expires_on")})
    return out


async def redeem_code(db: AsyncSession, user: User, code: str) -> AccessGrant:
    """Use one place of a code and give its free period. Does not commit."""
    norm = normalise_code(code)
    if not norm:
        raise HTTPException(400, t("err_promo_invalid"))
    existing = await db.get(AccessGrant, user.id)
    if existing and existing.source != "admin":
        raise HTTPException(409, t("err_promo_already_used"))
    today = datetime.now(MADRID).date().isoformat()
    # One atomic statement: two people taking the last place cannot both get it.
    res = await db.execute(text("""
        UPDATE promo_codes SET used = used + 1
        WHERE (code = :code OR aliases @> to_jsonb(ARRAY[:code]::text[]))
          AND (max_uses IS NULL OR used < max_uses)
          AND (expires_on IS NULL OR expires_on >= :today)
        RETURNING code, duration
    """), {"code": norm, "today": today})
    row = res.first()
    if not row:
        known = (await db.execute(select(PromoCode.code).where(
            or_(PromoCode.code == norm, PromoCode.aliases.contains([norm]))))).first()
        if known:
            raise HTTPException(409, t("err_promo_exhausted"))
        raise HTTPException(404, t("err_promo_invalid"))
    until = grant_until(row.duration)
    if existing:
        if existing.until is not None and (until is None or until > _aware(existing.until)):
            existing.until = until
            existing.source = row.code
        return existing
    grant = AccessGrant(user_id=user.id, source=row.code, until=until)
    db.add(grant)
    return grant


async def admin_set_free_access(db: AsyncSession, user: User, free_until: str) -> None:
    grant = await db.get(AccessGrant, user.id)
    if free_until == "none":
        if grant:
            await db.delete(grant)
        return
    until = None if free_until == "lifetime" else grant_until(free_until)
    if grant:
        grant.until, grant.source = until, "admin"
    else:
        db.add(AccessGrant(user_id=user.id, source="admin", until=until))


# ---------- Stripe ----------

def _form(data: dict, prefix: str = "") -> list[tuple[str, str]]:
    """Stripe's bracketed form encoding: {"a": {"b": 1}} -> a[b]=1."""
    out: list[tuple[str, str]] = []
    for key, value in data.items():
        name = f"{prefix}[{key}]" if prefix else str(key)
        if isinstance(value, dict):
            out += _form(value, name)
        elif isinstance(value, list):
            for i, item in enumerate(value):
                out += _form(item, f"{name}[{i}]") if isinstance(item, dict) else [(f"{name}[{i}]", str(item))]
        elif isinstance(value, bool):
            out.append((name, "true" if value else "false"))
        elif value is not None:
            out.append((name, str(value)))
    return out


async def stripe_call(secret: str, method: str, path: str, data: dict | None = None, params: list | None = None) -> dict:
    if not secret:
        raise HTTPException(503, t("err_payments_not_configured"))
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.request(method, f"https://api.stripe.com/v1{path}", auth=(secret, ""),
                                   data=_form(data) if data else None, params=params)
    body = res.json() if res.content else {}
    if res.status_code >= 400:
        raise HTTPException(502, (body.get("error") or {}).get("message") or t("err_payments_failed"))
    return body


async def stripe_ensure_prices(secret: str) -> dict:
    """Find the two prices by lookup key, creating the product and prices the first time."""
    prices = {}
    product_id = None
    for plan, spec in PLANS.items():
        found = await stripe_call(secret, "GET", "/prices", params=[("lookup_keys[]", spec["lookup_key"]), ("active", "true")])
        if found.get("data"):
            prices[plan] = found["data"][0]["id"]
            continue
        if not product_id:
            product_id = (await stripe_call(secret, "POST", "/products", {"name": "MeetGo"}))["id"]
        price = await stripe_call(secret, "POST", "/prices", {
            "unit_amount": spec["amount"], "currency": CURRENCY, "product": product_id,
            "recurring": {"interval": spec["interval"]}, "lookup_key": spec["lookup_key"],
            "tax_behavior": "inclusive",
        })
        prices[plan] = price["id"]
    return prices


async def stripe_checkout(db: AsyncSession, user: User, plan: str) -> str:
    if plan not in PLANS:
        raise HTTPException(400, t("err_invalid_plan"))
    cfg = await stripe_config(db)
    price = cfg["prices"].get(plan)
    if not price:
        raise HTTPException(503, t("err_payments_not_configured"))
    base = await app_base_url(db)
    existing = await db.get(StripeSubscription, user.id)
    had_free = await db.get(AccessGrant, user.id)
    data: dict = {
        "mode": "subscription",
        "line_items": [{"price": price, "quantity": 1}],
        "client_reference_id": str(user.id),
        "metadata": {"user_id": str(user.id)},
        "subscription_data": {"metadata": {"user_id": str(user.id)}},
        "success_url": f"{base}/app/?billing=success&session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{base}/app/?billing=cancel",
        "payment_method_collection": "always",
        "locale": "auto",
    }
    if existing:
        data["customer"] = existing.customer_id
    else:
        data["customer_email"] = user.email
    trial = (await billing_config(db))["trial_days"]
    if trial > 0 and not existing and not had_free:
        data["subscription_data"]["trial_period_days"] = trial
    session = await stripe_call(cfg["secret"], "POST", "/checkout/sessions", data)
    return session["url"]


def _plan_from_subscription(sub: dict, prices: dict) -> str:
    items = ((sub.get("items") or {}).get("data") or [])
    price = (items[0].get("price") or {}) if items else {}
    lookup = price.get("lookup_key") or ""
    for plan, spec in PLANS.items():
        if lookup == spec["lookup_key"] or price.get("id") == prices.get(plan):
            return plan
    return "monthly" if (price.get("recurring") or {}).get("interval") == "month" else "yearly"


async def stripe_save(db: AsyncSession, user_id: int, sub: dict) -> StripeSubscription:
    cfg = await stripe_config(db)
    items = ((sub.get("items") or {}).get("data") or [])
    period_end = sub.get("current_period_end") or (items[0].get("current_period_end") if items else None)
    row = await db.get(StripeSubscription, user_id)
    if not row:
        res = await db.execute(select(StripeSubscription).where(StripeSubscription.subscription_id == sub["id"]))
        row = res.scalar_one_or_none()
    if not row:
        row = StripeSubscription(user_id=user_id, customer_id=sub.get("customer") or "", subscription_id=sub["id"],
                                 plan="monthly", status="incomplete")
        db.add(row)
    row.customer_id = sub.get("customer") or row.customer_id
    row.subscription_id = sub["id"]
    row.plan = _plan_from_subscription(sub, cfg["prices"])
    row.status = sub.get("status") or row.status
    row.period_end = datetime.fromtimestamp(period_end, timezone.utc) if period_end else None
    row.cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
    row.updated_at = utcnow()
    return row


async def stripe_complete(db: AsyncSession, user: User, session_id: str) -> None:
    cfg = await stripe_config(db)
    session = await stripe_call(cfg["secret"], "GET", f"/checkout/sessions/{session_id}", params=[("expand[]", "subscription")])
    if str(session.get("client_reference_id")) != str(user.id):
        raise HTTPException(403, t("err_forbidden"))
    sub = session.get("subscription")
    if isinstance(sub, dict):
        await stripe_save(db, user.id, sub)
        await db.commit()


def stripe_verify_signature(payload: bytes, header: str, secret: str, tolerance: int = 600) -> dict:
    if not secret or not header:
        raise HTTPException(400, "missing signature")
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    signatures = [p.split("=", 1)[1] for p in header.split(",") if p.startswith("v1=")]
    timestamp = parts.get("t", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > tolerance:
        raise HTTPException(400, "stale signature")
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    if not any(hmac.compare_digest(expected, s) for s in signatures):
        raise HTTPException(400, "bad signature")
    return json.loads(payload)


async def stripe_webhook(db: AsyncSession, payload: bytes, signature: str) -> None:
    cfg = await stripe_config(db)
    event = stripe_verify_signature(payload, signature, cfg["webhook"])
    obj = (event.get("data") or {}).get("object") or {}
    kind = event.get("type", "")
    if kind == "checkout.session.completed" and obj.get("subscription"):
        user_id = int(obj.get("client_reference_id") or (obj.get("metadata") or {}).get("user_id") or 0)
        if user_id and await db.get(User, user_id):
            sub = await stripe_call(cfg["secret"], "GET", f"/subscriptions/{obj['subscription']}")
            await stripe_save(db, user_id, sub)
            await db.commit()
    elif kind.startswith("customer.subscription."):
        user_id = int((obj.get("metadata") or {}).get("user_id") or 0)
        if not user_id:
            res = await db.execute(select(StripeSubscription.user_id).where(StripeSubscription.subscription_id == obj.get("id")))
            user_id = res.scalar_one_or_none() or 0
        if user_id and await db.get(User, user_id):
            await stripe_save(db, user_id, obj)
            await db.commit()


async def stripe_portal(db: AsyncSession, user: User) -> str:
    row = await db.get(StripeSubscription, user.id)
    if not row:
        raise HTTPException(404, t("err_no_subscription"))
    cfg = await stripe_config(db)
    base = await app_base_url(db)
    session = await stripe_call(cfg["secret"], "POST", "/billing_portal/sessions",
                                {"customer": row.customer_id, "return_url": f"{base}/app/?view=account"})
    return session["url"]


async def stripe_set_cancel(db: AsyncSession, user: User, cancel: bool) -> None:
    row = await db.get(StripeSubscription, user.id)
    if not row:
        raise HTTPException(404, t("err_no_subscription"))
    cfg = await stripe_config(db)
    sub = await stripe_call(cfg["secret"], "POST", f"/subscriptions/{row.subscription_id}", {"cancel_at_period_end": cancel})
    await stripe_save(db, user.id, sub)
    await db.commit()


async def stripe_change_plan(db: AsyncSession, user: User, plan: str) -> None:
    if plan not in PLANS:
        raise HTTPException(400, t("err_invalid_plan"))
    row = await db.get(StripeSubscription, user.id)
    if not row:
        raise HTTPException(404, t("err_no_subscription"))
    cfg = await stripe_config(db)
    sub = await stripe_call(cfg["secret"], "GET", f"/subscriptions/{row.subscription_id}")
    item_id = sub["items"]["data"][0]["id"]
    sub = await stripe_call(cfg["secret"], "POST", f"/subscriptions/{row.subscription_id}", {
        "items": [{"id": item_id, "price": cfg["prices"][plan]}], "proration_behavior": "none"})
    await stripe_save(db, user.id, sub)
    await db.commit()


# ---------- Google Play ----------

_play_token: dict = {"value": None, "exp": 0.0, "key": None}


async def _play_access_token(sa: dict) -> str:
    if _play_token["value"] and _play_token["key"] == sa.get("client_email") and _play_token["exp"] > time.time() + 60:
        return _play_token["value"]
    now = int(time.time())
    assertion = jwt.encode({
        "iss": sa["client_email"], "scope": "https://www.googleapis.com/auth/androidpublisher",
        "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600,
    }, sa["private_key"], algorithm="RS256")
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post("https://oauth2.googleapis.com/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
    res.raise_for_status()
    body = res.json()
    _play_token.update({"value": body["access_token"], "exp": now + int(body.get("expires_in", 3600)),
                        "key": sa["client_email"]})
    return body["access_token"]


async def _play_get(cfg: dict, token: str) -> dict:
    sa = json.loads(cfg["service_account"] or "{}")
    if not sa.get("client_email"):
        raise HTTPException(503, t("err_payments_not_configured"))
    access = await _play_access_token(sa)
    url = (f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{cfg['package']}"
           f"/purchases/subscriptionsv2/tokens/{token}")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.get(url, headers={"Authorization": f"Bearer {access}"})
    if res.status_code >= 400:
        raise HTTPException(400, t("err_purchase_invalid"))
    return res.json()


async def _play_acknowledge(cfg: dict, product: str, token: str) -> None:
    sa = json.loads(cfg["service_account"] or "{}")
    access = await _play_access_token(sa)
    url = (f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{cfg['package']}"
           f"/purchases/subscriptions/{product}/tokens/{token}:acknowledge")
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(url, headers={"Authorization": f"Bearer {access}"}, json={})


def _play_fields(purchase: dict) -> tuple[str, datetime | None, str | None]:
    items = purchase.get("lineItems") or []
    expiry = items[0].get("expiryTime") if items else None
    base_plan = ((items[0].get("offerDetails") or {}).get("basePlanId")) if items else None
    exp = datetime.fromisoformat(expiry.replace("Z", "+00:00")) if expiry else None
    return purchase.get("subscriptionState", "SUBSCRIPTION_STATE_UNSPECIFIED"), exp, base_plan


async def play_link(db: AsyncSession, user: User, token: str, product: str | None) -> None:
    """Attach a Google Play purchase to this account (new purchase or restore)."""
    from app.core.crypto import encrypt
    cfg = await play_config(db)
    product = product or cfg["product"]
    purchase = await _play_get(cfg, token)
    state, expiry, base_plan = _play_fields(purchase)
    if state not in PLAY_ACTIVE and not (expiry and expiry > utcnow()):
        raise HTTPException(402, t("err_purchase_inactive"))
    token_hash = sha256(token)
    res = await db.execute(select(PlaySubscription).where(PlaySubscription.token_hash == token_hash))
    owner = res.scalar_one_or_none()
    if owner and owner.user_id != user.id:
        raise HTTPException(409, t("err_purchase_other_account"))
    row = await db.get(PlaySubscription, user.id)
    if not row:
        row = PlaySubscription(user_id=user.id, token_hash=token_hash, token_enc=encrypt(token), product_id=product, state=state)
        db.add(row)
    row.token_hash, row.token_enc, row.product_id = token_hash, encrypt(token), product
    row.state, row.expiry, row.base_plan, row.checked_at = state, expiry, base_plan, utcnow()
    await db.commit()
    if purchase.get("acknowledgementState") != "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED":
        try:
            await _play_acknowledge(cfg, product, token)
        except Exception:
            pass  # retried on the next check; Google refunds after 3 days without it


async def play_refresh(db: AsyncSession, row: PlaySubscription) -> None:
    cfg = await play_config(db)
    token = decrypt(row.token_enc)
    purchase = await _play_get(cfg, token)
    row.state, row.expiry, row.base_plan = _play_fields(purchase)
    row.checked_at = utcnow()
    await db.commit()
