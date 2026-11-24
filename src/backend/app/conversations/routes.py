import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, require_write_access
from app.core.i18n import t
from app.core.models import (
    Conversation, ConversationMember, DMRequest, DMStatus, Friendship, Message, User, utcnow,
)
from app.core.redis_conn import get_redis
from app.core.schemas import (
    ConversationUpdateIn, DMOpenIn, DMRequestResolveIn, GroupCreateIn, MemberRoleIn, MemberSettingsIn, MembersAddIn,
    ModerateIn, ReadIn,
)
from app.mail import notify_email
from app.realtime import service as realtime
from app.conversations.service import (
    conversations_out, dm_between, get_membership, is_staff, join, messages_out, require_member, user_summary,
)
from app.messaging.service import mark_read, recipients

from app.social.blocks import require_not_blocked

router = APIRouter(tags=["conversations"])


async def _friends(db: AsyncSession, a: int, b: int) -> bool:
    return bool((await db.execute(select(Friendship).where(Friendship.user_id == a, Friendship.friend_id == b))).first())


async def _system(db: AsyncSession, conv: Conversation, body: str) -> None:
    msg = Message(conversation_id=conv.id, sender_id=None, kind="system", body=body, mentions=[], created_at=utcnow())
    db.add(msg)
    await db.flush()
    conv.last_message_id, conv.last_message_at = msg.id, msg.created_at


async def _changed(db: AsyncSession, conv_id: int, extra: list[int] | None = None) -> None:
    realtime.invalidate_members(conv_id)
    to = set(await recipients(db, conv_id)) | set(extra or [])
    await realtime.publish(to, {"type": "conversation.changed", "conversation_id": conv_id})


