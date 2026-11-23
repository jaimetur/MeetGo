"""Sending, editing, deleting and reacting to messages, and telling everybody about it."""

import asyncio
import logging
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.i18n import t
from app.core.models import Attachment, Conversation, ConversationMember, Message, MessageReaction, User, utcnow
from app.core.redis_conn import get_redis
from app.realtime import service as realtime
from app.conversations.service import is_staff, messages_out
from app.messaging.moderation import apply_strike, decide_action

logger = logging.getLogger("meetgo.messaging")
EDIT_WINDOW = timedelta(hours=48)
_tasks: set[asyncio.Task] = set()


def _background(coro) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def recipients(db: AsyncSession, conversation_id: int) -> list[int]:
    res = await db.execute(select(ConversationMember.user_id).where(
        ConversationMember.conversation_id == conversation_id, ConversationMember.banned.is_(False)))
    return list(res.scalars().all())


def check_can_write(conv: Conversation, member: ConversationMember) -> None:
    if member.banned:
        raise HTTPException(403, t("err_banned_here"))
    if member.silenced_until and member.silenced_until > utcnow():
        raise HTTPException(403, t("err_silenced_until", {"until": member.silenced_until.strftime("%H:%M")}))


async def send_message(
    db: AsyncSession, conv: Conversation, member: ConversationMember, user: User, *, body: str,
    client_id: str | None = None, reply_to_id: int | None = None, thread_root_id: int | None = None,
    also_in_channel: bool = False, mention_ids: list[int] | None = None, attachment_ids: list[int] | None = None,
) -> tuple[dict, bool]:
    """Create a message (idempotent per client_id). Returns (message JSON, created)."""
    if client_id:
        res = await db.execute(select(Message).where(Message.sender_id == user.id, Message.client_id == client_id))
        existing = res.scalar_one_or_none()
        if existing:
            return (await messages_out(db, [existing], user.id))[0], False

    body = (body or "").strip()
    attachment_ids = list(dict.fromkeys(attachment_ids or []))[:10]
    if not body and not attachment_ids:
        raise HTTPException(400, t("err_empty_message"))
    if len(body) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(413, t("err_message_too_long"))
    check_can_write(conv, member)

    staff = is_staff(member, user)
    if conv.slow_mode_seconds and not staff:
        ok = await get_redis().set(f"slow:{conv.id}:{user.id}", "1", nx=True, ex=conv.slow_mode_seconds)
        if not ok:
            ttl = await get_redis().ttl(f"slow:{conv.id}:{user.id}")
            raise HTTPException(429, t("err_slow_mode", {"seconds": max(int(ttl), 1)}))

    root = None
    if thread_root_id:
        root = await db.get(Message, thread_root_id)
        if not root or root.conversation_id != conv.id or root.thread_root_id or root.deleted_at:
            raise HTTPException(404, t("err_message_not_found"))
    if reply_to_id:
        target = await db.get(Message, reply_to_id)
        if not target or target.conversation_id != conv.id:
            reply_to_id = None

    attachments: list[Attachment] = []
    if attachment_ids:
        res = await db.execute(select(Attachment).where(
            Attachment.id.in_(attachment_ids), Attachment.uploader_id == user.id, Attachment.message_id.is_(None)))
        attachments = list(res.scalars().all())
        if not body and not attachments:
            raise HTTPException(400, t("err_empty_message"))

    mentions: list[int] = []
    if mention_ids and conv.kind != "dm":
        res = await db.execute(select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conv.id, ConversationMember.user_id.in_(set(mention_ids))))
        mentions = sorted(set(res.scalars().all()) - {user.id})

    now = utcnow()
    msg = Message(conversation_id=conv.id, sender_id=user.id, client_id=client_id, kind="text", body=body,
                  reply_to_id=reply_to_id, thread_root_id=root.id if root else None,
                  also_in_channel=bool(root and also_in_channel), mentions=mentions, created_at=now)

    if conv.kind == "channel" and body and not staff:
        action = await decide_action(get_redis(), conv, user.id, body)
        if action.delete_message:
            msg.deleted_at = now
            msg.moderation_reason = action.reason or "MODERATED"
            msg.mentions = []
            attachments = []
        apply_strike(conv, member, action)

    db.add(msg)
    await db.flush()
    for a in attachments:
        a.message_id = msg.id
    in_main_stream = root is None or msg.also_in_channel
    if root:
        root.thread_reply_count = (root.thread_reply_count or 0) + 1
        root.thread_last_reply_at = now
    if in_main_stream:
        conv.last_message_id = msg.id
        conv.last_message_at = now
        member.last_read_message_id = max(member.last_read_message_id or 0, msg.id)
    await db.execute(update(ConversationMember).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.hidden.is_(True)).values(hidden=False))
    await db.commit()

    payload = (await messages_out(db, [msg], user.id))[0]
    to = await recipients(db, conv.id)
    await realtime.publish(to, {"type": "message.created", "conversation_id": conv.id, "message": payload})
    if root:
        root_payload = (await messages_out(db, [root], user.id))[0]
        await realtime.publish(to, {"type": "message.updated", "conversation_id": conv.id, "message": root_payload})
    if not msg.deleted_at:
        from app.push.service import notify_message
        _background(notify_message(conv.id, msg.id))
    return payload, True


