"""Sending, editing, deleting and reacting to messages, and telling everybody about it."""

import asyncio
import logging
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.i18n import t, use_lang
from app.core.models import Attachment, Conversation, ConversationMember, Message, MessageReaction, User, utcnow
from app.core.redis_conn import get_redis
from app.realtime import service as realtime
from app.conversations.service import is_staff, messages_out
from app.communities import automod
from app.messaging.moderation import decide_action

logger = logging.getLogger("meetgo.messaging")
EDIT_WINDOW = timedelta(hours=48)
_tasks: set[asyncio.Task] = set()


def _background(coro) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def recipients(db: AsyncSession, conversation_id: int) -> list[int]:
    res = await db.execute(select(ConversationMember.user_id).where(
        ConversationMember.conversation_id == conversation_id, ConversationMember.banned.is_(False),
        ConversationMember.away.is_(False)))
    return list(res.scalars().all())


def check_can_write(conv: Conversation, member: ConversationMember) -> None:
    if (conv.policy_json or {}).get("read_only"):  # the plan chat of a deleted board post
        raise HTTPException(403, t("err_read_only_chat"))
    if member.banned or member.away:
        raise HTTPException(403, t("err_banned_here"))
    if member.silenced_until and member.silenced_until > utcnow():
        raise HTTPException(403, t("err_silenced_until", {"until": member.silenced_until.strftime("%H:%M")}))
    if member.ban_until and member.ban_until > utcnow():
        raise HTTPException(403, t("err_banned_until", {"until": member.ban_until.strftime("%d/%m %H:%M")}))


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
    if conv.kind == "dm":  # a direct message with someone who blocked me, or whom I blocked
        from app.social.blocks import require_not_blocked
        other = (await db.execute(select(ConversationMember.user_id).where(
            ConversationMember.conversation_id == conv.id, ConversationMember.user_id != user.id))).scalar_one_or_none()
        if other:
            await require_not_blocked(db, user.id, other)

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
            ConversationMember.conversation_id == conv.id, ConversationMember.user_id.in_(set(mention_ids)),
            ConversationMember.away.is_(False)))
        mentions = sorted(set(res.scalars().all()) - {user.id})

    now = utcnow()
    msg = Message(conversation_id=conv.id, sender_id=user.id, client_id=client_id, kind="text", body=body,
                  reply_to_id=reply_to_id, thread_root_id=root.id if root else None,
                  also_in_channel=bool(root and also_in_channel), mentions=mentions, created_at=now)

    broken_rule: str | None = None
    if conv.kind == "channel" and body and not staff:
        action = await decide_action(get_redis(), conv, user.id, body)
        if action.delete_message:
            msg.deleted_at = now
            msg.moderation_reason = action.reason or "MODERATED"
            msg.mentions = []
            attachments = []
        if action.reason in automod.RULE_REASONS:
            # Insults, phone numbers and links break the rules: the moderation bot's ladder of bans.
            with use_lang(user.lang):
                broken_rule = t(f"automod_rule_{action.reason.lower()}")
        elif action.mute_minutes:  # flooding: a short silence
            member.silenced_until = now + timedelta(minutes=action.mute_minutes)

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
        ConversationMember.conversation_id == conv.id, ConversationMember.hidden.is_(True),
        ConversationMember.banned.is_(False)).values(hidden=False))
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
        if conv.kind == "channel" and not staff and body:
            _background(automod.check_message(conv.id, msg.id))
    if broken_rule:
        await automod.punish(db, conv, user.id, broken_rule)
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


def receipts_shared(conv: Conversation, reader: User | None, viewer: User | None) -> bool:
    """Blue ticks, as in WhatsApp: always in groups; in direct messages only if both people keep read receipts on."""
    if conv.kind != "dm":
        return True
    return bool(reader and viewer and reader.read_receipts is not False and viewer.read_receipts is not False)


async def mark_read(db: AsyncSession, conv: Conversation, member: ConversationMember, message_id: int) -> int:
    upto = min(int(message_id), conv.last_message_id or 0)
    if upto > (member.last_read_message_id or 0):
        member.last_read_message_id = upto
        member.last_delivered_message_id = max(member.last_delivered_message_id or 0, upto)  # read is delivered too
        await db.commit()
        read = {"type": "read.updated", "conversation_id": conv.id, "user_id": member.user_id, "last_read_message_id": upto}
        if conv.kind == "channel":  # no receipts in channels: only the reader's devices hear it
            await realtime.publish([member.user_id], read)
            return member.last_read_message_id
        to = await recipients(db, conv.id)
        users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(to)))).scalars().all()}
        reader = users.get(member.user_id)
        shared = [uid for uid in to if uid == member.user_id or receipts_shared(conv, reader, users.get(uid))]
        hidden = [uid for uid in to if uid not in shared]
        await realtime.publish(shared, read)
        if hidden:  # they see it delivered (✓✓ grey), not read
            await realtime.publish(hidden, {"type": "delivered.updated", "conversation_id": conv.id, "user_id": member.user_id,
                                            "last_delivered_message_id": member.last_delivered_message_id})
    return member.last_read_message_id


async def mark_delivered(db: AsyncSession, user: User, conv_ids: list[int] | None = None) -> int:
    """My app has the messages (✓✓): direct messages and groups up to their last message. Tells the senders. Returns how
    many conversations moved."""
    q = select(ConversationMember, Conversation).join(Conversation, Conversation.id == ConversationMember.conversation_id).where(
        ConversationMember.user_id == user.id, Conversation.kind.in_(("dm", "group")), ConversationMember.away.is_(False),
        ConversationMember.banned.is_(False), Conversation.last_message_id > ConversationMember.last_delivered_message_id)
    if conv_ids is not None:
        q = q.where(Conversation.id.in_(conv_ids))
    moved = []
    for member, conv in (await db.execute(q)).all():
        member.last_delivered_message_id = conv.last_message_id
        moved.append(conv.id)
    await db.commit()
    for cid in moved:
        event = {"type": "delivered.updated", "conversation_id": cid, "user_id": user.id,
                 "last_delivered_message_id": (await db.get(Conversation, cid)).last_message_id}
        await realtime.publish([u for u in await recipients(db, cid) if u != user.id], event)
    return len(moved)
