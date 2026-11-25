"""Board API: posts, attendance, comments, reports and my plans (see docs/COMMUNITIES.md)."""

import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.board import service as board
from app.board.service import PLAN_KINDS, as_utc, can_manage, get_post, is_plan, posts_out
from app.communities import automod
from app.messaging.service import _background
from app.communities.service import active, get_community, staff_of
from app.core.deps import get_current_user, get_db, require_write_access
from app.core.i18n import t
from app.core.app_settings import app_base_url
from app.core.models import BoardAttendee, BoardComment, BoardPost, BoardSeries, Conversation, Report, User, utcnow
from app.core.schemas import (
    AttendIn, BoardPostIn, BoardPostUpdateIn, CheckinIn, CohostsIn, CommentIn, RatingIn, ReportIn, ResolveIn,
)
from app.conversations.service import get_membership
from app.conversations.service import user_summary
from app.mail.notify_email import notify_admins_report
from app.messaging.service import recipients
from app.realtime import service as realtime

router = APIRouter(tags=["board"])


async def _publish(db: AsyncSession, conv_id: int, event: dict, extra: list[int] | None = None) -> None:
    to = set(await recipients(db, conv_id)) | set(extra or [])
    await realtime.publish(to, event)


async def _post_out(db: AsyncSession, user: User, post: BoardPost) -> dict:
    return (await posts_out(db, user, [post]))[0]


def _check_dates(starts_at, ends_at) -> None:
    if starts_at and ends_at and ends_at < starts_at:
        raise HTTPException(400, t("err_post_dates"))


async def _apply_to_following(db: AsyncSession, post: BoardPost, data: dict, old_start) -> list[BoardPost]:
    """A plan that repeats, edited for "this and the following dates": the same changes on the later dates (a new
    time moves them by the same amount) and on the dates still to be made."""
    series = await db.get(BoardSeries, post.series_id)
    others = list((await db.execute(select(BoardPost).where(
        BoardPost.series_id == post.series_id, BoardPost.id != post.id, BoardPost.deleted_at.is_(None),
        BoardPost.starts_at > old_start))).scalars().all())
    delta = (post.starts_at - old_start) if post.starts_at and old_start else timedelta(0)
    duration = (post.ends_at - post.starts_at) if post.ends_at and post.starts_at else None
    fields = ("title", "body", "place", "place_url", "capacity", "link_url", "cover_attachment_id", "comments_mode",
              "join_mode", "mode", "online_url", "max_guests")
    for other in others:
        for f in fields:
            if f in data:
                setattr(other, f, getattr(post, f))
        if delta:
            other.starts_at = other.starts_at + delta
        if "ends_at" in data or delta:
            other.ends_at = other.starts_at + duration if duration else None
        other.updated_at = utcnow()
        if "title" in data and other.chat_conversation_id:
            chat = await db.get(Conversation, other.chat_conversation_id)
            if chat:
                chat.title = other.title[:120]
    if series:
        series.template = board.series_template(post)
        if delta:
            series.first_starts_at = series.first_starts_at + delta
    return others


# ---------- feed ----------

