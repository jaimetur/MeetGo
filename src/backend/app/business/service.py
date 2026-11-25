"""Administration → Business: the figures that matter to run MeetGo as a business, each with where it comes from.

Every block says its source ("meetgo", "stripe", "play_reports", "play_api", "server") and when it was read. A source
that is not set up says so (state "unconfigured") and one that fails says its error (state "error"): the panel never
breaks because of one of them, and it never shows made-up figures.

- Users, subscriptions, MRR and the direct APK downloads come from MeetGo's own database (always current).
- Stripe: charges, refunds, trial conversions and cancellations through its API (cached 10 minutes).
- Google Play: the published version on each track (Android Publisher API) and the monthly installs and earnings
  reports in the developer account's Cloud Storage bucket (pubsite_prod_…), read with the same service account.
  The reports arrive with a delay (installs: a few days; earnings: the month after).
"""

from __future__ import annotations

import csv
import io
import json
import time
import zipfile
from datetime import date, datetime, timedelta, timezone

import httpx
from jose import jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing import service as billing
from app.core.app_settings import get_section
from app.core.models import AccessGrant, PlaySubscription, PromoCode, StripeSubscription, User, utcnow

PERIODS = {"7d": 7, "30d": 30, "12m": 365, "all": None}
CACHE_TTL = 600
PLAY_TTL = 900
_cache: dict[str, tuple[float, object]] = {}


def clear_cache() -> None:
    _cache.clear()


async def cached(key: str, ttl: int, fn):
    """The value of fn(), kept ttl seconds; a failure is not kept."""
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    value = await fn()
    _cache[key] = (time.time() + ttl, value)
    return value


def _iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def since_of(period: str, now: datetime) -> datetime | None:
    days = PERIODS[period]
    return now - timedelta(days=days) if days else None


def by_month(period: str) -> bool:
    return period in ("12m", "all")


def buckets(period: str, now: datetime, first: datetime | None) -> list[str]:
    """The labels of the chart: days (YYYY-MM-DD) for 7 and 30 days, months (YYYY-MM) for 12 months and all."""
    if not by_month(period):
        days = PERIODS[period]
        return [(now - timedelta(days=days - 1 - i)).date().isoformat() for i in range(days)]
    start = (now - timedelta(days=364)) if period == "12m" else (first or now)
    out, y, m = [], start.year, start.month
    while (y, m) <= (now.year, now.month):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def label_of(dt: datetime, period: str) -> str:
    return dt.strftime("%Y-%m") if by_month(period) else dt.date().isoformat()


def series(labels: list[str], values: dict[str, float]) -> list[dict]:
    return [{"label": k, "value": values.get(k, 0)} for k in labels]


# ---------- MRR and subscriptions (MeetGo's database) ----------

def monthly_value(plan: str | None) -> float:
    """What a plan brings in each month, in euros: a yearly one counts a twelfth."""
    p = billing.PLANS.get(_plan_key(plan))
    if not p:
        return 0.0
    return p["amount"] / 100 / (12 if p["interval"] == "year" else 1)


def _plan_key(plan: str | None) -> str:
    plan = (plan or "").lower()
    return "yearly" if ("year" in plan or "anual" in plan or "annual" in plan) else "monthly" if plan else ""


