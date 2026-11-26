"""Communities API (see docs/COMMUNITIES.md)."""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.app_settings import app_base_url
from app.core.deps import get_current_user, get_db, require_write_access
from app.core.i18n import t
from app.core.models import (
    CommunityInvite, CommunityRequest, Conversation, ConversationMember, Friendship, User, UserBlock, UserInterest, utcnow)
from app.core.schemas import (
    BanIn, CommunityCreateIn, CommunityFiltersIn, CommunityInviteIn, CommunityUpdateIn, JoinIn, MemberRoleIn, ResolveIn)
from app.communities.service import (
    ROLE_RANK, active, admin_of, ban as ban_member, banned_now, bot_ids, communities_out, community_member_filter, get_community,
    NEW_COMMUNITY_RETENTION, RETENTION_CHOICES, clean_interest_tags, clean_questions, suggested_communities, hand_over_ownership, in_zone, join_questions, lift_ban, list_communities, pending_request, rank_of,
    staff_ids, staff_of, valid_zone,
)
from app.conversations.service import fits_age
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


def _require_admin(member: ConversationMember | None, user: User) -> None:
    if not admin_of(member, user):
        raise HTTPException(403, t("err_forbidden"))


async def _target(db: AsyncSession, conv: Conversation, member: ConversationMember | None, user: User,
                  user_id: int, *, include_banned: bool = False) -> ConversationMember:
    """Someone I can moderate: below me, not a bot, not the owner."""
    target = await get_membership(db, conv.id, user_id)
    if not target or target.away or (target.banned and not include_banned):
        raise HTTPException(404, t("err_user_not_found"))
    if user_id in (await bot_ids(db)).values() or user_id == user.id:
        raise HTTPException(403, t("err_forbidden"))
    if target.role == "owner" or (user.role != "admin" and rank_of(member, user) >= ROLE_RANK.get(target.role, 9)):
        raise HTTPException(403, t("err_forbidden"))
    return target


async def _join_member(db: AsyncSession, conv: Conversation, user: User) -> None:
    """Join (or come back to) a community; an interest community also becomes one of my interests."""
    await join(db, conv, user.id)
    if conv.interest_id and not await db.get(UserInterest, (user.id, conv.interest_id)):
        db.add(UserInterest(user_id=user.id, interest_id=conv.interest_id))


