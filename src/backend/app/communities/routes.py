"""Communities API (see docs/COMMUNITIES.md)."""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_settings import app_base_url
from app.core.deps import get_current_user, get_db, require_write_access
from app.core.i18n import t
from app.core.models import CommunityRequest, Conversation, ConversationMember, User, UserInterest, utcnow
from app.core.schemas import CommunityCreateIn, CommunityUpdateIn, MemberRoleIn, ResolveIn
from app.communities.service import (
    ROLE_RANK, active, communities_out, community_member_filter, get_community, hand_over_ownership, in_zone,
    list_communities, pending_request, staff_ids, staff_of,
)
from app.conversations.service import get_membership, join, user_age_key, user_summary
from app.mail import notify_email
from app.messaging.service import recipients
from app.push.service import push_notice
from app.realtime import service as realtime

router = APIRouter(tags=["communities"])


async def _out(db: AsyncSession, user: User, conv: Conversation) -> dict:
    return (await communities_out(db, user, [conv], detail=True))[0]


async def _changed(db: AsyncSession, conv_id: int, extra: list[int] | None = None) -> None:
    realtime.invalidate_members(conv_id)
    to = set(await recipients(db, conv_id)) | set(extra or [])
    await realtime.publish(to, {"type": "conversation.changed", "conversation_id": conv_id})


def _require_staff(member: ConversationMember | None, user: User) -> None:
    if not staff_of(member, user):
        raise HTTPException(403, t("err_forbidden"))


async def _join_member(db: AsyncSession, conv: Conversation, user: User) -> None:
    """Join (or come back to) a community; an interest community also becomes one of my interests."""
    await join(db, conv, user.id)
    if conv.interest_id and not await db.get(UserInterest, (user.id, conv.interest_id)):
        db.add(UserInterest(user_id=user.id, interest_id=conv.interest_id))