def _aware(dt: datetime | None) -> datetime | None:
    return None if dt is None else dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def subscriptions_block(db: AsyncSession, now: datetime) -> dict:
    cfg = await billing.billing_config(db)
    stripe_rows = (await db.execute(select(StripeSubscription))).scalars().all()
    play_rows = (await db.execute(select(PlaySubscription))).scalars().all()
    grants = (await db.execute(select(AccessGrant))).scalars().all()
    paid = {"monthly": 0, "yearly": 0}
    channel = {"web": 0, "play": 0}
    mrr = {"web": 0.0, "play": 0.0}
    trialing = ended = 0
    active_users: set[int] = set()
    for s in stripe_rows:
        if s.status == "trialing":
            trialing += 1
            active_users.add(s.user_id)
        elif s.status in billing.STRIPE_ACTIVE:
            key = _plan_key(s.plan) or "monthly"
            paid[key] += 1
            channel["web"] += 1
            mrr["web"] += monthly_value(key)
            active_users.add(s.user_id)
        else:
            ended += 1
    for p in play_rows:
        live = p.state in billing.PLAY_ACTIVE or (p.state == "SUBSCRIPTION_STATE_CANCELED" and (_aware(p.expiry) or now) > now)
        if live:
            key = _plan_key(p.base_plan) or "monthly"
            paid[key] += 1
            channel["play"] += 1
            mrr["play"] += monthly_value(key)
            active_users.add(p.user_id)
        else:
            ended += 1
    live_grants = [g for g in grants if g.until is None or _aware(g.until) > now]
    active_users |= {g.user_id for g in live_grants}
    people = User.bot_role.is_(None)
    required = (await db.execute(select(User.id).where(people, User.access_required.is_(True), User.role != "admin"))).scalars().all()
    read_only = sum(1 for uid in required if uid not in active_users)
    free_legacy = int((await db.execute(select(func.count()).select_from(User).where(people, User.access_required.is_(False)))).scalar() or 0)
    codes = (await db.execute(select(PromoCode).order_by(PromoCode.created_at))).scalars().all()
    promos = [{"code": c.code, "used": c.used, "max": c.max_uses, "left": None if c.max_uses is None else max(0, c.max_uses - c.used),
               "public": c.public, "expires_on": c.expires_on} for c in codes]
    launch = next((p for p in promos if p["public"] and p["max"] is not None), None)
    return {
        "source": "meetgo", "updated_at": _iso(now), "state": "ok",
        "enabled": cfg["enabled"], "trial_days": cfg["trial_days"],
        "paid": sum(paid.values()), "trialing": trialing, "ended": ended, "read_only": read_only,
        "by_plan": paid, "by_channel": channel,
        "gifts": {"total": len(live_grants), "promo": sum(1 for g in live_grants if g.source != "admin"),
                  "admin": sum(1 for g in live_grants if g.source == "admin")},
        "free_legacy": free_legacy,
        "promos": promos, "launch": launch,
        "mrr": {"total": round(mrr["web"] + mrr["play"], 2), "web": round(mrr["web"], 2), "play": round(mrr["play"], 2)},
    }


# ---------- users ----------

async def users_block(db: AsyncSession, period: str, now: datetime) -> dict:
    people = User.bot_role.is_(None)
    naive = now.replace(tzinfo=None)
    since = since_of(period, naive)

    async def count(*where) -> int:
        return int((await db.execute(select(func.count()).select_from(User).where(people, *where))).scalar() or 0)

    first = (await db.execute(select(func.min(User.created_at)).where(people))).scalar()
    unit = "month" if by_month(period) else "day"
    trunc = func.date_trunc(unit, User.created_at)
    q = select(trunc, func.count()).where(people)
    if since:
        q = q.where(User.created_at >= since)
    rows = (await db.execute(q.group_by(trunc))).all()
    values = {label_of(k, period): int(v) for k, v in rows}
    return {
        "source": "meetgo", "updated_at": _iso(now), "state": "ok",
        "total": await count(),
        "new": await count(User.created_at >= since) if since else await count(),
        "active_7d": await count(User.last_seen_at >= naive - timedelta(days=7)),
        "active_30d": await count(User.last_seen_at >= naive - timedelta(days=30)),
        "series": series(buckets(period, now, first), values),
    }


# ---------- direct APK downloads (counted by the server) ----------

