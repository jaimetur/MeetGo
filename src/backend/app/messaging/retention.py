"""Communities keep their chat for a limited time (Conversation.retention_days): older messages are deleted for good,
with their thread replies, reactions, reports and files, so the history does not grow forever. The pinned message
(and its thread) never expires. Board posts, plans and
private chats are not affected."""

import logging
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Attachment, Conversation, Message, utcnow
from app.messaging.storage import file_path

logger = logging.getLogger("meetgo.retention")
BATCH = 2000


async def _unused(db: AsyncSession, keys: list[str]) -> list[str]:
    """The files no message uses any more (a chat copied into a new zone shares its files with the original)."""
    if not keys:
        return []
    used = set((await db.execute(select(Attachment.storage_key).where(Attachment.storage_key.in_(keys)))).scalars().all())
    used |= set((await db.execute(select(Attachment.thumb_key).where(Attachment.thumb_key.in_(keys)))).scalars().all())
    return [k for k in keys if k not in used]


def _remove_files(keys: list[str]) -> None:
    for key in keys:
        try:
            file_path(key).unlink(missing_ok=True)
        except Exception:  # a missing or odd file never stops the cleaning
            pass


async def purge_conversation(db: AsyncSession, conv: Conversation) -> int:
    """Deletes the messages older than the community's retention. Returns how many."""
    if not conv.retention_days:
        return 0
    cutoff = utcnow() - timedelta(days=conv.retention_days)
    total = 0
    # the pinned message never expires, nor do the replies of its thread
    pinned = conv.pinned_message_id or 0
    keep = (Message.id != pinned, func.coalesce(Message.thread_root_id, 0) != pinned)
    while True:
        roots = list((await db.execute(select(Message.id).where(
            Message.conversation_id == conv.id, Message.created_at < cutoff, *keep).order_by(Message.id).limit(BATCH))).scalars().all())
        if not roots:
            break
        # the replies of an expired thread go with it (they would be left without their first message)
        ids = set(roots) | set((await db.execute(select(Message.id).where(
            Message.conversation_id == conv.id, Message.thread_root_id.in_(roots), *keep))).scalars().all())
        files = [k for row in (await db.execute(select(Attachment.storage_key, Attachment.thumb_key).where(
            Attachment.message_id.in_(ids)))).all() for k in row if k]
        await db.execute(delete(Message).where(Message.id.in_(ids)))  # reactions, attachments and reports cascade
        total += len(ids)
        await db.commit()
        _remove_files(await _unused(db, files))
    if total:
        last = (await db.execute(select(Message).where(Message.conversation_id == conv.id).order_by(Message.id.desc()).limit(1))).scalar_one_or_none()
        conv.last_message_id = last.id if last else None
        conv.last_message_at = last.created_at if last else None
        await db.commit()
    return total


async def purge_archived(db: AsyncSession) -> int:
    """Deletes the chats of joined zones once their time to be read is over. Returns how many."""
    from datetime import datetime
    now = utcnow()
    gone = 0
    for conv in (await db.execute(select(Conversation).where(
            Conversation.kind == "group", Conversation.policy_json["archived_until"].astext.is_not(None)))).scalars().all():
        try:
            until = datetime.fromisoformat(conv.policy_json["archived_until"])
        except (TypeError, ValueError):
            continue
        if until > now:
            continue
        files = [k for row in (await db.execute(select(Attachment.storage_key, Attachment.thumb_key).join(
            Message, Message.id == Attachment.message_id).where(Message.conversation_id == conv.id))).all() for k in row if k]
        await db.execute(delete(Conversation).where(Conversation.id == conv.id))  # messages, members, files cascade
        await db.commit()
        _remove_files(await _unused(db, files))
        gone += 1
    return gone


async def purge_once(db: AsyncSession) -> int:
    """The automatic round: every community with old messages (the pinned one does not count). Returns how many
    messages were deleted."""
    oldest = func.min(Message.created_at)
    rows = (await db.execute(select(Conversation).join(Message, Message.conversation_id == Conversation.id).where(
        Conversation.kind == "channel", Conversation.retention_days.is_not(None),
        Message.id != func.coalesce(Conversation.pinned_message_id, 0),
        func.coalesce(Message.thread_root_id, 0) != func.coalesce(Conversation.pinned_message_id, 0)).group_by(Conversation.id).having(
        oldest < func.now() - func.make_interval(0, 0, 0, Conversation.retention_days)))).scalars().all()
    total = 0
    if await purge_archived(db):
        logger.info("Retention: archived zone chats deleted")
    for conv in rows:
        n = await purge_conversation(db, conv)
        if n:
            logger.info("Retention: %s old messages deleted from community %s", n, conv.id)
        total += n
    return total
