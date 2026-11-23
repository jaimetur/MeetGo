"""Push notifications: Firebase Cloud Messaging for the Android app and Web Push for browsers.

Notification rules:
  - direct messages and groups notify every message (unless the member chose "mentions" or "none");
  - channels notify only mentions and replies to your messages (unless the member chose "all");
  - nobody is notified while the conversation is muted, nor for their own or moderated messages.
Clients drop the notification when that conversation is already open on screen.
"""

import asyncio
import base64
import json
import logging
import time

import httpx
from cryptography.hazmat.primitives import serialization
from jose import jwt
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal
from app.core.models import Attachment, Conversation, ConversationMember, Device, Interest, Message, User, utcnow
from app.core.app_settings import get_section, set_section
from app.core.crypto import decrypt, encrypt

logger = logging.getLogger("meetgo.push")
_fcm_token: dict = {"value": None, "exp": 0.0, "key": None}


# ---------- configuration ----------

async def ensure_vapid_keys(db: AsyncSession) -> None:
    """Create the Web Push key pair once; browsers subscribe with its public half."""
    cfg = await get_section(db, "webpush")
    if cfg.get("public_key") and cfg.get("private_key_enc"):
        return
    from py_vapid import Vapid01
    vapid = Vapid01()
    vapid.generate_keys()
    public = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    cfg.update({
        "public_key": base64.urlsafe_b64encode(public).decode().rstrip("="),
        "private_key_enc": encrypt(vapid.private_pem().decode()),
        "subject": cfg.get("subject") or "mailto:soporte@meetgo.app",
    })
    await set_section(db, "webpush", cfg)


async def public_config(db: AsyncSession) -> dict:
    cfg = await get_section(db, "webpush")
    fcm = await get_section(db, "fcm")
    return {"webpush_public_key": cfg.get("public_key"), "fcm_enabled": bool(fcm.get("service_account_enc"))}


# ---------- deciding who gets what ----------

def _wants(conv: Conversation, member: ConversationMember, msg: Message, root_author: int | None,
           reply_author: int | None) -> bool:
    if member.user_id == msg.sender_id or member.banned or member.notify == "none":
        return False
    if member.muted_until and member.muted_until > utcnow():
        return False
    mentioned = member.user_id in (msg.mentions or [])
    replied = member.user_id in (root_author, reply_author)
    if mentioned or replied:
        return True
    if member.notify == "mentions":
        return False
    if msg.thread_root_id and not msg.also_in_channel:
        return False
    return conv.kind != "channel" or member.notify == "all"


async def notify_message(conversation_id: int, message_id: int) -> None:
    try:
        async with SessionLocal() as db:
            await _notify(db, conversation_id, message_id)
    except Exception:
        logger.exception("Push for message %s failed", message_id)


async def _notify(db: AsyncSession, conversation_id: int, message_id: int) -> None:
    conv = await db.get(Conversation, conversation_id)
    msg = await db.get(Message, message_id)
    if not conv or not msg or msg.deleted_at:
        return
    sender = await db.get(User, msg.sender_id) if msg.sender_id else None
    root_author = reply_author = None
    if msg.thread_root_id:
        root = await db.get(Message, msg.thread_root_id)
        root_author = root.sender_id if root else None
    if msg.reply_to_id:
        target = await db.get(Message, msg.reply_to_id)
        reply_author = target.sender_id if target else None

    members = (await db.execute(select(ConversationMember).where(ConversationMember.conversation_id == conv.id))).scalars().all()
    targets = [m.user_id for m in members if _wants(conv, m, msg, root_author, reply_author)]
    if not targets:
        return
    devices = (await db.execute(select(Device).where(Device.user_id.in_(targets)))).scalars().all()
    if not devices:
        return

    if conv.kind == "channel":
        interest = await db.get(Interest, conv.interest_id) if conv.interest_id else None
        title = f"#{interest.slug if interest else 'canal'}"
    elif conv.kind == "group":
        title = conv.title or "Grupo"
    else:
        title = sender.display_name if sender else "MeetGo"
    body = msg.body or ""
    if not body:
        has_file = (await db.execute(select(Attachment.id).where(Attachment.message_id == msg.id).limit(1))).scalar_one_or_none()
        body = "📎 Archivo adjunto" if has_file else ""
    if conv.kind != "dm" and sender:
        body = f"{sender.display_name}: {body}"
    data = {
        "type": "message",
        "conversation_id": str(conv.id),
        "conversation_kind": conv.kind,
        "message_id": str(msg.id),
        "thread_root_id": str(msg.thread_root_id or ""),
        "title": title,
        "sender_name": sender.display_name if sender else "",
        "body": body[:400],
        "url": f"/app/c/{conv.id}",
        "sent_at": str(int(time.time())),
    }
    await send_to_devices(db, devices, data)