async def apk_block(db: AsyncSession, period: str, now: datetime) -> dict:
    from app.core.models import DownloadCount
    since = since_of(period, now)
    rows = (await db.execute(select(DownloadCount.day, DownloadCount.count).where(DownloadCount.kind == "apk"))).all()
    total = sum(c for _, c in rows)
    in_period = [(d, c) for d, c in rows if not since or d >= since.date()]
    values: dict[str, float] = {}
    for d, c in in_period:
        key = d.strftime("%Y-%m") if by_month(period) else d.isoformat()
        values[key] = values.get(key, 0) + c
    first = min((d for d, _ in rows), default=None)
    first_dt = datetime.combine(first, datetime.min.time(), timezone.utc) if first else None
    return {"source": "meetgo", "updated_at": _iso(now), "state": "ok", "total": total,
            "period": sum(c for _, c in in_period), "since": first.isoformat() if first else None,
            "series": series(buckets(period, now, first_dt), values)}


async def count_download(db: AsyncSession, kind: str = "apk") -> None:
    from sqlalchemy.dialects.postgresql import insert
    from app.core.models import DownloadCount
    today = datetime.now(billing.MADRID).date()
    stmt = insert(DownloadCount).values(day=today, kind=kind, count=1)
    await db.execute(stmt.on_conflict_do_update(index_elements=["day", "kind"], set_={"count": DownloadCount.count + 1}))
    await db.commit()


# ---------- Stripe ----------

async def _stripe_list(secret: str, path: str, params: list) -> list[dict]:
    out: list[dict] = []
    after = None
    for _ in range(20):  # at most 2,000 objects
        page = await billing.stripe_call(secret, "GET", path, params=params + [("limit", "100")] + ([("starting_after", after)] if after else []))
        out += page.get("data") or []
        if not page.get("has_more") or not out:
            break
        after = out[-1]["id"]
    return out


def stripe_figures(charges: list[dict], subs: list[dict], since: datetime | None, period: str, now: datetime) -> dict:
    """Collected, refunded, monthly series, trial conversion and cancellations, from Stripe's objects."""
    ts = since.timestamp() if since else 0
    collected = refunded = 0
    values: dict[str, float] = {}
    for c in charges:
        if c.get("created", 0) < ts or c.get("status") != "succeeded" or not c.get("paid"):
            continue
        amount = (c.get("amount_captured") or c.get("amount") or 0) / 100
        back = (c.get("amount_refunded") or 0) / 100
        collected += amount
        refunded += back
        key = label_of(datetime.fromtimestamp(c["created"], timezone.utc), period)
        values[key] = values.get(key, 0) + amount - back
    trials = [s for s in subs if s.get("trial_start") and (s.get("trial_end") or 0) >= ts and (s.get("trial_end") or 0) <= now.timestamp()]
    # converted: still paying, or cancelled more than a day after its trial ended (so it was charged)
    converted = [s for s in trials if s.get("status") in ("active", "past_due")
                 or (s.get("status") == "canceled" and (s.get("canceled_at") or 0) > (s.get("trial_end") or 0) + 86400)]
    cancelled = [s for s in subs if (s.get("canceled_at") or 0) >= ts and s.get("canceled_at")]
    return {"collected": round(collected, 2), "refunded": round(refunded, 2), "net": round(collected - refunded, 2),
            "values": {k: round(v, 2) for k, v in values.items()},
            "trials_ended": len(trials), "converted": len(converted),
            "conversion": round(len(converted) / len(trials), 3) if trials else None, "cancelled": len(cancelled)}


async def stripe_block(db: AsyncSession, period: str, now: datetime) -> dict:
    cfg = await billing.stripe_config(db)
    if not cfg["secret"]:
        return {"source": "stripe", "state": "unconfigured"}
    since = since_of(period, now)

    async def read():
        params = [("created[gte]", str(int(since.timestamp())))] if since else []
        charges = await _stripe_list(cfg["secret"], "/charges", params)
        subs = await _stripe_list(cfg["secret"], "/subscriptions", [("status", "all")])
        return {"charges": charges, "subs": subs, "at": _iso(utcnow())}

    try:
        got = await cached(f"stripe:{period}", CACHE_TTL, read)
    except Exception as e:  # noqa: BLE001
        return {"source": "stripe", "state": "error", "error": _error(e)}
    fig = stripe_figures(got["charges"], got["subs"], since, period, now)
    return {"source": "stripe", "state": "ok", "updated_at": got["at"], **fig}