@router.get("/communities", response_model=list[dict])
async def communities(q: str = "", mine: int = 0, province: str | None = None, age_range: str | None = None,
                      country: str | None = None, area: str | None = None,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """My zone's communities, or those of another zone to discover them: a province, a group of provinces of a country
    (area, e.g. an autonomous community) or a whole country, with an age range."""
    # another place can be looked at, but always with my own age range (worked out from my date of birth)
    if province or country or area or age_range:
        age_range = user_age_key(user)
    zone = await valid_zone(db, province, age_range, country, area)
    if (province or country or area) and not zone:
        raise HTTPException(400, t("err_invalid_zone"))
    return await list_communities(db, user, q, bool(mine), zone)


@router.get("/communities/suggested", response_model=list[dict])
async def suggested(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Up to 5 communities of my zone, that I am not in, fitting my interests best (with `matches`: which ones)."""
    return await suggested_communities(db, user)


@router.post("/communities", response_model=dict)
async def create_community(payload: CommunityCreateIn, db: AsyncSession = Depends(get_db),
                           user: User = Depends(require_write_access)):
    # An age span replaces the creator's fixed range; it must include the creator, worked out from the date of birth.
    if payload.min_age is not None and payload.max_age is not None and payload.min_age > payload.max_age:
        raise HTTPException(400, t("err_age_span"))
    if payload.retention_days is not None and payload.retention_days not in RETENTION_CHOICES:
        raise HTTPException(400, t("err_retention"))
    conv = Conversation(kind="channel", title=payload.title.strip(), description=payload.description,
                        avatar_url=payload.avatar_url or None, province=user.province, age_range=user_age_key(user),
                        created_by_id=user.id, created_at=utcnow(), slow_mode_seconds=0, rules_markdown="",
                        policy_json={"join_questions": clean_questions(payload.join_questions)} if payload.join_questions else {},
                        invite_code=secrets.token_urlsafe(9), access_mode=payload.access_mode,
                        board_mode=payload.board_mode, min_age=payload.min_age, max_age=payload.max_age,
                        retention_days=payload.retention_days or NEW_COMMUNITY_RETENTION,
                        interest_tags=await clean_interest_tags(db, payload.interest_tags))
    if not fits_age(user, conv):
        raise HTTPException(400, t("err_age_span_creator"))
    # its category, or a new one proposed to the administration (in "Other" meanwhile)
    from app.categories import service as cats
    if payload.category_proposal and payload.category_proposal.strip():
        conv.category_key = cats.OTHER
    else:  # the app asks for one; without it (other clients), "Other"
        conv.category_key = await cats.check_key(db, payload.category) if payload.category else cats.OTHER
    # its official language: the one chosen, or its zone's
    from app.communities.zones import default_language, geo_data
    from app.core.i18n import supported
    if payload.language and payload.language in supported():
        conv.language = payload.language
    else:
        conv.language = default_language(await geo_data(db), conv)
    db.add(conv)
    await db.flush()
    if payload.category_proposal and payload.category_proposal.strip():
        from app.core.models import CategoryProposal
        db.add(CategoryProposal(name=payload.category_proposal.strip(), user_id=user.id, conversation_id=conv.id, created_at=utcnow()))
    await join(db, conv, user.id, role="owner")
    await db.commit()
    if payload.category_proposal and payload.category_proposal.strip():
        await cats.tell_admins(db, payload.category_proposal.strip())
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
    if payload.join_questions is not None:
        conv.policy_json = {**(conv.policy_json or {}), "join_questions": clean_questions(payload.join_questions)}
    if payload.interest_tags is not None and not conv.interest_id:
        conv.interest_tags = await clean_interest_tags(db, payload.interest_tags)
    if not conv.interest_id and (payload.category or (payload.category_proposal or "").strip()):
        from app.categories import service as cats
        if (payload.category_proposal or "").strip():
            from app.core.models import CategoryProposal
            conv.category_key = cats.OTHER
            db.add(CategoryProposal(name=payload.category_proposal.strip(), user_id=user.id, conversation_id=conv.id, created_at=utcnow()))
        else:
            conv.category_key = await cats.check_key(db, payload.category)
    if payload.language is not None:  # "": back to its zone's
        from app.communities.zones import default_language, geo_data
        from app.core.i18n import supported
        if payload.language and payload.language not in supported():
            raise HTTPException(400, t("err_language_invalid"))
        conv.language = payload.language or default_language(await geo_data(db), conv)
    if payload.retention_days is not None:
        # interest communities always keep a year; people's communities choose among the fixed periods
        if conv.interest_id or payload.retention_days not in RETENTION_CHOICES:
            raise HTTPException(400, t("err_retention"))
        conv.retention_days = payload.retention_days
    await db.commit()
    await _changed(db, conv.id)
    if not conv.interest_id and (payload.category_proposal or "").strip():
        from app.categories import service as cats
        await cats.tell_admins(db, payload.category_proposal.strip())
    return await _out(db, user, conv)


@router.post("/communities/{community_id}/join", response_model=dict)
async def join_community(community_id: int, payload: JoinIn | None = None, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_write_access)):
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
        questions = join_questions(conv)
        answers = [a.strip()[:500] for a in (payload.answers if payload else [])][:len(questions)]
        if questions and (len(answers) < len(questions) or not all(answers)):
            raise HTTPException(400, t("err_join_answers"))
        db.add(CommunityRequest(conversation_id=conv.id, user_id=user.id, status="pending", answers=answers))
        await db.commit()
        staff = await staff_ids(db, conv.id)
        await realtime.publish(staff, {"type": "community.request", "community_id": conv.id, "user_id": user.id})
        title = conv.title or ""
        if conv.interest_id:
            title = (await communities_out(db, user, [conv]))[0]["title"]
        params = {"name": user.shown_name, "community": title}
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
    _require_admin(member, user)
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
    if banned_now(member):  # leaving does not end a ban
        raise HTTPException(409, t("err_banned_until", {"until": member.ban_until.strftime("%d/%m %H:%M")}))
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
    _require_admin(member, user)
    res = await db.execute(select(CommunityRequest, User).join(User, User.id == CommunityRequest.user_id).where(
        CommunityRequest.conversation_id == conv.id, CommunityRequest.status == "pending").order_by(CommunityRequest.id))
    questions = join_questions(conv)
    return [{"user": user_summary(u), "created_at": r.created_at.isoformat().replace("+00:00", "Z"),
             "answers": [{"question": q, "answer": a} for q, a in zip(questions, r.answers or [])]} for r, u in res.all()]


@router.post("/communities/{community_id}/requests/{user_id}/resolve", response_model=dict)
async def resolve_request(community_id: int, user_id: int, payload: ResolveIn, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    conv, member = await get_community(db, community_id, user)
    _require_admin(member, user)
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
        like = f"%{q.strip().lstrip('@')}%"
        query = query.where(or_(User.display_name.ilike(like), func.concat_ws(" ", User.first_name, User.last_name).ilike(like)))
    rows = (await db.execute(query.limit(max(1, min(limit, 500))))).all()
    online = await realtime.online_ids([u.id for _, u in rows])
    out = [{**user_summary(u), "role": m.role, "online": u.id in online, "bot": bool(u.bot_role),
            "ban_until": m.ban_until.isoformat().replace("+00:00", "Z") if banned_now(m) else None,
            "strikes": m.strikes or 0} for m, u in rows]
    out.sort(key=lambda x: (not x["bot"], ROLE_RANK.get(x["role"], 9), not x["online"], x["display_name"].lower()))
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
    if not active(target) or target.role == "owner" or user_id in (await bot_ids(db)).values():
        raise HTTPException(404, t("err_user_not_found"))
    if (payload.role == "admin" or target.role == "admin") and not is_owner:
        raise HTTPException(403, t("err_forbidden"))
    target.role = payload.role
    await db.commit()
    await _changed(db, conv.id)
    return {"ok": True}


@router.delete("/communities/{community_id}/members/{user_id}", response_model=dict)
async def remove_member(community_id: int, user_id: int, ban: bool = False, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    """Remove someone (they may join again), or with ?ban=1 expel them: they cannot join again."""
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    target = await _target(db, conv, member, user, user_id)
    if ban:
        ban_member(target, None)  # kept (so they cannot join again) but out of their lists
    else:
        await db.delete(target)
    await db.commit()
    await _changed(db, conv.id, extra=[user_id])
    await realtime.publish([user_id], {"type": "membership.removed", "conversation_id": conv.id})
    return {"ok": True}


@router.post("/communities/{community_id}/members/{user_id}/ban", response_model=dict)
async def ban_user(community_id: int, user_id: int, payload: BanIn, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """Moderators and admins ban for some hours (reads, cannot write) or, without hours, for good."""
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    target = await _target(db, conv, member, user, user_id)
    ban_member(target, payload.hours)
    await db.commit()
    await _changed(db, conv.id, extra=[user_id])
    if not payload.hours:
        await realtime.publish([user_id], {"type": "membership.removed", "conversation_id": conv.id})
    return {"ok": True}


@router.post("/communities/{community_id}/members/{user_id}/unban", response_model=dict)
async def unban_user(community_id: int, user_id: int, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """Only admins (and the owner) lift a ban, also one the moderation bot put."""
    conv, member = await get_community(db, community_id, user)
    _require_admin(member, user)
    target = await _target(db, conv, member, user, user_id, include_banned=True)
    lift_ban(target)
    await db.commit()
    await _changed(db, conv.id, extra=[user_id])
    return {"ok": True}


@router.get("/communities/{community_id}/bans", response_model=list[dict])
async def list_bans(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """People banned for a while or for good (staff)."""
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    rows = (await db.execute(select(ConversationMember, User).join(User, User.id == ConversationMember.user_id).where(
        ConversationMember.conversation_id == conv.id,
        (ConversationMember.banned.is_(True)) | (ConversationMember.ban_until > utcnow())))).all()
    return [{"user": user_summary(u), "forever": m.banned,
             "until": None if m.banned or not m.ban_until else m.ban_until.isoformat().replace("+00:00", "Z"),
             "strikes": m.strikes or 0} for m, u in rows]


@router.post("/communities/{community_id}/clear-chat", response_model=dict)
async def clear_chat(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Owner and admins empty the community's chat: every message goes (with its reactions, attachments and reports),
    and a note says who did it."""
    from app.board.service import _system
    from app.core.models import Message
    conv, member = await get_community(db, community_id, user)
    _require_admin(member, user)
    await db.execute(delete(Message).where(Message.conversation_id == conv.id))
    conv.pinned_message_id = None
    conv.last_message_id = None
    await _system(db, conv, t("sys_chat_cleared", {"name": user.shown_name}))
    await db.execute(update(ConversationMember).where(ConversationMember.conversation_id == conv.id).values(
        last_read_message_id=conv.last_message_id, email_notified_message_id=conv.last_message_id))
    await db.commit()
    await realtime.publish(await recipients(db, conv.id), {"type": "conversation.cleared", "conversation_id": conv.id})
    await _changed(db, conv.id)
    return {"ok": True}


@router.get("/communities/{community_id}/stats", response_model=dict)
async def community_stats(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """For the community's staff: members and how they grow, activity, plans, real attendance and ratings."""
    from datetime import timedelta
    from sqlalchemy import func
    from app.core.models import BoardAttendee, BoardPost, Message
    conv, member = await get_community(db, community_id, user)
    _require_staff(member, user)
    now = utcnow()
    bots = set((await bot_ids(db)).values()) or {0}
    people = (ConversationMember.conversation_id == conv.id, ConversationMember.away.is_(False),
                            ConversationMember.banned.is_(False), ConversationMember.user_id.not_in(bots))

    async def n(stmt) -> int:
        return int((await db.execute(stmt)).scalar() or 0)

    week = func.date_trunc("week", ConversationMember.joined_at)
    joined = dict((await db.execute(select(week, func.count()).where(*people, ConversationMember.joined_at >= now - timedelta(weeks=12))
                                    .group_by(week))).all())
    weeks = []
    for i in range(11, -1, -1):
        start = (now - timedelta(weeks=i)).date()
        start = start - timedelta(days=start.weekday())
        weeks.append({"week": start.isoformat(), "count": int(next((v for k, v in joined.items() if k.date() == start), 0))})
    plans = select(BoardPost.id).where(BoardPost.conversation_id == conv.id, BoardPost.deleted_at.is_(None),
                                       BoardPost.kind.in_(("meetup", "event")))
    past = plans.where(func.coalesce(BoardPost.ends_at, BoardPost.starts_at) < now, BoardPost.starts_at >= now - timedelta(days=90))
    marked = await n(select(func.count()).select_from(BoardAttendee).where(BoardAttendee.post_id.in_(past), BoardAttendee.attended.is_not(None)))
    came = await n(select(func.count()).select_from(BoardAttendee).where(BoardAttendee.post_id.in_(past), BoardAttendee.attended.is_(True)))
    rating = (await db.execute(select(func.avg(BoardAttendee.rating), func.count(BoardAttendee.rating)).where(
        BoardAttendee.post_id.in_(past), BoardAttendee.rating.is_not(None)))).one()
    organisers = [{"user": user_summary(u), "plans": int(c)} for u, c in (await db.execute(
        select(User, func.count()).join(BoardPost, BoardPost.author_id == User.id).where(BoardPost.id.in_(past)).group_by(User.id)
        .order_by(func.count().desc()).limit(5))).all()]
    return {
        "members": await n(select(func.count()).select_from(ConversationMember).where(*people)),
        "new_30d": await n(select(func.count()).select_from(ConversationMember).where(*people, ConversationMember.joined_at >= now - timedelta(days=30))),
        "joined_by_week": weeks,
        "messages_30d": await n(select(func.count()).select_from(Message).where(
            Message.conversation_id == conv.id, Message.kind == "text", Message.created_at >= now - timedelta(days=30))),
        "active_30d": await n(select(func.count(func.distinct(Message.sender_id))).where(
            Message.conversation_id == conv.id, Message.kind == "text", Message.created_at >= now - timedelta(days=30),
            Message.sender_id.not_in(bots))),
        "plans_upcoming": await n(select(func.count()).select_from(BoardPost).where(
            BoardPost.id.in_(plans), func.coalesce(BoardPost.ends_at, BoardPost.starts_at) >= now)),
        "plans_90d": await n(select(func.count()).select_from(BoardPost).where(BoardPost.id.in_(past))),
        "attendance": {"marked": marked, "came": came, "rate": round(came / marked, 2) if marked else None},
        "rating": {"average": round(float(rating[0]), 1) if rating[0] is not None else None, "count": int(rating[1] or 0)},
        "top_organisers": organisers,
    }


# ---------- inviting people registered in MeetGo (besides the link) ----------

async def _blocked_between(db: AsyncSession, me_id: int) -> set[int]:
    rows = (await db.execute(select(UserBlock.blocker_id, UserBlock.blocked_id).where(
        or_(UserBlock.blocker_id == me_id, UserBlock.blocked_id == me_id)))).all()
    return {b if a == me_id else a for a, b in rows}


@router.get("/communities/{community_id}/invite-candidates", response_model=list[dict])
async def invite_candidates(community_id: int, q: str = "", db: AsyncSession = Depends(get_db),
                            user: User = Depends(get_current_user)):
    """Whom I can invite, by alias or name: my friends and the people of the community's zone whose age fits (only
    they can join), not members yet. Friends first."""
    conv, member = await get_community(db, community_id, user)
    _require_admin(member, user)
    q = q.strip().lstrip("@")
    friend_ids = set((await db.execute(select(Friendship.friend_id).where(Friendship.user_id == user.id))).scalars().all())
    query = select(User).where(User.id != user.id, User.bot_role.is_(None), User.is_banned.is_(False),
                               or_(User.id.in_(friend_ids or {0}), User.province == conv.province))
    if q:
        like = f"%{q}%"
        query = query.where(or_(User.display_name.ilike(like), func.concat_ws(" ", User.first_name, User.last_name).ilike(like)))
    people = list((await db.execute(query.order_by(User.display_name).limit(200))).scalars().all())
    members = {m.user_id: m for m in (await db.execute(select(ConversationMember).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.user_id.in_([u.id for u in people] or [0])))).scalars().all()}
    invited = set((await db.execute(select(CommunityInvite.user_id).where(
        CommunityInvite.conversation_id == conv.id, CommunityInvite.status == "pending"))).scalars().all())
    blocked = await _blocked_between(db, user.id)
    out = []
    for u in people:
        m = members.get(u.id)
        if u.id in blocked or active(m) or (m and m.banned) or not in_zone(u, conv):
            continue
        out.append({**user_summary(u), "friend": u.id in friend_ids, "invited": u.id in invited})
    out.sort(key=lambda x: (not x["friend"], x["display_name"].lower()))
    return out[:20]


@router.post("/communities/{community_id}/invites", response_model=dict)
async def invite_people(community_id: int, payload: CommunityInviteIn, db: AsyncSession = Depends(get_db),
                        user: User = Depends(require_write_access)):
    """Invite people: each gets the invitation in their requests (and a notice), to accept or decline."""
    conv, member = await get_community(db, community_id, user)
    _require_admin(member, user)
    blocked = await _blocked_between(db, user.id)
    title = (await communities_out(db, user, [conv]))[0]["title"]
    sent: list[User] = []
    for uid in dict.fromkeys(payload.user_ids):
        target = await db.get(User, uid)
        if not target or target.bot_role or target.is_banned or uid == user.id or uid in blocked:
            continue
        m = await get_membership(db, conv.id, uid)
        if active(m) or (m and m.banned) or not in_zone(target, conv):
            continue
        if (await db.execute(select(CommunityInvite.id).where(CommunityInvite.conversation_id == conv.id,
                CommunityInvite.user_id == uid, CommunityInvite.status == "pending"))).first():
            continue
        db.add(CommunityInvite(conversation_id=conv.id, user_id=uid, invited_by=user.id))
        sent.append(target)
    await db.commit()
    if sent:
        params = {"name": user.shown_name, "community": title}
        path = "/app/people?tab=requests"
        push_notice(sent, "community.invite", "email_community_invite", params, path)
        for u in sent:
            await notify_email.notify(db, u, "requests", "email_community_invite", params, path)
        await realtime.publish([u.id for u in sent], {"type": "requests.changed"})
    return {"invited": len(sent)}


@router.get("/community-invites", response_model=list[dict])
async def my_invites(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """The invitations to communities waiting for my answer."""
    rows = (await db.execute(select(CommunityInvite, Conversation).join(Conversation, Conversation.id == CommunityInvite.conversation_id).where(
        CommunityInvite.user_id == user.id, CommunityInvite.status == "pending").order_by(CommunityInvite.created_at.desc()))).all()
    if not rows:
        return []
    communities = {c["id"]: c for c in await communities_out(db, user, [c for _, c in rows])}
    by = {u.id: u for u in (await db.execute(select(User).where(User.id.in_([i.invited_by for i, _ in rows if i.invited_by])))).scalars().all()}
    return [{"id": i.id, "community": communities.get(c.id), "from_user": user_summary(by.get(i.invited_by)),
             "created_at": i.created_at.isoformat()} for i, c in rows]


@router.post("/community-invites/{invite_id}/resolve", response_model=dict)
async def resolve_invite(invite_id: int, payload: ResolveIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_write_access)):
    inv = await db.get(CommunityInvite, invite_id)
    if not inv or inv.user_id != user.id or inv.status != "pending":
        raise HTTPException(404, t("err_invite_invalid"))
    conv = await db.get(Conversation, inv.conversation_id)
    if not payload.accept or not conv:
        inv.status, inv.resolved_at = "declined", utcnow()
        await db.commit()
        return {"status": "declined"}
    member = await get_membership(db, conv.id, user.id)
    if member and member.banned:
        raise HTTPException(403, t("err_banned_here"))
    if not in_zone(user, conv):
        raise HTTPException(403, t("err_community_other_zone"))
    inv.status, inv.resolved_at = "accepted", utcnow()
    if not active(member):
        await _join_member(db, conv, user)
        req = await pending_request(db, conv.id, user.id)
        if req:
            req.status, req.resolved_at = "accepted", utcnow()
    await db.commit()
    await _changed(db, conv.id, extra=[user.id])
    return {"status": "joined", "community_id": conv.id}


# ---------- the creator changes who the community admits (scope and ages) ----------

async def _scope_options(db: AsyncSession, province: str, country: str | None) -> dict[str, dict]:
    """The scopes a community can have around a province: the province, its group (an autonomous community...) and the
    country, each with its name and the provinces it covers."""
    from app.core.app_settings import get_settings_row
    data = (await get_settings_row(db)).data or {}
    country = country or "ES"
    provinces = (data.get("provinces_by_country") or {}).get(country, [])
    name_of = {p.get("value"): p.get("name") or p.get("value") for p in provinces}
    out = {"province": {"kind": "province", "value": province, "label": name_of.get(province, province), "provinces": [province]}}
    group = next((g for g in (data.get("region_groups") or {}).get(country, []) if province in (g.get("regions") or [])), None)
    if group:
        out["region"] = {"kind": "region", "value": group.get("value"), "label": group.get("name") or group.get("value"),
                         "provinces": list(group.get("regions") or [])}
    cname = next((c.get("name") for c in data.get("countries") or [] if c.get("code") == country), country)
    if provinces:
        out["country"] = {"kind": "country", "value": country, "label": cname, "provinces": list(name_of)}
    return out


async def _creator(db: AsyncSession, community_id: int, user: User):
    conv, member = await get_community(db, community_id, user)
    if conv.interest_id:  # interest communities follow the interest's settings (Administration)
        raise HTTPException(400, t("err_filters_interest"))
    if not (active(member) and member.role == "owner"):
        raise HTTPException(403, t("err_filters_owner_only"))
    return conv, member


@router.get("/communities/{community_id}/filters", response_model=dict)
async def get_filters(community_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    conv, _ = await _creator(db, community_id, user)
    options = await _scope_options(db, user.province, user.country)
    return {"scope_kind": conv.scope_kind or "province", "age_limit": conv.min_age is not None or conv.max_age is not None,
            "min_age": conv.min_age, "max_age": conv.max_age, "age_range": conv.age_range,
            "options": [{k: v for k, v in o.items() if k != "provinces"} for o in options.values()]}


@router.post("/communities/{community_id}/filters", response_model=dict)
async def set_filters(community_id: int, payload: CommunityFiltersIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_write_access)):
    """Change the scope and ages. Whoever no longer fits is expelled: they keep the chat read only up to now, get
    nothing new and are told why. With dry_run, only who would be expelled."""
    from types import SimpleNamespace
    conv, _ = await _creator(db, community_id, user)
    options = await _scope_options(db, user.province, user.country)
    scope = options.get(payload.scope_kind)
    if not scope:
        raise HTTPException(400, t("err_filters_scope"))
    min_age, max_age = (payload.min_age or 18, payload.max_age) if payload.age_limit else (None, None)
    if min_age is not None and max_age is not None and min_age > max_age:
        raise HTTPException(400, t("err_age_span"))
    wide = payload.scope_kind != "province"
    new = SimpleNamespace(province=conv.province, age_range=conv.age_range, min_age=min_age, max_age=max_age,
                          scope_provinces=scope["provinces"] if wide else None)
    if not in_zone(user, new):
        raise HTTPException(400, t("err_filters_exclude_owner"))
    rows = (await db.execute(select(ConversationMember, User).join(User, User.id == ConversationMember.user_id).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.banned.is_(False), User.bot_role.is_(None)))).all()
    leaving = [(m, u) for m, u in rows if not m.away and not in_zone(u, new)]
    if payload.dry_run:
        return {"expelled": len(leaving), "names": [u.shown_name for _, u in leaving][:20]}
    conv.min_age, conv.max_age = min_age, max_age
    conv.scope_kind, conv.scope_value = (payload.scope_kind, scope["value"]) if wide else (None, None)
    conv.scope_label, conv.scope_provinces = (scope["label"], scope["provinces"]) if wide else (None, None)
    for m, u in rows:  # away because of a zone change, and fitting now: back (not those expelled by the filters)
        if m.away and m.expelled_message_id is None and in_zone(u, conv):
            m.away = False
    for m, _ in leaving:
        m.away, m.expelled_message_id = True, conv.last_message_id or 0
    await db.commit()
    if leaving:
        title = (await communities_out(db, user, [conv]))[0]["title"]
        people = [u for _, u in leaving]
        params = {"community": title}
        path = f"/app/c/{conv.id}"
        push_notice(people, "community.expelled", "email_community_filter_expelled", params, path)
        for u in people:
            await notify_email.notify(db, u, None, "email_community_filter_expelled", params, path)
        await realtime.publish([u.id for u in people], {"type": "conversation.changed", "conversation_id": conv.id})
    await _changed(db, conv.id)
    return {**await _out(db, user, conv), "expelled": len(leaving)}
