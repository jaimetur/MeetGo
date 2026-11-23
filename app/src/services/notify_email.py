"""Automatic emails.

- Account emails (verification, password reset, password changed) always go out when mail is configured.
- Notification emails follow the administration switch ("email_notifications" settings) and each person's choices
  (`users.email_prefs`): mentions and replies, unread messages, requests (friends, direct messages, groups) and, for
  administrators, new reports. Moderation and plan reminders follow the switch only.
- Unread mentions and messages are not emailed one by one: every few minutes `digest_once` sends one email per person
  with what they have not read after `delay_minutes`, at most once every `cooldown_hours`, and never while they are
  connected. `conversation_members.email_notified_message_id` remembers what was already covered.
- Every notification email carries a link to stop that kind of email (signed, no sign-in needed) and the
  List-Unsubscribe headers.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import urllib.parse
from datetime import timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..config import settings
from ..db import SessionLocal
from ..i18n import t, use_lang
from ..models import (
    AccessGrant, Conversation, ConversationMember, EmailNotice, Interest, Message, User, naive_utcnow, utcnow,
)
from ..redis_conn import get_redis
from . import email as mailer
from . import realtime
from .app_settings import app_base_url, get_section
from .billing import access_status

logger = logging.getLogger("meetgo.email")

KINDS = ("mentions", "messages", "requests", "reports")
DEFAULT_PREFS = {"mentions": True, "messages": True, "requests": True, "reports": True}
# What a "stop these emails" link turns off.
UNSUBSCRIBE_GROUPS = {"digest": ("mentions", "messages"), "requests": ("requests",), "reports": ("reports",)}
DEFAULT_CONFIG = {"enabled": True, "delay_minutes": 15, "cooldown_hours": 3}
DIGEST_EVERY = 300  # seconds
REMINDERS_EVERY = 6 * 3600
DIGEST_LOOKBACK = timedelta(days=3)


# ---------- choices and configuration ----------

def prefs_of(user: User) -> dict[str, bool]:
    stored = user.email_prefs or {}
    out = {k: bool(stored.get(k, DEFAULT_PREFS[k])) for k in KINDS}
    if user.role != "admin":
        out.pop("reports")
    return out


async def config(db: AsyncSession) -> dict:
    raw = await get_section(db, "email_notifications") or {}
    cfg = {**DEFAULT_CONFIG, **{k: v for k, v in raw.items() if v is not None}}
    cfg["enabled"] = bool(cfg["enabled"])
    cfg["delay_minutes"] = max(1, int(cfg["delay_minutes"]))
    cfg["cooldown_hours"] = max(0, float(cfg["cooldown_hours"]))
    return cfg


def can_email(user: User | None) -> bool:
    return bool(user and user.email and user.email_verified and not user.is_banned)


# ---------- unsubscribe links ----------

def _signature(user_id: int, group: str) -> str:
    return hmac.new(settings.JWT_SECRET.encode(), f"unsubscribe:{user_id}:{group}".encode(), hashlib.sha256).hexdigest()[:32]


def unsubscribe_url(user_id: int, group: str) -> str:
    query = urllib.parse.urlencode({"u": user_id, "k": group, "s": _signature(user_id, group)})
    return f"{settings.PUBLIC_API_BASE.rstrip('/')}/email/unsubscribe?{query}"


def check_unsubscribe(user_id: int, group: str, signature: str) -> bool:
    return group in UNSUBSCRIBE_GROUPS and hmac.compare_digest(_signature(user_id, group), signature or "")


async def unsubscribe(db: AsyncSession, user: User, group: str) -> None:
    prefs = dict(user.email_prefs or {})
    for kind in UNSUBSCRIBE_GROUPS[group]:
        prefs[kind] = False
    user.email_prefs = prefs
    await db.commit()


# ---------- sending ----------

async def _send(db: AsyncSession, user: User, key: str, params: dict | None, path: str | None, group: str | None,
                paragraphs: list[str] | None = None) -> None:
    """Write the email `key` in the person's language and queue it."""
    base = await app_base_url(db)
    params = params or {}
    with use_lang(user.lang):
        subject = t(f"{key}_subject", params)
        title = t(f"{key}_title", params)
        body = paragraphs if paragraphs is not None else [t(f"{key}_body", params)]
        label = t(f"{key}_button", params)
        button = (label if label != f"{key}_button" else t("email_open_app"), base + path) if path else None
        footer, links, headers = [], [], {}
        if group:
            footer.append(t(f"email_footer_{group}"))
            links = [(t("email_footer_manage"), f"{base}/app/account"), (t("email_footer_unsubscribe"), unsubscribe_url(user.id, group))]
            headers = {"List-Unsubscribe": f"<{unsubscribe_url(user.id, group)}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
        text, html = mailer.render(title, body, button, footer, links)
    await mailer.send_email_background(db, user.email, subject, text, html, headers)


async def account_email(db: AsyncSession, user: User, key: str, params: dict | None = None, path: str | None = None) -> None:
    """Account emails (verification, password reset, password changed): sent whenever mail is configured."""
    if user.email and mailer.smtp_ready(await get_section(db, "smtp") or {}):
        await _send(db, user, key, params, path, None)


async def notify(db: AsyncSession, user: User | None, kind: str | None, key: str, params: dict | None = None,
                 path: str | None = None) -> bool:
    """A notification email for one person, if the switch, their choices and their address allow it.
    `kind` None: not something people choose (moderation, plan reminders)."""
    if not can_email(user):
        return False
    cfg = await config(db)
    if not cfg["enabled"] or not mailer.smtp_ready(await get_section(db, "smtp") or {}):
        return False
    group = None
    if kind:
        if not prefs_of(user).get(kind):
            return False
        group = next(g for g, kinds in UNSUBSCRIBE_GROUPS.items() if kind in kinds)
    await _send(db, user, key, params, path, group)
    return True


async def notify_admins_report(db: AsyncSession, reason: str) -> None:
    """New report in the moderation queue: tell administrators, at most once every 30 minutes each."""
    admins = (await db.execute(select(User).where(User.role == "admin"))).scalars().all()
    for admin in admins:
        if not can_email(admin) or not prefs_of(admin).get("reports"):
            continue
        if not await get_redis().set(f"mail:reports:{admin.id}", "1", nx=True, ex=1800):
            continue
        with use_lang(admin.lang):
            reason_text = t(f"ui_reason_{reason}")
        await notify(db, admin, "reports", "email_report", {"reason": reason_text})


async def conversation_label(db: AsyncSession, conv: Conversation, for_user_id: int | None = None) -> str:
    if conv.kind == "channel":
        interest = await db.get(Interest, conv.interest_id) if conv.interest_id else None
        return f"#{interest.slug if interest else (conv.title or '')}"
    if conv.kind == "dm" and for_user_id:
        other_id = next((int(x) for x in (conv.dm_key or "").split(":") if x and int(x) != for_user_id), None)
        other = await db.get(User, other_id) if other_id else None
        return other.display_name if other else (conv.title or "")
    return conv.title or ""


# ---------- digest of unread mentions and messages ----------

async def digest_once(db: AsyncSession) -> int:
    """One email per person with the mentions and messages they have not read. Returns how many emails were queued."""
    cfg = await config(db)
    if not cfg["enabled"] or not mailer.smtp_ready(await get_section(db, "smtp") or {}):
        return 0
    now = utcnow()
    delay = timedelta(minutes=cfg["delay_minutes"])
    cooldown = timedelta(hours=cfg["cooldown_hours"])
    M = ConversationMember
    Reply = aliased(Message)
    Root = aliased(Message)
    query = (
        select(M.user_id, M.conversation_id, Message.id, Message.sender_id, Message.body, Message.mentions,
               Reply.sender_id.label("reply_author"), Root.sender_id.label("root_author"))
        .join(Message, Message.conversation_id == M.conversation_id)
        .join(Conversation, Conversation.id == M.conversation_id)
        .join(User, User.id == M.user_id)
        .outerjoin(Reply, Reply.id == Message.reply_to_id)
        .outerjoin(Root, Root.id == Message.thread_root_id)
        .where(
            Message.id > func.greatest(M.last_read_message_id, M.email_notified_message_id),
            Message.sender_id.isnot(None), Message.sender_id != M.user_id,
            Message.deleted_at.is_(None), Message.kind != "system",
            Message.created_at <= now - delay, Message.created_at >= now - DIGEST_LOOKBACK,
            M.banned.is_(False), M.notify != "none", or_(M.muted_until.is_(None), M.muted_until < now),
            User.email.isnot(None), User.email_verified.is_(True), User.is_banned.is_(False),
            or_(User.last_digest_email_at.is_(None), User.last_digest_email_at <= now - cooldown),
            or_(
                # Groups and direct messages: everything you follow. Channels: only what is addressed to you.
                and_(Conversation.kind != "channel", M.notify == "all",
                     or_(Message.thread_root_id.is_(None), Message.also_in_channel.is_(True))),
                Message.mentions.op("@>")(func.jsonb_build_array(M.user_id)),
                Reply.sender_id == M.user_id,
                Root.sender_id == M.user_id,
            ),
        )
        .order_by(M.user_id, Message.id)
        .limit(5000)
    )
    rows = (await db.execute(query)).all()
    by_user: dict[int, list] = {}
    for row in rows:
        by_user.setdefault(row.user_id, []).append(row)
    if not by_user:
        return 0
    online = await realtime.online_ids(by_user.keys())
    seen_after = naive_utcnow() - delay
    sent = 0
    for user_id, items in by_user.items():
        user = await db.get(User, user_id)
        if not user or user_id in online or (user.last_seen_at and user.last_seen_at > seen_after):
            continue  # connected or active a moment ago: the app already shows it
        prefs = prefs_of(user)
        wanted = []
        for r in items:
            mention = user_id in (r.mentions or []) or user_id in (r.reply_author, r.root_author)
            if prefs["mentions" if mention else "messages"]:
                wanted.append((mention, r))
        newest: dict[int, int] = {}
        for r in items:
            newest[r.conversation_id] = max(newest.get(r.conversation_id, 0), r.id)
        if wanted:
            await _send_digest(db, user, wanted)
            user.last_digest_email_at = now
            sent += 1
        for conv_id, message_id in newest.items():
            await db.execute(update(M).where(M.conversation_id == conv_id, M.user_id == user_id,
                                             M.email_notified_message_id < message_id).values(email_notified_message_id=message_id))
        await db.commit()
    return sent


async def _send_digest(db: AsyncSession, user: User, wanted: list) -> None:
    senders = {r.sender_id for _, r in wanted}
    names = {u.id: u.display_name for u in (await db.execute(select(User).where(User.id.in_(senders)))).scalars().all()}
    labels: dict[int, str] = {}
    lines = []
    with use_lang(user.lang):
        for mention, r in wanted[:10]:
            if r.conversation_id not in labels:
                conv = await db.get(Conversation, r.conversation_id)
                labels[r.conversation_id] = await conversation_label(db, conv, user.id) if conv else ""
            body = (r.body or t("email_digest_attachment")).replace("\n", " ")
            body = body[:140] + ("…" if len(body) > 140 else "")
            prefix = "@ " if mention else ""
            lines.append(f"{prefix}{labels[r.conversation_id]} · {names.get(r.sender_id, '')}: {body}")
        if len(wanted) > 10:
            lines.append(t("email_digest_more", {"n": len(wanted) - 10}))
        mentions = [r for mention, r in wanted if mention]
        if mentions:
            first = mentions[0]
            key = "email_digest_mention"
            params = {"name": names.get(first.sender_id, ""), "place": labels.get(first.conversation_id, ""), "n": len(wanted)}
        else:
            key = "email_digest"
            params = {"n": len(wanted)}
        intro = t(f"{key}_body", params)
    target = (mentions[0] if mentions else wanted[0][1]).conversation_id
    await _send(db, user, key, params, f"/app/c/{target}", "digest", [intro, "\n".join(lines)])


# ---------- plan reminders (free year, free access from a code or from the administration) ----------

async def reminders_once(db: AsyncSession) -> int:
    """Remind people whose free access ends in 7 days, in 1 day, and when it has ended. Each reminder goes out once."""
    now = utcnow()
    grants = (await db.execute(select(AccessGrant).where(
        AccessGrant.until.isnot(None), AccessGrant.until > now - timedelta(days=2), AccessGrant.until <= now + timedelta(days=7),
    ))).scalars().all()
    sent = 0
    for grant in grants:
        user = await db.get(User, grant.user_id)
        if not user or not user.access_required or not can_email(user):
            continue
        status = await access_status(db, user)
        if status["source"] in ("stripe", "play"):
            continue  # they already pay: nothing ends
        left = grant.until - now
        stage = "ended" if left <= timedelta(0) else "1" if left <= timedelta(days=1) else "7"
        key = f"access_end:{stage}:{grant.until:%Y-%m-%d}"
        if await db.get(EmailNotice, (user.id, key)):
            continue
        date = grant.until.strftime("%d/%m/%Y")
        if await notify(db, user, None, "email_access_ended" if stage == "ended" else "email_access_ending",
                        {"date": date, "days": max(1, left.days + (1 if left.seconds else 0))}, "/app/account"):
            db.add(EmailNotice(user_id=user.id, key=key))
            await db.commit()
            sent += 1
    return sent


# ---------- background loop ----------

_task: asyncio.Task | None = None


async def _loop() -> None:
    last_reminders = 0.0
    while True:
        await asyncio.sleep(60 if last_reminders == 0.0 else DIGEST_EVERY)
        try:
            # Several API processes: only one runs each round.
            if not await get_redis().set("mail:loop", "1", nx=True, ex=DIGEST_EVERY - 30):
                continue
            async with SessionLocal() as db:
                await digest_once(db)
                loop_time = asyncio.get_running_loop().time()
                if loop_time - last_reminders >= REMINDERS_EVERY or last_reminders == 0.0:
                    last_reminders = loop_time
                    await reminders_once(db)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Automatic emails round failed")


def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


async def stop() -> None:
    global _task
    if _task:
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):
            pass
        _task = None
