import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from ..config import settings
from ..i18n import t

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
