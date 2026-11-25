"""Administration → Business: the dashboard (users, subscriptions, revenue, downloads, Google Play, health) and the
"test connection" of each service whose settings live there. Administrators only; no response carries a secret."""

from __future__ import annotations

import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing import service as billing
from app.business import service as biz
from app.core.app_settings import get_section
from app.core.crypto import decrypt
from app.core.deps import get_db, require_admin
from app.core.models import User

router = APIRouter(prefix="/admin/business", tags=["admin"])


class TestIn(BaseModel):
    source: str = Field(pattern="^(stripe|play|reports|fcm|smtp)$")


@router.get("", response_model=dict)
async def dashboard(period: str = Query("30d", pattern="^(7d|30d|12m|all)$"), refresh: bool = False,
                    db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if refresh:
        biz.clear_cache()
    return await biz.dashboard(db, period)


@router.post("/test", response_model=dict)
async def test(payload: TestIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Checks that a service answers with the stored settings; says what failed, never the secret."""
    try:
        detail = await _test(db, payload.source)
        return {"ok": True, "detail": detail}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "detail": biz._error(e)}


async def _test(db: AsyncSession, source: str) -> str:
    if source == "stripe":
        cfg = await billing.stripe_config(db)
        if not cfg["secret"]:
            raise HTTPException(400, "not configured")
        account = await billing.stripe_call(cfg["secret"], "GET", "/account")
        return account.get("settings", {}).get("dashboard", {}).get("display_name") or account.get("id") or "Stripe"
    if source in ("play", "reports"):
        cfg, sa = await biz.play_settings(db)
        if not sa:
            raise HTTPException(400, "not configured")
        if source == "play":
            tracks = await biz.play_tracks(cfg, sa)
            return ", ".join(f"{t['track']}: {t['name'] or '—'}" for t in tracks) or cfg["package"]
        if not cfg["reports_bucket"]:
            raise HTTPException(400, "not configured")
        token = await biz.google_token(sa, "https://www.googleapis.com/auth/devstorage.read_only")
        files = await biz.gcs_list(token, biz._bucket(cfg["reports_bucket"]), "stats/installs/")
        return f"{len(files)} files in stats/installs/"
    if source == "fcm":
        fcm = await get_section(db, "fcm")
        sa = json.loads(decrypt(fcm.get("service_account_enc", "")) or "{}")
        if not sa.get("private_key"):
            raise HTTPException(400, "not configured")
        await biz.google_token(sa, "https://www.googleapis.com/auth/firebase.messaging")
        return sa.get("project_id") or "Firebase"
    if source == "smtp":
        smtp = await get_section(db, "smtp")
        if smtp.get("mode") == "gmail_api":
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.post("https://oauth2.googleapis.com/token", data={
                    "client_id": smtp.get("gmail_client_id") or "", "client_secret": smtp.get("gmail_client_secret") or "",
                    "refresh_token": smtp.get("gmail_refresh_token") or "", "grant_type": "refresh_token"})
            if res.status_code >= 400:
                raise HTTPException(400, f"Gmail: {res.json().get('error_description') or res.text[:200]}")
            return smtp.get("gmail_sender_email") or "Gmail"
        import asyncio
        await asyncio.to_thread(_smtp_login, smtp)
        return smtp.get("host") or "SMTP"
    raise HTTPException(400, "unknown source")


def _smtp_login(smtp: dict) -> None:
    import smtplib
    import ssl
    host, port = smtp.get("host") or "", int(smtp.get("port") or 587)
    if not host:
        raise HTTPException(400, "not configured")
    ctx = ssl.create_default_context()
    if (smtp.get("encryption") or "starttls") == "ssl":
        server = smtplib.SMTP_SSL(host, port, timeout=15, context=ctx)
    else:
        server = smtplib.SMTP(host, port, timeout=15)
        server.starttls(context=ctx)
    try:
        if smtp.get("username"):
            server.login(smtp.get("username"), smtp.get("password") or "")
    finally:
        try:
            server.quit()
        except Exception:  # noqa: BLE001
            pass