async def send_to_devices(db: AsyncSession, devices, data: dict) -> None:
    fcm_cfg = await get_section(db, "fcm")
    web_cfg = await get_section(db, "webpush")
    stale: list[int] = []
    jobs = []
    for d in devices:
        if d.kind == "fcm" and fcm_cfg.get("service_account_enc"):
            jobs.append((d, _send_fcm(fcm_cfg, d.token, data)))
        elif d.kind == "webpush" and web_cfg.get("private_key_enc"):
            jobs.append((d, asyncio.to_thread(_send_webpush, web_cfg, d, data)))
    results = await asyncio.gather(*(j for _, j in jobs), return_exceptions=True)
    for (device, _), result in zip(jobs, results):
        if result == "gone":
            stale.append(device.id)
        elif isinstance(result, Exception):
            logger.warning("Push to device %s failed: %s", device.id, result)
    if stale:
        await db.execute(delete(Device).where(Device.id.in_(stale)))
        await db.commit()


# ---------- Firebase Cloud Messaging (HTTP v1) ----------

async def _fcm_access_token(sa: dict) -> str:
    key = sa.get("client_email")
    if _fcm_token["value"] and _fcm_token["key"] == key and _fcm_token["exp"] > time.time() + 60:
        return _fcm_token["value"]
    now = int(time.time())
    assertion = jwt.encode({
        "iss": sa["client_email"], "scope": "https://www.googleapis.com/auth/firebase.messaging",
        "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600,
    }, sa["private_key"], algorithm="RS256")
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post("https://oauth2.googleapis.com/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
    res.raise_for_status()
    body = res.json()
    _fcm_token.update({"value": body["access_token"], "exp": now + int(body.get("expires_in", 3600)), "key": key})
    return body["access_token"]


async def _send_fcm(cfg: dict, token: str, data: dict) -> str:
    sa = json.loads(decrypt(cfg["service_account_enc"]) or "{}")
    if not sa.get("project_id"):
        raise RuntimeError("FCM service account is not readable")
    access = await _fcm_access_token(sa)
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.post(
            f"https://fcm.googleapis.com/v1/projects/{sa['project_id']}/messages:send",
            headers={"Authorization": f"Bearer {access}"},
            json={"message": {"token": token, "data": {k: str(v) for k, v in data.items()},
                              "android": {"priority": "high", "collapse_key": f"c{data.get('conversation_id', '')}"}}},
        )
    if res.status_code in (404, 410) or (res.status_code == 400 and "registration" in res.text.lower()):
        return "gone"
    if "UNREGISTERED" in res.text:
        return "gone"
    res.raise_for_status()
    return "ok"


# ---------- Web Push ----------

def _send_webpush(cfg: dict, device: Device, data: dict) -> str:
    from py_vapid import Vapid01
    from pywebpush import WebPushException, webpush
    vapid = Vapid01.from_pem(decrypt(cfg["private_key_enc"]).encode())
    try:
        webpush(
            subscription_info={"endpoint": device.token, "keys": device.keys or {}},
            data=json.dumps(data),
            vapid_private_key=vapid,
            vapid_claims={"sub": cfg.get("subject") or "mailto:soporte@meetgo.app"},
            ttl=3600,
            timeout=10,
        )
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            return "gone"
        raise
    return "ok"
