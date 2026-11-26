"""My photo and deleting my account. My photo: uploaded, cropped square and saved small (WebP), served at a fixed public address /avatars/<name>.

The address goes in users.avatar_url, so every list, message and card shows it without signed links that expire.
"""

import io
import re
import secrets

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.common import me_out
from app.accounts.deletion import delete_account
from app.core.deps import get_current_user, get_db, require_write_access
from app.core.security import verify_password
from app.core.i18n import t
from app.core.models import User
from app.core.schemas import DeleteMeIn, MeOut
from app.messaging.storage import uploads_dir

router = APIRouter(tags=["me"])
MAX_BYTES = 15 * 1024 * 1024
SIZE = 512
NAME_RE = re.compile(r"^\d+-[A-Za-z0-9_-]{8,32}\.webp$")


def _dir():
    d = uploads_dir() / "avatars"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _orig_dir():
    d = _dir() / "orig"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _remove(url: str | None) -> None:
    """Deletes my previous photo file and its original (only ours)."""
    name = (url or "").rsplit("/", 1)[-1]
    if (url or "").startswith("/avatars/") and NAME_RE.match(name):
        (_dir() / name).unlink(missing_ok=True)
        (_orig_dir() / name).unlink(missing_ok=True)


ORIG_MAX = 1600  # the whole photo, kept to frame it again later (zoom out, move)


@router.post("/me/avatar", response_model=MeOut)
async def upload_avatar(file: UploadFile = File(...), original: UploadFile | None = File(None),
                        db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    """My photo as framed in the app; `original`, the whole photo, is kept to frame it again later."""
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, t("err_file_too_big"))
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)  # as the phone shows it
        img = ImageOps.fit(img.convert("RGB"), (SIZE, SIZE), Image.LANCZOS)  # square, centred
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, t("err_avatar_not_image"))
    name = f"{user.id}-{secrets.token_urlsafe(12)}.webp"
    img.save(_dir() / name, "WEBP", quality=86)
    if original is not None:
        raw = await original.read(MAX_BYTES + 1)
        try:
            whole = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
            whole.thumbnail((ORIG_MAX, ORIG_MAX), Image.LANCZOS)
            whole.save(_orig_dir() / name, "WEBP", quality=88)
        except (UnidentifiedImageError, OSError, ValueError):
            pass  # the framed photo is enough
    _remove(user.avatar_url)
    user.avatar_url = f"/avatars/{name}"
    await db.commit()
    await db.refresh(user)
    return me_out(user)


@router.delete("/me/avatar", response_model=MeOut)
async def delete_avatar(db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    _remove(user.avatar_url)
    user.avatar_url = None
    await db.commit()
    await db.refresh(user)
    return me_out(user)


@router.delete("/me", response_model=dict)
async def delete_me(payload: DeleteMeIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Deleting my own account (Settings → Delete my account), with my password."""
    if not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(403, t("err_wrong_password"))
    await delete_account(db, user)
    return {"ok": True}


@router.get("/avatars/orig/{name}")
async def get_avatar_original(name: str):
    """The whole photo behind a profile photo (to frame it again); the framed one when it was not kept."""
    path = _orig_dir() / name
    if not NAME_RE.match(name):
        raise HTTPException(404, t("err_file_not_found"))
    if not path.exists():
        path = _dir() / name
        if not path.exists():
            raise HTTPException(404, t("err_file_not_found"))
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=2592000, immutable"})


@router.get("/avatars/{name}")
async def get_avatar(name: str):
    path = _dir() / name
    if not NAME_RE.match(name) or not path.exists():
        raise HTTPException(404, t("err_file_not_found"))
    # a new photo gets a new name, so a copy can be kept for long
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=2592000, immutable"})