@router.get("/communities", response_model=list[dict])
async def communities(q: str = "", mine: int = 0, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await list_communities(db, user, q, bool(mine))


@router.post("/communities", response_model=dict)
async def create_community(payload: CommunityCreateIn, db: AsyncSession = Depends(get_db),
                           user: User = Depends(require_write_access)):
    conv = Conversation(kind="channel", title=payload.title.strip(), description=payload.description,
                        avatar_url=payload.avatar_url or None, province=user.province, age_range=user_age_key(user),
                        created_by_id=user.id, created_at=utcnow(), slow_mode_seconds=0, rules_markdown="",
                        policy_json={}, invite_code=secrets.token_urlsafe(9), access_mode=payload.access_mode,
                        board_mode=payload.board_mode)
    db.add(conv)
    await db.flush()
    await join(db, conv, user.id, role="owner")
    await db.commit()
    await realtime.publish([user.id], {"type": "conversation.changed", "conversation_id": conv.id})
    return await _out(db, user, conv)


@router.post("/communities/join/{code}", response_model=dict)
async def join_by_code(code: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    conv = (await db.execute(select(Conversation).where(
        Conversation.invite_code == code, Conversation.kind == "channel"))).scalar_one_or_none()
    if not conv:
        raise HTTPException(404, t("err_invite_invalid"))
    member = await get_membership(db, conv.id, user.id)
    if member and member.banned:
        raise HTTPException(403, t("err_banned_here"))
    if not in_zone(user, conv):
        raise HTTPException(403, t("err_community_other_zone"))
    if not active(member):
        await _join_member(db, conv, user)
        req = await pending_request(db, conv.id, user.id)
        if req:
            req.status, req.resolved_at = "accepted", utcnow()
        await db.commit()
        await _changed(db, conv.id, extra=[user.id])
    return {"status": "joined", "community_id": conv.id}


@router.get("/communities/{community_id}", response_model=dict)
async def get_one(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, _ = await get_community(db, community_id, user)
    return await _out(db, user, conv)


@router.patch("/communities/{community_id}", response_model=dict)
async def update_community(community_id: int, payload: CommunityUpdateIn, db: AsyncSession = Depends(get_db),
                           user: User = Depends(require_write_access)):
    conv, member = await get_community(db, community_id, user)
    if not (user.role == "admin" or (active(member) and member.role in ("owner", "admin"))):
        raise HTTPException(403, t("err_forbidden"))
    if payload.title is not None and not conv.interest_id:  # interest communities are named after the interest
        conv.title = payload.title.strip()
    if payload.description is not None:
        conv.description = payload.description
    if payload.avatar_url is not None:
        conv.avatar_url = payload.avatar_url or None
    if payload.access_mode is not None:
        conv.access_mode = payload.access_mode
    if payload.board_mode is not None:
        conv.board_mode = payload.board_mode
    if payload.rules is not None:
        conv.rules_markdown = payload.rules
    await db.commit()
    await _changed(db, conv.id)
    return await _out(db, user, conv)


@router.post("/communities/{community_id}/join", response_model=dict)
async def join_community(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    conv = await db.get(Conversation, community_id)
    member = await get_membership(db, community_id, user.id) if conv else None
    if not conv or conv.kind != "channel":
        raise HTTPException(404, t("err_community_not_found"))
    if member and member.banned:
        raise HTTPException(403, t("err_banned_here"))
    if active(member):
        return {"status": "joined"}
    if not in_zone(user, conv):
        raise HTTPException(403, t("err_community_other_zone"))
    if member is None and conv.access_mode == "invite":
        raise HTTPException(403, t("err_community_invite_only"))
    if member is None and conv.access_mode == "request":
        if await pending_request(db, conv.id, user.id):
            return {"status": "requested"}
        db.add(CommunityRequest(conversation_id=conv.id, user_id=user.id, status="pending"))
        await db.commit()
        staff = await staff_ids(db, conv.id)
        await realtime.publish(staff, {"type": "community.request", "community_id": conv.id, "user_id": user.id})
        title = conv.title or ""
        if conv.interest_id:
            title = (await communities_out(db, user, [conv]))[0]["title"]
        params = {"name": user.display_name, "community": title}
        path = f"/app/communities/{conv.id}?tab=members"
        staff_users = list((await db.execute(select(User).where(User.id.in_(staff)))).scalars().all()) if staff else []
        push_notice(staff_users, "community.request", "email_community_request", params, path)
        for u in staff_users:
            await notify_email.notify(db, u, "requests", "email_community_request", params, path)
        return {"status": "requested"}
    # Open community, or an away membership (it comes back without asking again).
    await _join_member(db, conv, user)
    await db.commit()
    await _changed(db, conv.id, extra=[user.id])
    return {"status": "joined"}


@router.post("/communities/{community_id}/invite", response_model=dict)
async def new_invite(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    conv.invite_code = secrets.token_urlsafe(9)
    await db.commit()
    return {"code": conv.invite_code, "url": f"{await app_base_url(db)}/app/join/{conv.invite_code}"}


@router.delete("/communities/{community_id}/membership", response_model=dict)
async def leave(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, member = await get_community(db, community_id, user)
    if not member or member.away:
        raise HTTPException(404, t("err_conversation_not_found"))
    if member.banned:
        return {"ok": True}  # the ban stays
    if member.role == "owner":
        await hand_over_ownership(db, conv, user.id)
    await db.delete(member)
    if conv.interest_id:
        await db.execute(delete(UserInterest).where(UserInterest.user_id == user.id, UserInterest.interest_id == conv.interest_id))
    await db.commit()
    await _changed(db, conv.id, extra=[user.id])
    await realtime.publish([user.id], {"type": "membership.removed", "conversation_id": conv.id})
    return {"ok": True}


@router.get("/communities/{community_id}/requests", response_model=list[dict])
async def list_requests(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    res = await db.execute(select(CommunityRequest, User).join(User, User.id == CommunityRequest.user_id).where(
        CommunityRequest.conversation_id == conv.id, CommunityRequest.status == "pending").order_by(CommunityRequest.id))
    return [{"user": user_summary(u), "created_at": r.created_at.isoformat().replace("+00:00", "Z")} for r, u in res.all()]


@router.post("/communities/{community_id}/requests/{user_id}/resolve", response_model=dict)
async def resolve_request(community_id: int, user_id: int, payload: ResolveIn, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    req = await pending_request(db, conv.id, user_id)
    if not req:
        raise HTTPException(404, t("err_request_not_found"))
    req.status = "accepted" if payload.accept else "rejected"
    req.resolved_at, req.resolved_by = utcnow(), user.id
    requester = await db.get(User, user_id)
    if payload.accept and requester:
        existing = await get_membership(db, conv.id, user_id)
        if not (existing and existing.banned):
            await _join_member(db, conv, requester)
            if not in_zone(requester, conv):  # moved away while waiting
                (await get_membership(db, conv.id, user_id)).away = True
    await db.commit()
    await realtime.publish(await staff_ids(db, conv.id), {"type": "community.request", "community_id": conv.id, "user_id": user_id})
    if payload.accept and requester:
        await _changed(db, conv.id, extra=[user_id])
        await realtime.publish([user_id], {"type": "community.joined", "community_id": conv.id})
        params = {"community": (await communities_out(db, requester, [conv]))[0]["title"]}
        path = f"/app/communities/{conv.id}"
        push_notice([requester], "community.joined", "email_community_accepted", params, path)
        await notify_email.notify(db, requester, "requests", "email_community_accepted", params, path)
    return {"ok": True}


@router.get("/communities/{community_id}/members", response_model=list[dict])
async def members(community_id: int, q: str = "", limit: int = 200, db: AsyncSession = Depends(get_db),
                  user: User = Depends(get_current_user)):
    conv, _ = await get_community(db, community_id, user)
    query = select(ConversationMember, User).join(User, User.id == ConversationMember.user_id).where(
        community_member_filter(conv.id))
    if q.strip():
        query = query.where(User.display_name.ilike(f"%{q.strip()}%"))
    rows = (await db.execute(query.limit(max(1, min(limit, 500))))).all()
    online = await realtime.online_ids([u.id for _, u in rows])
    out = [{**user_summary(u), "role": m.role, "online": u.id in online} for m, u in rows]
    out.sort(key=lambda x: (ROLE_RANK.get(x["role"], 9), not x["online"], x["display_name"].lower()))
    return out


@router.put("/communities/{community_id}/members/{user_id}/role", response_model=dict)
async def set_role(community_id: int, user_id: int, payload: MemberRoleIn, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Owner and admins name moderators; only the owner names (or demotes) admins."""
    conv, member = await get_community(db, community_id, user)
    is_owner = user.role == "admin" or (active(member) and member.role == "owner")
    if not (is_owner or (active(member) and member.role == "admin")):
        raise HTTPException(403, t("err_forbidden"))
    target = await get_membership(db, conv.id, user_id)
    if not active(target) or target.role == "owner":
        raise HTTPException(404, t("err_user_not_found"))
    if (payload.role == "admin" or target.role == "admin") and not is_owner:
        raise HTTPException(403, t("err_forbidden"))
    target.role = payload.role
    await db.commit()
    await _changed(db, conv.id)
    return {"ok": True}


@router.delete("/communities/{community_id}/members/{user_id}", response_model=dict)
async def remove_member(community_id: int, user_id: int, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    target = await get_membership(db, conv.id, user_id)
    if not target or target.away:
        raise HTTPException(404, t("err_user_not_found"))
    if target.role == "owner" or (user.role != "admin" and ROLE_RANK[member.role] >= ROLE_RANK.get(target.role, 9)):
        raise HTTPException(403, t("err_forbidden"))
    await db.delete(target)
    await db.commit()
    await _changed(db, conv.id, extra=[user_id])
    await realtime.publish([user_id], {"type": "membership.removed", "conversation_id": conv.id})
    return {"ok": True}