@router.get("/board/feed", response_model=dict)
async def get_feed(kind: str | None = None, when: str = "all", community_id: int | None = None,
                   before_id: int | None = None, limit: int = 20, tz: str | None = None,
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if community_id:
        conv, _ = await get_community(db, community_id, user)
        return await board.feed(db, user, [conv.id], kind=kind, when=when, before_id=before_id, limit=limit,
                                community_view=True, tz=tz)
    return await board.feed(db, user, board.my_community_ids(user), kind=kind, when=when, before_id=before_id,
                            limit=limit, tz=tz)


@router.get("/communities/{community_id}/posts", response_model=dict)
async def community_posts(community_id: int, kind: str | None = None, when: str = "all", before_id: int | None = None,
                          limit: int = 20, tz: str | None = None, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    conv, _ = await get_community(db, community_id, user)
    return await board.feed(db, user, [conv.id], kind=kind, when=when, before_id=before_id, limit=limit,
                            community_view=True, tz=tz)


@router.get("/me/plans", response_model=list[dict])
async def plans(when: str = "upcoming", db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await board.my_plans(db, user, when)


# ---------- posts ----------

@router.post("/communities/{community_id}/posts", response_model=dict)
async def create_post(community_id: int, payload: BoardPostIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_write_access)):
    conv, member = await get_community(db, community_id, user)
    board.require_poster(conv, member, user)
    plan = payload.kind in PLAN_KINDS
    starts_at, ends_at = as_utc(payload.starts_at), as_utc(payload.ends_at)
    if plan and not starts_at:
        raise HTTPException(400, t("err_post_starts_at_required"))
    _check_dates(starts_at, ends_at)
    post = BoardPost(
        conversation_id=conv.id, author_id=user.id, kind=payload.kind, title=payload.title.strip(),
        body=(payload.body or "").strip(), link_url=payload.link_url or None,
        cover_attachment_id=await board.check_cover(db, payload.cover_attachment_id, user),
        comments_mode=payload.comments_mode or "all", created_at=utcnow(), updated_at=utcnow(),
    )
    if plan:
        post.starts_at, post.ends_at = starts_at, ends_at
        post.place, post.place_url = payload.place or None, payload.place_url or None
        post.capacity = payload.capacity
        post.join_mode = payload.join_mode or "open"
        post.mode = payload.mode or "in_person"
        post.online_url = (payload.online_url or None) if post.mode != "in_person" else None
        post.max_guests = payload.max_guests or 0
    elif payload.repeat:
        raise HTTPException(400, t("err_not_a_plan"))
    db.add(post)
    await db.flush()
    if plan:
        db.add(BoardAttendee(post_id=post.id, user_id=user.id, status="going", created_at=utcnow()))
        await board.create_plan_chat(db, post, user)
    if plan and payload.repeat:
        until = as_utc(payload.repeat_until)
        if until and until < starts_at:
            raise HTTPException(400, t("err_post_dates"))
        series = BoardSeries(conversation_id=conv.id, author_id=user.id, freq=payload.repeat, tz=str(board.zone(payload.tz)),
                             first_starts_at=starts_at, until=until or starts_at + timedelta(days=365),
                             template=board.series_template(post), created_at=utcnow())
        db.add(series)
        await db.flush()
        post.series_id = series.id
        await db.flush()
        await board.ensure_series(db, series, user)
    await db.commit()
    await _publish(db, conv.id, {"type": "post.created", "community_id": conv.id, "post_id": post.id})
    _background(automod.check_post(post.id))
    if post.chat_conversation_id:
        await realtime.publish([user.id], {"type": "conversation.changed", "conversation_id": post.chat_conversation_id})
    return await _post_out(db, user, post)


@router.get("/posts/{post_id}", response_model=dict)
async def get_one(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post, _, _ = await get_post(db, post_id, user)
    return await _post_out(db, user, post)


@router.patch("/posts/{post_id}", response_model=dict)
async def update_post(post_id: int, payload: BoardPostUpdateIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_write_access)):
    post, conv, member = await get_post(db, post_id, user, lock=True)
    staff = staff_of(member, user)
    if not can_manage(post, member, user):
        raise HTTPException(403, t("err_forbidden"))
    if payload.pinned is not None and not staff:
        raise HTTPException(403, t("err_forbidden"))
    data = payload.model_dump(exclude_unset=True)
    before = (post.starts_at, post.place)
    if "title" in data and payload.title:
        post.title = payload.title.strip()
        if post.chat_conversation_id:
            chat = await db.get(Conversation, post.chat_conversation_id)
            if chat:
                chat.title = post.title[:120]
    if "body" in data:
        post.body = (payload.body or "").strip()
    if "link_url" in data:
        post.link_url = payload.link_url or None
    if "cover_attachment_id" in data:
        post.cover_attachment_id = await board.check_cover(db, payload.cover_attachment_id, user)
    if payload.comments_mode:
        post.comments_mode = payload.comments_mode
    if payload.pinned is not None:
        post.pinned = payload.pinned
    if payload.closed is not None:
        post.closed = payload.closed
    promoted: list[User] = []
    if is_plan(post):
        if "starts_at" in data:
            if not payload.starts_at:
                raise HTTPException(400, t("err_post_starts_at_required"))
            post.starts_at = as_utc(payload.starts_at)
        if "ends_at" in data:
            post.ends_at = as_utc(payload.ends_at)
        _check_dates(post.starts_at, post.ends_at)
        if "place" in data:
            post.place = payload.place or None
        if "place_url" in data:
            post.place_url = payload.place_url or None
        if payload.join_mode:
            post.join_mode = payload.join_mode
        if payload.mode:
            post.mode = payload.mode
        if "online_url" in data:
            post.online_url = payload.online_url or None
        if post.mode == "in_person":
            post.online_url = None
        if payload.max_guests is not None:
            post.max_guests = payload.max_guests
        if "capacity" in data:
            post.capacity = payload.capacity or None
            await db.flush()
            promoted = await board.promote(db, post)
    post.updated_at = utcnow()
    also: list[BoardPost] = []
    if payload.scope == "following" and post.series_id:
        also = await _apply_to_following(db, post, data, before[0])
    await db.commit()
    await _publish(db, conv.id, {"type": "post.updated", "community_id": conv.id, "post_id": post.id})
    for other in also:
        await _publish(db, conv.id, {"type": "post.updated", "community_id": conv.id, "post_id": other.id})
        if post.starts_at != before[0] or post.place != before[1]:
            await board.tell(db, await board.attendee_users(db, other, exclude=user.id), other, "email_plan_changed")
    if is_plan(post) and (post.starts_at, post.place) != before:
        await board.tell(db, await board.attendee_users(db, post, exclude=user.id), post, "email_plan_changed")
    if promoted:
        await _publish(db, conv.id, {"type": "attendance.changed", "community_id": conv.id, "post_id": post.id},
                       [u.id for u in promoted])
        await board.tell(db, promoted, post, "email_plan_promoted")
    return await _post_out(db, user, post)


@router.delete("/posts/{post_id}", response_model=dict)
async def delete_post(post_id: int, scope: str = "one", db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post, conv, member = await get_post(db, post_id, user, lock=True)
    if not can_manage(post, member, user):
        raise HTTPException(403, t("err_forbidden"))
    told = await board.attendee_users(db, post, ("going", "waitlist", "pending"), exclude=user.id) if is_plan(post) else []
    await board.delete_post_data(db, post)
    if scope == "following" and post.series_id:
        # this date and the next ones; the series stops here
        series = await db.get(BoardSeries, post.series_id)
        for other in (await db.execute(select(BoardPost).where(
                BoardPost.series_id == post.series_id, BoardPost.id != post.id, BoardPost.deleted_at.is_(None),
                BoardPost.starts_at > post.starts_at))).scalars().all():
            told += [u for u in await board.attendee_users(db, other, ("going", "waitlist", "pending"), exclude=user.id) if u not in told]
            await board.delete_post_data(db, other)
        if series:
            series.ended, series.until = True, post.starts_at
    await db.commit()
    await _publish(db, conv.id, {"type": "post.deleted", "community_id": conv.id, "post_id": post.id},
                   [u.id for u in told])
    if post.chat_conversation_id:
        await _publish(db, post.chat_conversation_id, {"type": "conversation.changed", "conversation_id": post.chat_conversation_id})
    await board.tell(db, told, post, "email_plan_cancelled")
    return {"ok": True}


# ---------- attendance ----------

@router.post("/posts/{post_id}/attend", response_model=dict)
async def attend(post_id: int, payload: AttendIn | None = None, db: AsyncSession = Depends(get_db),
                 user: User = Depends(require_write_access)):
    post, conv, member = await get_post(db, post_id, user, lock=True)
    if not is_plan(post):
        raise HTTPException(400, t("err_not_a_plan"))
    existing = await db.get(BoardAttendee, (post.id, user.id))
    if existing:
        return {"status": existing.status}
    if post.closed:
        raise HTTPException(409, t("err_post_closed"))
    if (post.ends_at or post.starts_at) < utcnow():
        raise HTTPException(409, t("err_post_past"))
    if not active(member):
        raise HTTPException(403, t("err_join_community_first"))
    guests = payload.guests if payload else 0
    if guests > (post.max_guests or 0):
        raise HTTPException(400, t("err_too_many_guests", {"n": post.max_guests or 0}))
    if post.join_mode == "approval" and not staff_of(member, user):
        status = "pending"
    elif board.has_room(post, await board.going_count(db, post.id), 1 + guests):
        status = "going"
    else:
        status = "waitlist"
    db.add(BoardAttendee(post_id=post.id, user_id=user.id, status=status, guests=guests, created_at=utcnow()))
    if status == "going":
        await board.chat_add(db, post, user)
    await db.commit()
    await _publish(db, conv.id, {"type": "attendance.changed", "community_id": conv.id, "post_id": post.id}, [user.id])
    if status == "going" and post.chat_conversation_id:
        await realtime.publish([user.id], {"type": "conversation.changed", "conversation_id": post.chat_conversation_id})
    author = await db.get(User, post.author_id) if post.author_id else None
    if author and author.id != user.id and status in ("going", "pending"):
        await board.tell(db, [author], post, "email_plan_joined" if status == "going" else "email_plan_request",
                         {"name": user.shown_name})
    return {"status": status}


@router.delete("/posts/{post_id}/attend", response_model=dict)
async def leave(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post, conv, _ = await get_post(db, post_id, user, lock=True)
    if post.author_id == user.id:
        raise HTTPException(409, t("err_organiser_cannot_leave"))
    attendee = await db.get(BoardAttendee, (post.id, user.id))
    if not attendee:
        return {"ok": True}
    promoted = await board.remove_attendee(db, post, attendee)
    await db.commit()
    await _publish(db, conv.id, {"type": "attendance.changed", "community_id": conv.id, "post_id": post.id},
                   [user.id] + [u.id for u in promoted])
    if post.chat_conversation_id:
        await realtime.publish([user.id] + [u.id for u in promoted],
                               {"type": "conversation.changed", "conversation_id": post.chat_conversation_id})
    await board.tell(db, promoted, post, "email_plan_promoted")
    return {"ok": True}


@router.get("/posts/{post_id}/attendees", response_model=list[dict])
async def attendees(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post, _, member = await get_post(db, post_id, user)
    statuses = ["going", "waitlist"]
    manager = can_manage(post, member, user)
    if manager:
        statuses.append("pending")
    rows = (await db.execute(select(BoardAttendee, User).join(User, User.id == BoardAttendee.user_id).where(
        BoardAttendee.post_id == post.id, BoardAttendee.status.in_(statuses)).order_by(BoardAttendee.created_at))).all()
    order = {"going": 0, "waitlist": 1, "pending": 2}
    out = [{**user_summary(u), "status": a.status, "guests": a.guests or 0,
            **({"attended": a.attended} if manager else {})} for a, u in rows]
    out.sort(key=lambda x: order[x["status"]])  # stable: by sign-up time inside each status
    return out


@router.post("/posts/{post_id}/attendees/{user_id}/resolve", response_model=dict)
async def resolve_attendee(post_id: int, user_id: int, payload: ResolveIn, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    post, conv, member = await get_post(db, post_id, user, lock=True)
    if not can_manage(post, member, user):
        raise HTTPException(403, t("err_forbidden"))
    attendee = await db.get(BoardAttendee, (post.id, user_id))
    if not attendee or attendee.status != "pending":
        raise HTTPException(404, t("err_attendee_not_found"))
    requester = await db.get(User, user_id)
    if payload.accept:
        attendee.status = "going" if board.has_room(post, await board.going_count(db, post.id), 1 + (attendee.guests or 0)) else "waitlist"
        if attendee.status == "going" and requester:
            await board.chat_add(db, post, requester)
    else:
        await db.delete(attendee)
    await db.commit()
    await _publish(db, conv.id, {"type": "attendance.changed", "community_id": conv.id, "post_id": post.id}, [user_id])
    if payload.accept and requester:
        if post.chat_conversation_id:
            await realtime.publish([user_id], {"type": "conversation.changed", "conversation_id": post.chat_conversation_id})
        await board.tell(db, [requester], post, "email_plan_accepted")
    return {"ok": True}


# ---------- comments ----------

@router.get("/posts/{post_id}/comments", response_model=dict)
async def comments(post_id: int, before_id: int | None = None, limit: int = 50, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    post, _, member = await get_post(db, post_id, user)
    limit = max(1, min(limit, 100))
    q = select(BoardComment).where(BoardComment.post_id == post.id)
    if before_id:
        q = q.where(BoardComment.id < before_id)
    rows = list((await db.execute(q.order_by(BoardComment.id.desc()).limit(limit + 1))).scalars().all())
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    author_ids = {c.author_id for c in rows if c.author_id}
    authors = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(author_ids)))).scalars().all()} if author_ids else {}
    staff = staff_of(member, user)
    return {"comments": [board.comment_out(c, authors.get(c.author_id), user, staff) for c in rows], "has_more": has_more}


@router.post("/posts/{post_id}/comments", response_model=dict)
async def add_comment(post_id: int, payload: CommentIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_write_access)):
    post, conv, member = await get_post(db, post_id, user)
    block = board.comment_block(post, member, user, await board.my_status(db, post.id, user.id))
    if block:
        raise HTTPException(403, t(block))
    body = payload.body.strip()
    if not body:
        raise HTTPException(400, t("err_empty_message"))
    comment = BoardComment(post_id=post.id, author_id=user.id, body=body, created_at=utcnow())
    db.add(comment)
    await db.commit()
    out = board.comment_out(comment, user, user, staff_of(member, user))
    await _publish(db, conv.id, {"type": "comment.created", "community_id": conv.id, "post_id": post.id,
                                 "comment": {**out, "can_delete": False}})
    _background(automod.check_comment(comment.id))
    return out


@router.delete("/comments/{comment_id}", response_model=dict)
async def delete_comment(comment_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    comment = await db.get(BoardComment, comment_id)
    if not comment:
        raise HTTPException(404, t("err_comment_not_found"))
    post, conv, member = await get_post(db, comment.post_id, user)
    if comment.author_id != user.id and not staff_of(member, user):
        raise HTTPException(403, t("err_forbidden"))
    await db.delete(comment)
    await db.commit()
    await _publish(db, conv.id, {"type": "comment.deleted", "community_id": conv.id, "post_id": post.id,
                                 "comment_id": comment_id})
    return {"ok": True}


# ---------- reports ----------

@router.post("/posts/{post_id}/report", response_model=dict)
async def report_post(post_id: int, payload: ReportIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    post, _, _ = await get_post(db, post_id, user)
    if post.author_id == user.id:
        raise HTTPException(400, t("err_report_own"))
    db.add(Report(post_id=post.id, reporter_id=user.id, reason=payload.reason, details=payload.details))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()  # already reported by this person
        return {"ok": True}
    await notify_admins_report(db, payload.reason)
    return {"ok": True}


# ---------- companions, check-in, ratings, co-organisers ----------

@router.put("/posts/{post_id}/guests", response_model=dict)
async def set_guests(post_id: int, payload: AttendIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    """How many companions I bring (+1, +2…). More places need room; fewer free places for the waiting list."""
    post, conv, _ = await get_post(db, post_id, user, lock=True)
    attendee = await db.get(BoardAttendee, (post.id, user.id))
    if not attendee:
        raise HTTPException(404, t("err_attendee_not_found"))
    if payload.guests > (post.max_guests or 0):
        raise HTTPException(400, t("err_too_many_guests", {"n": post.max_guests or 0}))
    more = payload.guests - (attendee.guests or 0)
    if attendee.status == "going" and more > 0 and not board.has_room(post, await board.going_count(db, post.id), more):
        raise HTTPException(409, t("err_no_room_guests"))
    attendee.guests = payload.guests
    await db.flush()
    promoted = await board.promote(db, post) if more < 0 else []
    await db.commit()
    await _publish(db, conv.id, {"type": "attendance.changed", "community_id": conv.id, "post_id": post.id},
                   [user.id] + [u.id for u in promoted])
    await board.tell(db, promoted, post, "email_plan_promoted")
    return {"guests": attendee.guests}


@router.post("/posts/{post_id}/attendees/{user_id}/checkin", response_model=dict)
async def checkin(post_id: int, user_id: int, payload: CheckinIn, db: AsyncSession = Depends(get_db),
                  user: User = Depends(get_current_user)):
    """The organisers mark who came (True), who did not (False) or clear it (None): from 2 hours before the start to
    14 days after the end. Seen only by the organisers and the community's staff."""
    post, _, member = await get_post(db, post_id, user)
    if not can_manage(post, member, user):
        raise HTTPException(403, t("err_forbidden"))
    start, end = as_utc(post.starts_at), as_utc(post.ends_at or post.starts_at)
    if not start or utcnow() < start - timedelta(hours=2) or utcnow() > end + timedelta(days=14):
        raise HTTPException(409, t("err_checkin_time"))
    attendee = await db.get(BoardAttendee, (post.id, user_id))
    if not attendee or attendee.status != "going":
        raise HTTPException(404, t("err_attendee_not_found"))
    attendee.attended = payload.attended
    await db.commit()
    return {"attended": attendee.attended}


@router.post("/posts/{post_id}/rating", response_model=dict)
async def rate(post_id: int, payload: RatingIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """How the plan went (1-5 and a note), once it has started and up to 30 days after: only for the people who went;
    the organisers see the average and the notes, without names."""
    post, _, _ = await get_post(db, post_id, user)
    attendee = await db.get(BoardAttendee, (post.id, user.id))
    if not attendee or attendee.status != "going" or post.author_id == user.id or attendee.attended is False:
        raise HTTPException(403, t("err_rating_not_allowed"))
    start, end = as_utc(post.starts_at), as_utc(post.ends_at or post.starts_at)
    if not start or utcnow() < start or utcnow() > end + timedelta(days=30):
        raise HTTPException(409, t("err_rating_time"))
    attendee.rating, attendee.rating_note = payload.rating, (payload.note or "").strip()[:1000] or None
    await db.commit()
    return {"rating": attendee.rating}


@router.get("/posts/{post_id}/ratings", response_model=dict)
async def ratings(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post, _, member = await get_post(db, post_id, user)
    if not can_manage(post, member, user):
        raise HTTPException(403, t("err_forbidden"))
    rows = (await db.execute(select(BoardAttendee.rating, BoardAttendee.rating_note).where(
        BoardAttendee.post_id == post.id, BoardAttendee.rating.is_not(None)))).all()
    counts = {n: sum(1 for r, _ in rows if r == n) for n in range(1, 6)}
    average = round(sum(r for r, _ in rows) / len(rows), 1) if rows else None
    return {"average": average, "count": len(rows), "counts": counts, "notes": [note for _, note in rows if note]}


@router.put("/posts/{post_id}/cohosts", response_model=dict)
async def set_cohosts(post_id: int, payload: CohostsIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    """Co-organisers (members of the community): they manage the plan like its organiser. Only the organiser and staff."""
    post, conv, member = await get_post(db, post_id, user, lock=True)
    if not (post.author_id == user.id or staff_of(member, user)):
        raise HTTPException(403, t("err_forbidden"))
    ids = []
    for uid in dict.fromkeys(payload.user_ids):
        if uid == post.author_id:
            continue
        m = await get_membership(db, conv.id, uid)
        if not active(m):
            raise HTTPException(400, t("err_cohost_not_member"))
        ids.append(uid)
    post.cohost_ids = ids
    for uid in ids:
        u = await db.get(User, uid)
        if u:
            await board.chat_add(db, post, u)
    if post.series_id:
        series = await db.get(BoardSeries, post.series_id)
        if series:
            series.template = board.series_template(post)
    await db.commit()
    await _publish(db, conv.id, {"type": "post.updated", "community_id": conv.id, "post_id": post.id}, ids)
    return await _post_out(db, user, post)


# ---------- calendars ----------

def _ics_response(text: str, filename: str) -> Response:
    return Response(text, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": f'inline; filename="{filename}"', "Cache-Control": "private, max-age=300"})


@router.get("/calendar/plan/{post_id}.ics")
async def plan_ics(post_id: int, s: str = "", db: AsyncSession = Depends(get_db)):
    """A plan for a calendar app (Add to calendar). Public with its signed link, without a session."""
    post = await db.get(BoardPost, post_id)
    if not post or not is_plan(post) or not board.calendar_signature_ok(post_id, s):
        raise HTTPException(404, t("err_post_not_found"))
    return _ics_response(board.ics([post], await app_base_url(db), post.title), f"meetgo-{post_id}.ics")


@router.get("/calendar/u/{token}.ics")
async def my_calendar_feed(token: str, db: AsyncSession = Depends(get_db)):
    """My plans (going or organising), from 30 days ago on, as a calendar that phones and Google keep up to date."""
    user = (await db.execute(select(User).where(User.calendar_token == token))).scalar_one_or_none() if len(token) >= 20 else None
    if not user:
        raise HTTPException(404, "")
    going = select(BoardAttendee.post_id).where(BoardAttendee.user_id == user.id, BoardAttendee.status == "going")
    posts = list((await db.execute(select(BoardPost).where(
        BoardPost.kind.in_(PLAN_KINDS), BoardPost.id.in_(going), BoardPost.starts_at >= utcnow() - timedelta(days=30))
        .order_by(BoardPost.starts_at).limit(500))).scalars().all())
    return _ics_response(board.ics(posts, await app_base_url(db), "MeetGo"), "meetgo.ics")


@router.get("/me/calendar", response_model=dict)
async def my_calendar(reset: int = 0, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """The address of my plans' calendar (made the first time; `reset=1` makes a new one and the old stops working)."""
    if not user.calendar_token or reset:
        user.calendar_token = secrets.token_urlsafe(24)
        await db.commit()
    return {"path": f"/calendar/u/{user.calendar_token}.ics"}
