import json
from pathlib import Path

import html

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..deps import get_db
from ..i18n import t, use_lang
from ..models import User
from ..services import notify_email
from ..services.app_settings import app_base_url

router = APIRouter(tags=["public"])


@router.get("/healthz", response_model=dict)
async def healthz():
    return {"status": "ok"}


def _downloads() -> Path:
    return Path(settings.DATA_DIR) / "downloads"


@router.get("/downloads/android.apk")
async def android_apk():
    """The Android app, copied to <DATA_DIR>/downloads by tools/deploy-android.sh."""
    path = _downloads() / "meetgo-android.apk"
    if not path.exists():
        raise HTTPException(404, t("err_file_not_found"))
    return FileResponse(path, media_type="application/vnd.android.package-archive", filename="meetgo.apk")


@router.get("/downloads/android.json", response_model=dict)
async def android_info():
    info = _downloads() / "android-build.json"
    if not info.exists():
        return {"available": (_downloads() / "meetgo-android.apk").exists()}
    return {"available": True, **json.loads(info.read_text())}


@router.get("/.well-known/assetlinks.json")
async def assetlinks():
    """Lets Android open https://meetgo.app/app/c/... links in the app (App Links)."""
    fingerprints = [f.strip() for f in settings.ANDROID_CERT_SHA256.split(",") if f.strip()]
    statements = [{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {"namespace": "android_app", "package_name": settings.ANDROID_PACKAGE,
                   "sha256_cert_fingerprints": fingerprints},
    }] if fingerprints else []
    return JSONResponse(statements)


# ---------- links to stop automatic emails ----------

@router.get("/email/unsubscribe", response_class=HTMLResponse)
@router.post("/email/unsubscribe", response_class=HTMLResponse)
async def email_unsubscribe(u: int, k: str, s: str, db: AsyncSession = Depends(get_db)):
    """The link at the bottom of notification emails (and one-click List-Unsubscribe). Signed, so no sign-in is needed."""
    user = await db.get(User, u)
    if not user or not notify_email.check_unsubscribe(u, k, s):
        raise HTTPException(404, t("err_invalid_token"))
    await notify_email.unsubscribe(db, user, k)
    base = await app_base_url(db)
    with use_lang(user.lang):
        title, body, link = t("email_unsubscribed_title"), t(f"email_unsubscribed_{k}"), t("email_footer_manage")
    page = (
        '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>MeetGo</title></head><body style=\"margin:0;padding:40px 16px;background:#eef1f5;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#142036\">"
        '<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:26px 24px">'
        '<div style="font-size:22px;font-weight:700;margin-bottom:14px"><span style="color:#1e90ff">Meet</span><span style="color:#1f9d4a">Go</span></div>'
        f"<h1 style=\"font-size:19px;margin:0 0 10px\">{html.escape(title)}</h1><p>{html.escape(body)}</p>"
        f"<p><a href=\"{html.escape(base + '/app/account', quote=True)}\" style=\"color:#1e90ff\">{html.escape(link)}</a></p>"
        "</div></body></html>"
    )
    return HTMLResponse(page)
