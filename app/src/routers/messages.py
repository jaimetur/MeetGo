from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_write_access
from ..i18n import t
from ..models import Attachment, Message, Report, User
from ..schemas import MessageCreateIn, MessageEditIn, ReportIn
from ..services.conversations import get_membership, messages_out, require_member
from ..services.messaging import delete_message, edit_message, send_message, set_reaction
from ..services.storage import attachment_out, check_signature, file_path, save_upload

router = APIRouter(tags=["messages"])


@router.get("/conversations/{conv_id}/messages", response_model=dict)
async def list_messages(conv_id: int, before_id: int | None = None, after_id: int | None = None,
                        around_id: int | None = None, thread_root_id: int | None = None, limit: int = 50,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """A page of the main conversation, or of one thread. Pages go backwards with before_id."""
    conv, member = await require_member(db, conv_id, user)
    limit = max(1, min(limit, 100))
    base = select(Message).where(Message.conversation_id == conv.id)
    if thread_root_id:
        base = base.where(Message.thread_root_id == thread_root_id)
    else:
        base = base.where(or_(Message.thread_root_id.is_(None), Message.also_in_channel.is_(True)))

    if around_id:
        older = (await db.execute(base.where(Message.id <= around_id).order_by(Message.id.desc()).limit(limit // 2))).scalars().all()
        newer = (await db.execute(base.where(Message.id > around_id).order_by(Message.id).limit(limit // 2))).scalars().all()
        msgs = list(reversed(older)) + list(newer)
        has_more_before, has_more_after = len(older) == limit // 2, len(newer) == limit // 2
    elif after_id is not None:
        msgs = list((await db.execute(base.where(Message.id > after_id).order_by(Message.id).limit(limit + 1))).scalars().all())
        has_more_after = len(msgs) > limit
        msgs = msgs[:limit]
        has_more_before = True
    else:
        q = base.where(Message.id < before_id) if before_id else base
        msgs = list((await db.execute(q.order_by(Message.id.desc()).limit(limit + 1))).scalars().all())
        has_more_before = len(msgs) > limit
        msgs = list(reversed(msgs[:limit]))
        has_more_after = False

    root = None
    if thread_root_id:
        root_msg = await db.get(Message, thread_root_id)
        if not root_msg or root_msg.conversation_id != conv.id:
            raise HTTPException(404, t("err_message_not_found"))
        root = (await messages_out(db, [root_msg], user.id))[0]
    return {
        "messages": await messages_out(db, msgs, user.id),
        "has_more_before": has_more_before,
        "has_more_after": has_more_after,
        "last_read_message_id": member.last_read_message_id,
        "thread_root": root,
    }


@router.post("/conversations/{conv_id}/messages", response_model=dict)
async def post_message(conv_id: int, payload: MessageCreateIn, db: AsyncSession = Depends(get_db),
                       user: User = Depends(require_write_access)):
    conv, member = await require_member(db, conv_id, user)
    try:
        message, _ = await send_message(
            db, conv, member, user, body=payload.body, client_id=payload.client_id, reply_to_id=payload.reply_to_id,
            thread_root_id=payload.thread_root_id, also_in_channel=payload.also_in_channel,
            mention_ids=payload.mention_ids, attachment_ids=payload.attachment_ids,
        )
    except IntegrityError:
        # The same client_id arrived twice at once: return the stored one.
        await db.rollback()
        res = await db.execute(select(Message).where(Message.sender_id == user.id, Message.client_id == payload.client_id))
        existing = res.scalar_one_or_none()
        if not existing:
            raise
        message = (await messages_out(db, [existing], user.id))[0]
    return message


async def _own_conversation_message(db: AsyncSession, message_id: int, user: User):
    msg = await db.get(Message, message_id)
    member = await get_membership(db, msg.conversation_id, user.id) if msg else None
    if not msg or not member:
        raise HTTPException(404, t("err_message_not_found"))
    return msg, member


@router.patch("/messages/{message_id}", response_model=dict)
async def patch_message(message_id: int, payload: MessageEditIn, db: AsyncSession = Depends(get_db),
                        user: User = Depends(require_write_access)):
    msg, _ = await _own_conversation_message(db, message_id, user)
    return await edit_message(db, msg, user, payload.body)


@router.delete("/messages/{message_id}", response_model=dict)
async def remove_message(message_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    msg, member = await _own_conversation_message(db, message_id, user)
    await delete_message(db, msg, user, member)
    return {"ok": True}


@router.put("/messages/{message_id}/reactions/{emoji}", response_model=list[dict])
async def add_reaction(message_id: int, emoji: str, db: AsyncSession = Depends(get_db),
                       user: User = Depends(require_write_access)):
    msg, _ = await _own_conversation_message(db, message_id, user)
    return await set_reaction(db, msg, user, emoji, True)


@router.delete("/messages/{message_id}/reactions/{emoji}", response_model=list[dict])
async def remove_reaction(message_id: int, emoji: str, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    msg, _ = await _own_conversation_message(db, message_id, user)
    return await set_reaction(db, msg, user, emoji, False)


@router.post("/messages/{message_id}/report", response_model=dict)
async def report_message(message_id: int, payload: ReportIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    msg, _ = await _own_conversation_message(db, message_id, user)
    if msg.sender_id == user.id:
        raise HTTPException(400, t("err_report_own"))
    db.add(Report(message_id=msg.id, reporter_id=user.id, reason=payload.reason, details=payload.details))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
    return {"ok": True}


# ---------- attachments ----------

@router.post("/uploads", response_model=dict)
async def upload(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    att = await save_upload(file, user.id)
    db.add(att)
    await db.commit()
    await db.refresh(att)
    return attachment_out(att)


@router.get("/files/{attachment_id}/{variant}")
async def get_file(attachment_id: int, variant: str, exp: int = 0, sig: str = "", db: AsyncSession = Depends(get_db)):
    if variant not in ("file", "thumb") or not check_signature(attachment_id, variant, exp, sig):
        raise HTTPException(404, t("err_file_not_found"))
    att = await db.get(Attachment, attachment_id)
    if not att:
        raise HTTPException(404, t("err_file_not_found"))
    key = att.thumb_key if variant == "thumb" and att.thumb_key else att.storage_key
    path = file_path(key)
    if not path.exists():
        raise HTTPException(404, t("err_file_not_found"))
    inline = att.mime.startswith(("image/", "audio/", "video/")) or att.mime == "application/pdf"
    media = "image/webp" if variant == "thumb" and att.thumb_key else att.mime
    return FileResponse(path, media_type=media, filename=None if inline else att.file_name,
                        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})