def _error(e: Exception) -> str:
    detail = getattr(e, "detail", None)
    return str(detail or e)[:300] or e.__class__.__name__


# ---------- Google Play ----------

_tokens: dict[str, tuple[float, str]] = {}


async def google_token(sa: dict, scope: str) -> str:
    key = f"{sa.get('client_email')}|{scope}"
    hit = _tokens.get(key)
    if hit and hit[0] > time.time() + 60:
        return hit[1]
    now = int(time.time())
    assertion = jwt.encode({"iss": sa["client_email"], "scope": scope, "aud": "https://oauth2.googleapis.com/token",
                            "iat": now, "exp": now + 3600}, sa["private_key"], algorithm="RS256")
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post("https://oauth2.googleapis.com/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
    if res.status_code >= 400:
        raise RuntimeError(f"Google: {res.text[:200]}")
    body = res.json()
    _tokens[key] = (now + int(body.get("expires_in", 3600)), body["access_token"])
    return body["access_token"]


async def play_settings(db: AsyncSession) -> tuple[dict, dict | None]:
    cfg = await billing.play_config(db)
    raw = await get_section(db, "play")
    cfg["reports_bucket"] = (raw.get("reports_bucket") or "").strip()
    try:
        sa = json.loads(cfg["service_account"] or "{}") or None
    except ValueError:
        sa = None
    return cfg, sa if sa and sa.get("client_email") and sa.get("private_key") else None


PUBLISHER = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"


async def play_tracks(cfg: dict, sa: dict) -> list[dict]:
    """The version on each track (closed testing, production…), through a read-only edit that is thrown away."""
    token = await google_token(sa, "https://www.googleapis.com/auth/androidpublisher")
    head = {"Authorization": f"Bearer {token}"}
    base = f"{PUBLISHER}/{cfg['package']}/edits"
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(base, headers=head, json={})
        if res.status_code >= 400:
            raise RuntimeError(f"Google Play: {res.json().get('error', {}).get('message', res.text[:200])}")
        edit = res.json()["id"]
        try:
            res = await client.get(f"{base}/{edit}/tracks", headers=head)
            if res.status_code >= 400:
                raise RuntimeError(f"Google Play: {res.json().get('error', {}).get('message', res.text[:200])}")
            tracks = res.json().get("tracks") or []
        finally:
            await client.delete(f"{base}/{edit}", headers=head)
    out = []
    for tr in tracks:
        live = [r for r in tr.get("releases") or [] if r.get("status") in ("completed", "inProgress")]
        r = live[0] if live else (tr.get("releases") or [{}])[0]
        out.append({"track": tr.get("track"), "name": r.get("name"), "codes": r.get("versionCodes") or [], "status": r.get("status")})
    return out


def _bucket(name: str) -> str:
    return name.replace("gs://", "").strip("/").split("/")[0]


async def gcs_list(token: str, bucket: str, prefix: str) -> list[dict]:
    items, page = [], None
    async with httpx.AsyncClient(timeout=20) as client:
        for _ in range(10):
            res = await client.get(f"https://storage.googleapis.com/storage/v1/b/{bucket}/o",
                                   headers={"Authorization": f"Bearer {token}"},
                                   params={"prefix": prefix, **({"pageToken": page} if page else {})})
            if res.status_code >= 400:
                raise RuntimeError(f"Cloud Storage: {res.json().get('error', {}).get('message', res.text[:200])}")
            body = res.json()
            items += body.get("items") or []
            page = body.get("nextPageToken")
            if not page:
                break
    return items


async def gcs_get(token: str, bucket: str, name: str) -> bytes:
    from urllib.parse import quote
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(f"https://storage.googleapis.com/storage/v1/b/{bucket}/o/{quote(name, safe='')}",
                               headers={"Authorization": f"Bearer {token}"}, params={"alt": "media"})
    if res.status_code >= 400:
        raise RuntimeError(f"Cloud Storage: {res.text[:200]}")
    return res.content


def _csv_rows(data: bytes) -> list[dict]:
    """Play's report CSVs: UTF-16 for the statistics, UTF-8 for the earnings."""
    for enc in ("utf-16", "utf-8-sig", "utf-8"):
        try:
            text = data.decode(enc)
            if "," in text:
                return list(csv.DictReader(io.StringIO(text)))
        except UnicodeError:
            continue
    return []


def installs_from_rows(rows: list[dict]) -> dict[str, int]:
    """New installs per day (YYYY-MM-DD) from the installs overview report."""
    out: dict[str, int] = {}
    for r in rows:
        day = (r.get("Date") or "").strip()
        n = r.get("Daily User Installs") or r.get("Daily Device Installs") or "0"
        if day:
            out[day] = out.get(day, 0) + int(float(n or 0))
    return out


def earnings_from_rows(rows: list[dict]) -> tuple[float, str]:
    """What Google pays for a month (in the account's currency) from an earnings report."""
    total, currency = 0.0, ""
    for r in rows:
        amount = r.get("Amount (Merchant Currency)") or r.get("Amount (Merchant currency)")
        if amount:
            total += float(amount.replace(",", ""))
            currency = r.get("Merchant Currency") or currency
    return round(total, 2), currency


async def play_reports(cfg: dict, sa: dict) -> dict:
    """Installs per day and earnings per month from the developer account's report bucket."""
    bucket = _bucket(cfg["reports_bucket"])
    token = await google_token(sa, "https://www.googleapis.com/auth/devstorage.read_only")
    pkg = cfg["package"]
    installs: dict[str, int] = {}
    files = await gcs_list(token, bucket, f"stats/installs/installs_{pkg}_")
    for f in sorted((f for f in files if f["name"].endswith("_overview.csv")), key=lambda f: f["name"])[-14:]:
        installs.update(installs_from_rows(_csv_rows(await gcs_get(token, bucket, f["name"]))))
    earnings: dict[str, float] = {}
    currency = ""
    for f in sorted(await gcs_list(token, bucket, "earnings/earnings_"), key=lambda f: f["name"])[-13:]:
        month = f["name"].split("earnings_")[1][:6]
        data = await gcs_get(token, bucket, f["name"])
        rows: list[dict] = []
        if f["name"].endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for n in z.namelist():
                    rows += _csv_rows(z.read(n))
        else:
            rows = _csv_rows(data)
        rows = [r for r in rows if (r.get("Product id") or r.get("Product Id") or pkg) == pkg or not r.get("Product id")]
        amount, cur = earnings_from_rows(rows)
        earnings[f"{month[:4]}-{month[4:]}"] = earnings.get(f"{month[:4]}-{month[4:]}", 0) + amount
        currency = cur or currency
    last_install = max(installs, default=None)
    last_earning = max(earnings, default=None)
    return {"installs": installs, "earnings": earnings, "currency": currency, "installs_until": last_install,
            "earnings_until": last_earning, "at": _iso(utcnow())}


async def play_block(db: AsyncSession, period: str, now: datetime) -> dict:
    cfg, sa = await play_settings(db)
    out: dict = {"package": cfg["package"]}
    if not sa:
        return {**out, "tracks": {"source": "play_api", "state": "unconfigured"},
                "installs": {"source": "play_reports", "state": "unconfigured"},
                "earnings": {"source": "play_reports", "state": "unconfigured"}}
    try:
        tracks = await cached(f"play:tracks:{cfg['package']}", PLAY_TTL, lambda: _stamp(play_tracks(cfg, sa)))
        out["tracks"] = {"source": "play_api", "state": "ok", "updated_at": tracks["at"], "items": tracks["value"]}
    except Exception as e:  # noqa: BLE001
        out["tracks"] = {"source": "play_api", "state": "error", "error": _error(e)}
    if not cfg["reports_bucket"]:
        out["installs"] = {"source": "play_reports", "state": "unconfigured"}
        out["earnings"] = {"source": "play_reports", "state": "unconfigured"}
        return out
    try:
        rep = await cached(f"play:reports:{cfg['reports_bucket']}", 6 * 3600, lambda: play_reports(cfg, sa))
    except Exception as e:  # noqa: BLE001
        err = {"source": "play_reports", "state": "error", "error": _error(e)}
        return {**out, "installs": err, "earnings": err}
    since = since_of(period, now)
    first = min((datetime.fromisoformat(d).replace(tzinfo=timezone.utc) for d in rep["installs"]), default=None)
    values: dict[str, float] = {}
    for d, n in rep["installs"].items():
        dt = datetime.fromisoformat(d).replace(tzinfo=timezone.utc)
        if since and dt < since - timedelta(days=1):
            continue
        values[label_of(dt, period)] = values.get(label_of(dt, period), 0) + n
    out["installs"] = {"source": "play_reports", "state": "ok", "updated_at": rep["at"], "until": rep["installs_until"],
                       "period": int(sum(values.values())), "total": int(sum(rep["installs"].values())),
                       "series": series(buckets(period, now, first), values)}
    months = {m: v for m, v in rep["earnings"].items() if not since or m >= since.strftime("%Y-%m")}
    out["earnings"] = {"source": "play_reports", "state": "ok", "updated_at": rep["at"], "until": rep["earnings_until"],
                       "currency": rep["currency"], "period": round(sum(months.values()), 2), "months": months}
    return out


async def _stamp(coro) -> dict:
    return {"value": await coro, "at": _iso(utcnow())}


# ---------- health ----------

async def health_block(db: AsyncSession, now: datetime) -> dict:
    from app.backups import service as bk
    from app.mail import email
    state = await bk.get_state(db)
    smtp = await get_section(db, "smtp")
    configured = bool(smtp.get("gmail_refresh_token") if (smtp.get("mode") == "gmail_api") else smtp.get("host"))
    try:
        disk = bk.disk(bk.default_folder())
    except Exception:  # noqa: BLE001
        disk = None
    return {"source": "server", "updated_at": _iso(now), "state": "ok",
            "backup": {"last_success": state.get("last_success"), "level": state.get("last_level"), "problem": state.get("problem")},
            "mail": {"configured": configured, **email.last_result()},
            "disk": disk}


# ---------- all of it ----------

async def dashboard(db: AsyncSession, period: str) -> dict:
    now = utcnow()
    subs = await subscriptions_block(db, now)
    stripe = await stripe_block(db, period, now)
    play = await play_block(db, period, now)
    revenue_values: dict[str, float] = dict(stripe.get("values") or {}) if stripe.get("state") == "ok" else {}
    first_user = (await db.execute(select(func.min(User.created_at)))).scalar()
    first_dt = _aware(first_user)
    return {
        "period": period, "generated_at": _iso(now),
        "users": await users_block(db, period, now),
        "subscriptions": subs,
        "revenue": {
            "mrr": {**subs["mrr"], "source": "meetgo", "updated_at": _iso(now), "state": "ok"},
            "stripe": {k: v for k, v in stripe.items() if k != "values"},
            "stripe_series": series(buckets(period, now, first_dt), revenue_values) if stripe.get("state") == "ok" else [],
            "play": play["earnings"],
        },
        "downloads": {"apk": await apk_block(db, period, now), "play": play["installs"]},
        "play": {"package": play["package"], "tracks": play["tracks"]},
        "health": await health_block(db, now),
    }