async def edit_message(db: AsyncSession, msg: Message, user: User, body: str) -> dict:
    if msg.sender_id != user.id:
        raise HTTPException(403, t("err_forbidden"))
    if msg.deleted_at:
        raise HTTPException(409, t("err_message_deleted"))
    if utcnow() - msg.created_at > EDIT_WINDOW:
        raise HTTPException(409, t("err_edit_window"))
    body = (body or "").strip()
    if not body:
        raise HTTPException(400, t("err_empty_message"))
    if len(body) > settings.MAX_MESSAGE_CHARS:
        raise HTTPException(413, t("err_message_too_long"))
    msg.body = body
    msg.edited_at = utcnow()
    await db.commit()
    payload = (await messages_out(db, [msg], user.id))[0]
    await realtime.publish(await recipients(db, msg.conversation_id),
                           {"type": "message.updated", "conversation_id": msg.conversation_id, "message": payload})
    return payload


async def delete_message(db: AsyncSession, msg: Message, user: User, member: ConversationMember | None) -> None:
    if msg.sender_id != user.id and not is_staff(member, user):
        raise HTTPException(403, t("err_forbidden"))
    if msg.deleted_at:
        return
    msg.deleted_at = utcnow()
    if msg.sender_id != user.id:
        msg.moderation_reason = "REMOVED_BY_MODERATOR"
    await db.execute(update(Attachment).where(Attachment.message_id == msg.id).values(message_id=None))
    await db.commit()
    await realtime.publish(await recipients(db, msg.conversation_id), {
        "type": "message.deleted", "conversation_id": msg.conversation_id, "message_id": msg.id,
        "thread_root_id": msg.thread_root_id, "moderation_reason": msg.moderation_reason,
    })


async def set_reaction(db: AsyncSession, msg: Message, user: User, emoji: str, on: bool) -> list[dict]:
    emoji = (emoji or "").strip()
    if not emoji or len(emoji) > 16:
        raise HTTPException(400, t("err_invalid_reaction"))
    if msg.deleted_at:
        raise HTTPException(409, t("err_message_deleted"))
    res = await db.execute(select(MessageReaction).where(
        MessageReaction.message_id == msg.id, MessageReaction.user_id == user.id, MessageReaction.emoji == emoji))
    existing = res.scalar_one_or_none()
    if on and not existing:
        count = len((await db.execute(select(MessageReaction.emoji).where(
            MessageReaction.message_id == msg.id, MessageReaction.user_id == user.id))).scalars().all())
        if count >= 10:
            raise HTTPException(409, t("err_too_many_reactions"))
        db.add(MessageReaction(message_id=msg.id, user_id=user.id, emoji=emoji))
    elif not on and existing:
        await db.delete(existing)
    await db.commit()
    reactions: dict[str, list[int]] = {}
    for r in (await db.execute(select(MessageReaction).where(MessageReaction.message_id == msg.id).order_by(MessageReaction.created_at))).scalars().all():
        reactions.setdefault(r.emoji, []).append(r.user_id)
    out = [{"emoji": e, "count": len(u), "user_ids": u[:50]} for e, u in reactions.items()]
    await realtime.publish(await recipients(db, msg.conversation_id), {
        "type": "reaction.updated", "conversation_id": msg.conversation_id, "message_id": msg.id, "reactions": out})
    return out


async def mark_read(db: AsyncSession, conv: Conversation, member: ConversationMember, message_id: int) -> int:
    upto = min(int(message_id), conv.last_message_id or 0)
    if upto > (member.last_read_message_id or 0):
        member.last_read_message_id = upto
        await db.commit()
        event = {"type": "read.updated", "conversation_id": conv.id, "user_id": member.user_id,
                 "last_read_message_id": upto}
        # Read receipts are visible in direct messages and groups; in channels only the reader's devices hear it.
        to = await recipients(db, conv.id) if conv.kind != "channel" else [member.user_id]
        await realtime.publish(to, event)
    return member.last_read_message_id
