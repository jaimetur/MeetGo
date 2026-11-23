"""Attachments on the server's data volume, served through signed links."""

import hashlib
import hmac
import io
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps

from app.core.config import settings
from app.core.i18n import t
from app.core.models import Attachment

MAX_BYTES = 10 * 1024 * 1024
LINK_TTL = 7 * 24 * 3600
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
FILE_TYPES = IMAGE_TYPES | {
    "application/pdf", "text/plain", "application/zip",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "audio/mpeg", "audio/ogg", "audio/mp4", "video/mp4",
}
THUMB_SIZE = 640


def uploads_dir() -> Path:
    path = Path(settings.DATA_DIR) / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_name(name: str) -> str:
    keep = "".join(c for c in (name or "fichero") if c.isalnum() or c in "._- ")
    return (keep.strip() or "fichero")[:120]


async def save_upload(file: UploadFile, uploader_id: int) -> Attachment:
    mime = (file.content_type or "application/octet-stream").split(";")[0].strip().lower()
    if mime not in FILE_TYPES:
        raise HTTPException(415, t("err_file_type"))
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, t("err_file_too_big"))
    if not data:
        raise HTTPException(400, t("err_file_empty"))

    now = datetime.now(timezone.utc)
    rel_dir = Path(f"{now:%Y}/{now:%m}")
    (uploads_dir() / rel_dir).mkdir(parents=True, exist_ok=True)
    stem = secrets.token_hex(16)
    ext = os.path.splitext(file.filename or "")[1].lower()[:10]
    key = str(rel_dir / f"{stem}{ext}")
    width = height = None
    thumb_key = None

    if mime in IMAGE_TYPES:
        try:
            img = Image.open(io.BytesIO(data))
            img = ImageOps.exif_transpose(img)
            width, height = img.size
            thumb = img.convert("RGB") if img.mode not in ("RGB", "L") else img
            thumb.thumbnail((THUMB_SIZE, THUMB_SIZE))
            thumb_key = str(rel_dir / f"{stem}_thumb.webp")
            thumb.save(uploads_dir() / thumb_key, "WEBP", quality=80)
        except Exception:
            raise HTTPException(415, t("err_file_type"))

    (uploads_dir() / key).write_bytes(data)
    return Attachment(
        uploader_id=uploader_id, storage_key=key, thumb_key=thumb_key, file_name=_safe_name(file.filename or ""),
        mime=mime, size=len(data), width=width, height=height,
    )


def _sig(attachment_id: int, variant: str, exp: int) -> str:
    msg = f"{attachment_id}:{variant}:{exp}".encode()
    return hmac.new(settings.JWT_SECRET.encode(), msg, hashlib.sha256).hexdigest()[:32]


def signed_url(att: Attachment, thumb: bool = False) -> str:
    variant = "thumb" if thumb and att.thumb_key else "file"
    exp = int(time.time()) + LINK_TTL
    return f"/files/{att.id}/{variant}?exp={exp}&sig={_sig(att.id, variant, exp)}"


def check_signature(attachment_id: int, variant: str, exp: int, sig: str) -> bool:
    if exp < time.time():
        return False
    return hmac.compare_digest(_sig(attachment_id, variant, exp), sig or "")


def file_path(key: str) -> Path:
    path = (uploads_dir() / key).resolve()
    if uploads_dir().resolve() not in path.parents:
        raise HTTPException(404, t("err_file_not_found"))
    return path


def attachment_out(att: Attachment, base: str = "") -> dict:
    return {
        "id": att.id,
        "file_name": att.file_name,
        "mime": att.mime,
        "size": att.size,
        "width": att.width,
        "height": att.height,
        "url": base + signed_url(att),
        "thumb_url": base + signed_url(att, thumb=True) if att.thumb_key else None,
    }