@router.get("/conversations", response_model=list[dict])
async def list_conversations(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await conversations_out(db, user)


@router.get("/conversations/{conv_id}", response_model=dict)
async def get_conversation(conv_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, member = await require_member(db, conv_id, user)
    items = await conversations_out(db, user, only_ids=[conv_id])
    if not items:  # hidden direct message: show it anyway when opened explicitly
        member.hidden = False
        await db.commit()
        items = await conversations_out(db, user, only_ids=[conv_id])
    item = items[0]
    item["rules_markdown"] = conv.rules_markdown
    item["invite_code"] = conv.invite_code if conv.kind == "group" and is_staff(member, user) else None
    if conv.pinned_message_id:
        pinned = await db.get(Message, conv.pinned_message_id)
        item["pinned_message"] = (await messages_out(db, [pinned], user.id))[0] if pinned and not pinned.deleted_at else None
    return item


@router.post("/conversations/groups", response_model=dict)
async def create_group(payload: GroupCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    conv = Conversation(kind="group", title=payload.title.strip(), description=payload.description,
                        created_by_id=user.id, created_at=utcnow(), slow_mode_seconds=0, rules_markdown="", policy_json={},
                        invite_code=secrets.token_urlsafe(9))
    db.add(conv)
    await db.flush()
    await join(db, conv, user.id, role="owner", notify="all")
    added = []
    for uid in dict.fromkeys(payload.member_ids):
        if uid != user.id and await _friends(db, user.id, uid):
            await join(db, conv, uid, notify="all")
            added.append(uid)
    await _system(db, conv, t("sys_group_created", {"name": user.display_name}))
    await db.commit()
    await _changed(db, conv.id)
    return {"id": conv.id, "added": added}


@router.patch("/conversations/{conv_id}", response_model=dict)
async def update_conversation(conv_id: int, payload: ConversationUpdateIn, db: AsyncSession = Depends(get_db),
                              user: User = Depends(require_write_access)):
    conv, member = await require_member(db, conv_id, user)
    if not is_staff(member, user):
        raise HTTPException(403, t("err_forbidden"))
    if conv.kind == "dm":
        raise HTTPException(400, t("err_forbidden"))
    if conv.kind == "group":
        if payload.title is not None:
            conv.title = payload.title.strip()
        if payload.description is not None:
            conv.description = payload.description
        if payload.avatar_url is not None:
            conv.avatar_url = payload.avatar_url or None
    if payload.slow_mode_seconds is not None:
        conv.slow_mode_seconds = payload.slow_mode_seconds
    if payload.rules_markdown is not None:
        conv.rules_markdown = payload.rules_markdown
    if payload.pinned_message_id is not None:
        if payload.pinned_message_id == 0:
            conv.pinned_message_id = None
        else:
            msg = await db.get(Message, payload.pinned_message_id)
            if not msg or msg.conversation_id != conv.id:
                raise HTTPException(404, t("err_message_not_found"))
            conv.pinned_message_id = msg.id
    await db.commit()
    await _changed(db, conv.id)
    return {"ok": True}


@router.get("/conversations/{conv_id}/members", response_model=list[dict])
async def list_members(conv_id: int, q: str = "", limit: int = 200, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    await require_member(db, conv_id, user)
    query = select(ConversationMember, User).join(User, User.id == ConversationMember.user_id).where(
        ConversationMember.conversation_id == conv_id, ConversationMember.banned.is_(False),
        ConversationMember.away.is_(False))
    if q.strip():
        query = query.where(User.display_name.ilike(f"%{q.strip()}%"))
    rows = (await db.execute(query.limit(max(1, min(limit, 500))))).all()
    online = await realtime.online_ids([u.id for _, u in rows])
    order = {"owner": 0, "admin": 1, "moderator": 2, "member": 3}
    out = [{**user_summary(u), "role": m.role, "online": u.id in online,
            "silenced_until": m.silenced_until.isoformat() if m.silenced_until and m.silenced_until > utcnow() else None}
           for m, u in rows]
    out.sort(key=lambda x: (order.get(x["role"], 9), not x["online"], x["display_name"].lower()))
    return out


@router.post("/conversations/{conv_id}/members", response_model=dict)
async def add_members(conv_id: int, payload: MembersAddIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_write_access)):
    conv, member = await require_member(db, conv_id, user)
    if conv.kind != "group" or not is_staff(member, user):
        raise HTTPException(403, t("err_forbidden"))
    added = []
    for uid in dict.fromkeys(payload.user_ids):
        if uid == user.id or not await _friends(db, user.id, uid):
            continue
        existing = await get_membership(db, conv.id, uid)
        if existing and existing.banned:
            continue
        if not existing:
            await join(db, conv, uid, notify="all")
            other = await db.get(User, uid)
            await _system(db, conv, t("sys_member_added", {"name": other.display_name, "by": user.display_name}))
            added.append(uid)
    await db.commit()
    await _changed(db, conv.id)
    for uid in added:
        await notify_email.notify(db, await db.get(User, uid), "requests", "email_group_added",
                                  {"name": user.display_name, "group": conv.title or ""}, f"/app/c/{conv.id}")
    return {"added": added}


@router.delete("/conversations/{conv_id}/members/{user_id}", response_model=dict)
async def remove_member(conv_id: int, user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Leave (your own id) or remove someone (group owners and admins)."""
    conv, member = await require_member(db, conv_id, user)
    if conv.kind == "dm":
        member.hidden = True
        await db.commit()
        return {"ok": True}
    target = await get_membership(db, conv.id, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    if user_id != user.id and not (is_staff(member, user) and target.role != "owner"):
        raise HTTPException(403, t("err_forbidden"))
    other = await db.get(User, user_id)
    was_owner = target.role == "owner"
    await db.delete(target)
    await db.flush()
    if conv.kind == "group":
        key = "sys_member_left" if user_id == user.id else "sys_member_removed"
        await _system(db, conv, t(key, {"name": other.display_name if other else "—", "by": user.display_name}))
        if was_owner:
            # Hand the group to the longest-standing member.
            nxt = (await db.execute(select(ConversationMember).where(ConversationMember.conversation_id == conv.id)
                                    .order_by(ConversationMember.joined_at).limit(1))).scalar_one_or_none()
            if nxt:
                nxt.role = "owner"
    await db.commit()
    await _changed(db, conv.id, extra=[user_id])
    await realtime.publish([user_id], {"type": "membership.removed", "conversation_id": conv.id})
    return {"ok": True}


@router.put("/conversations/{conv_id}/members/{user_id}/role", response_model=dict)
async def set_member_role(conv_id: int, user_id: int, payload: MemberRoleIn, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    conv, member = await require_member(db, conv_id, user)
    allowed = user.role == "admin" or (conv.kind == "group" and member.role == "owner")
    if not allowed or conv.kind == "dm":
        raise HTTPException(403, t("err_forbidden"))
    target = await get_membership(db, conv.id, user_id)
    if not target or target.role == "owner":
        raise HTTPException(404, t("err_user_not_found"))
    target.role = payload.role
    await db.commit()
    await _changed(db, conv.id)
    return {"ok": True}


@router.post("/conversations/{conv_id}/members/{user_id}/moderate", response_model=dict)
async def moderate_member(conv_id: int, user_id: int, payload: ModerateIn, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    conv, member = await require_member(db, conv_id, user)
    if not is_staff(member, user) or conv.kind == "dm":
        raise HTTPException(403, t("err_forbidden"))
    target = await get_membership(db, conv.id, user_id)
    if not target or target.role == "owner" or (target.role in ("admin", "moderator") and user.role != "admin" and member.role != "owner"):
        raise HTTPException(403, t("err_forbidden"))
    if payload.action == "silence":
        target.silenced_until = utcnow() + timedelta(minutes=payload.minutes)
    elif payload.action == "unsilence":
        target.silenced_until = None
    elif payload.action == "ban":
        target.banned = True
    elif payload.action == "unban":
        target.banned = False
        target.strikes = 0
    elif payload.action == "remove":
        await db.delete(target)
    await db.commit()
    await _changed(db, conv.id, extra=[user_id])
    if payload.action in ("silence", "ban", "remove"):
        target_user = await db.get(User, user_id)
        place = await notify_email.conversation_label(db, conv)
        await notify_email.notify(db, target_user, None, f"email_mod_{payload.action}", {"place": place, "minutes": payload.minutes},
                                  None if payload.action == "remove" else f"/app/c/{conv.id}")
    return {"ok": True}


@router.post("/conversations/{conv_id}/invite", response_model=dict)
async def new_invite(conv_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, member = await require_member(db, conv_id, user)
    if conv.kind != "group" or not is_staff(member, user):
        raise HTTPException(403, t("err_forbidden"))
    conv.invite_code = secrets.token_urlsafe(9)
    await db.commit()
    return {"invite_code": conv.invite_code}


@router.post("/conversations/join/{code}", response_model=dict)
async def join_by_invite(code: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    res = await db.execute(select(Conversation).where(Conversation.invite_code == code, Conversation.kind == "group"))
    conv = res.scalar_one_or_none()
    if not conv:
        raise HTTPException(404, t("err_invite_invalid"))
    existing = await get_membership(db, conv.id, user.id)
    if existing and existing.banned:
        raise HTTPException(403, t("err_banned_here"))
    if not existing:
        await join(db, conv, user.id, notify="all")
        await _system(db, conv, t("sys_member_joined", {"name": user.display_name}))
        await db.commit()
        await _changed(db, conv.id)
    return {"conversation_id": conv.id}


@router.patch("/conversations/{conv_id}/settings", response_model=dict)
async def my_settings(conv_id: int, payload: MemberSettingsIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    conv, member = await require_member(db, conv_id, user)
    if payload.notify is not None:
        member.notify = payload.notify
    if payload.mute_minutes is not None:
        member.muted_until = utcnow() + timedelta(minutes=payload.mute_minutes) if payload.mute_minutes else None
    if payload.pinned is not None:
        member.pinned = payload.pinned
    await db.commit()
    await realtime.publish([user.id], {"type": "conversation.changed", "conversation_id": conv.id})
    return {"ok": True}


@router.post("/conversations/{conv_id}/delete-for-me", response_model=dict)
async def delete_for_me(conv_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Deletes the chat only for you: its messages so far are no longer shown to you and it leaves your list until
    someone writes again. The others keep everything, and you stay a member."""
    conv, member = await require_member(db, conv_id, user)
    last = conv.last_message_id or 0
    member.cleared_message_id = last
    member.last_read_message_id = max(member.last_read_message_id or 0, last)
    member.hidden = True
    member.pinned = False
    await db.commit()
    await realtime.publish([user.id], {"type": "conversation.hidden", "conversation_id": conv.id})
    return {"ok": True}


@router.post("/conversations/{conv_id}/read", response_model=dict)
async def read(conv_id: int, payload: ReadIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, member = await require_member(db, conv_id, user)
    return {"last_read_message_id": await mark_read(db, conv, member, payload.message_id)}


@router.get("/conversations/{conv_id}/read-state", response_model=list[dict])
async def read_state(conv_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Where each member has read up to: read receipts for direct messages and small groups."""
    conv, _ = await require_member(db, conv_id, user)
    if conv.kind == "channel":
        return []
    res = await db.execute(select(ConversationMember.user_id, ConversationMember.last_read_message_id).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.user_id != user.id).limit(50))
    return [{"user_id": uid, "last_read_message_id": last} for uid, last in res.all()]


# ---------- direct messages ----------

@router.post("/conversations/dm", response_model=dict)
async def open_dm(payload: DMOpenIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    """Friends talk at once. Others need a request, and only if they accept direct messages."""
    if payload.user_id == user.id:
        raise HTTPException(400, t("err_cannot_dm_self"))
    other = await db.get(User, payload.user_id)
    if not other or other.is_banned:
        raise HTTPException(404, t("err_user_not_found"))
    await require_not_blocked(db, user.id, other.id)
    existing = await dm_between(db, user.id, other.id, create=False)
    if existing:
        member = await get_membership(db, existing.id, user.id)
        if member and member.hidden:
            member.hidden = False
            await db.commit()
        return {"conversation_id": existing.id}
    if await _friends(db, user.id, other.id):
        conv = await dm_between(db, user.id, other.id)
        await db.commit()
        await realtime.publish([user.id, other.id], {"type": "conversation.changed", "conversation_id": conv.id})
        return {"conversation_id": conv.id}
    if not other.accept_dm:
        raise HTTPException(403, t("err_user_no_dm"))
    pending = (await db.execute(select(DMRequest).where(
        DMRequest.from_user_id == user.id, DMRequest.to_user_id == other.id, DMRequest.status == DMStatus.PENDING))).scalar_one_or_none()
    if pending:
        return {"request_id": pending.id, "status": "pending"}
    key = f"dm_req:{user.id}:{datetime.utcnow():%Y-%m-%d}"
    count = await get_redis().incr(key)
    if count == 1:
        await get_redis().expire(key, 26 * 3600)
    if count > 10:
        raise HTTPException(429, t("err_dm_daily_limit"))
    req = DMRequest(from_user_id=user.id, to_user_id=other.id, status=DMStatus.PENDING)
    db.add(req)
    await db.commit()
    await realtime.publish([other.id], {"type": "requests.changed"})
    await notify_email.notify(db, other, "requests", "email_dm_request", {"name": user.display_name}, "/app/people")
    return {"request_id": req.id, "status": "pending"}


@router.get("/dm/requests", response_model=list[dict])
async def dm_requests(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMRequest, User).join(User, User.id == DMRequest.from_user_id).where(
        DMRequest.to_user_id == user.id, DMRequest.status == DMStatus.PENDING).order_by(DMRequest.id.desc()))
    return [{"id": r.id, "from_user": user_summary(u), "created_at": r.created_at.isoformat() + "Z"} for r, u in res.all()]


@router.post("/dm/requests/{request_id}/resolve", response_model=dict)
async def resolve_dm_request(request_id: int, payload: DMRequestResolveIn, db: AsyncSession = Depends(get_db),
                             user: User = Depends(get_current_user)):
    req = await db.get(DMRequest, request_id)
    if not req or req.to_user_id != user.id:
        raise HTTPException(404, t("err_request_not_found"))
    if req.status != DMStatus.PENDING:
        raise HTTPException(409, t("err_already_resolved"))
    req.status = DMStatus.ACCEPTED if payload.accept else DMStatus.REJECTED
    req.resolved_at = datetime.utcnow()
    conv_id = None
    if payload.accept:
        conv = await dm_between(db, req.from_user_id, req.to_user_id)
        conv_id = conv.id
    await db.commit()
    await realtime.publish([req.from_user_id, user.id], {"type": "requests.changed"})
    if conv_id:
        await realtime.publish([req.from_user_id, user.id], {"type": "conversation.changed", "conversation_id": conv_id})
        await notify_email.notify(db, await db.get(User, req.from_user_id), "requests", "email_dm_accepted",
                                  {"name": user.display_name}, f"/app/c/{conv_id}")
    return {"ok": True, "conversation_id": conv_id}


# ---------- search and mentions ----------

@router.get("/search/messages", response_model=list[dict])
async def search_messages(q: str, conversation_id: int | None = None, limit: int = 30,
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    q = q.strip()
    if len(q) < 2:
        return []
    mine = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user.id,
                                                            ConversationMember.banned.is_(False),
                                                            ConversationMember.away.is_(False))
    ts_query = func.plainto_tsquery("simple", q)
    query = select(Message).where(
        Message.conversation_id.in_(mine), Message.deleted_at.is_(None), Message.kind == "text",
        Message.id > select(ConversationMember.cleared_message_id).where(
            ConversationMember.conversation_id == Message.conversation_id, ConversationMember.user_id == user.id
        ).scalar_subquery(),
        or_(func.to_tsvector("simple", Message.body).op("@@")(ts_query), Message.body.ilike(f"%{q}%")),
    )
    if conversation_id:
        query = query.where(Message.conversation_id == conversation_id)
    msgs = list((await db.execute(query.order_by(Message.id.desc()).limit(max(1, min(limit, 100))))).scalars().all())
    return await messages_out(db, msgs, user.id)


@router.get("/mentions", response_model=list[dict])
async def my_mentions(limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    mine = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user.id,
                                                            ConversationMember.away.is_(False))
    res = await db.execute(select(Message).where(
        Message.conversation_id.in_(mine), Message.deleted_at.is_(None), Message.mentions.contains([user.id]),
    ).order_by(Message.id.desc()).limit(max(1, min(limit, 100))))
    return await messages_out(db, list(res.scalars().all()), user.id)
