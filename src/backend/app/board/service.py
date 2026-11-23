"""Board of a community: posts (threads, meetups, events, notices), attendance with waiting list and approval, the plan
chat that follows attendance, comments, and the notifications about plans."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func, or_, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import t
from app.core.models import (
    Attachment, BoardAttendee, BoardComment, BoardPost, Conversation, ConversationMember, Interest, Message, User,
    utcnow,
)
from app.communities.service import active, can_see, slugify, staff_of
from app.conversations.service import get_membership, iso, join, user_summary
from app.mail import notify_email
from app.messaging.storage import signed_url
from app.push.service import push_notice

PLAN_KINDS = ("meetup", "event")
KINDS = ("thread", "meetup", "event", "notice")
WHENS = ("all", "today", "weekend", "week", "upcoming", "past")
DEFAULT_TZ = "Europe/Madrid"
ATTENDEES_SHOWN = 12


def as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def zone(tz: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(tz or DEFAULT_TZ)
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def when_text(post: BoardPost) -> str:
    return post.starts_at.astimezone(zone(None)).strftime("%d/%m/%Y %H:%M") if post.starts_at else ""


def is_plan(post: BoardPost) -> bool:
    return post.kind in PLAN_KINDS


def plan_end():
    return func.coalesce(BoardPost.ends_at, BoardPost.starts_at)


# ---------- access ----------

async def get_post(db: AsyncSession, post_id: int, user: User, lock: bool = False
                   ) -> tuple[BoardPost, Conversation, ConversationMember | None]:
    """The post, its community and my membership; 404 when deleted or when I cannot see the community."""
    q = select(BoardPost).where(BoardPost.id == post_id)
    post = (await db.execute(q.with_for_update() if lock else q)).scalar_one_or_none()
    conv = await db.get(Conversation, post.conversation_id) if post else None
    member = await get_membership(db, conv.id, user.id) if conv else None
    if not post or post.deleted_at or not conv or not can_see(user, conv, member):
        raise HTTPException(404, t("err_post_not_found"))
    return post, conv, member


def require_poster(conv: Conversation, member: ConversationMember | None, user: User) -> None:
    """Publishing needs an active membership and, on a read-only board, a staff role."""
    if user.role != "admin":
        if not active(member):
            raise HTTPException(403, t("err_join_community_first"))
        if member.silenced_until and member.silenced_until > utcnow():
            raise HTTPException(403, t("err_silenced_until", {"until": member.silenced_until.strftime("%H:%M")}))
    if conv.board_mode == "admins" and not staff_of(member, user):
        raise HTTPException(403, t("err_board_admins_only"))


def comment_block(post: BoardPost, member: ConversationMember | None, user: User, my_status: str | None) -> str | None:
    """Why I cannot comment (an error key), or None."""
    if post.closed:
        return "err_post_closed"
    if post.comments_mode == "off":
        return "err_comments_off"
    if user.role != "admin" and not active(member):
        return "err_join_community_first"
    if post.comments_mode == "attendees" and not (
            my_status == "going" or post.author_id == user.id or staff_of(member, user)):
        return "err_comments_attendees_only"
    return None


async def my_status(db: AsyncSession, post_id: int, user_id: int) -> str | None:
    a = await db.get(BoardAttendee, (post_id, user_id))
    return a.status if a else None


async def check_cover(db: AsyncSession, attachment_id: int | None, user: User) -> int | None:
    if not attachment_id:
        return None
    att = await db.get(Attachment, attachment_id)
    if not att or att.uploader_id != user.id:
        raise HTTPException(404, t("err_file_not_found"))
    return att.id


# ---------- JSON ----------

async def community_refs(db: AsyncSession, conv_ids) -> dict[int, dict]:
    ids = set(conv_ids)
    if not ids:
        return {}
    rows = (await db.execute(select(Conversation, Interest).outerjoin(Interest, Interest.id == Conversation.interest_id)
                             .where(Conversation.id.in_(ids)))).all()
    out = {}
    for c, i in rows:
        title = i.name if i else (c.title or "")
        out[c.id] = {"id": c.id, "title": title, "slug": i.slug if i else slugify(title)}
    return out


async def posts_out(db: AsyncSession, user: User, posts: list[BoardPost]) -> list[dict]:
    if not posts:
        return []
    ids = [p.id for p in posts]
    communities = await community_refs(db, {p.conversation_id for p in posts})
    mine = {m.conversation_id: m for m in (await db.execute(select(ConversationMember).where(
        ConversationMember.conversation_id.in_({p.conversation_id for p in posts}),
        ConversationMember.user_id == user.id))).scalars().all()}
    counts: dict[tuple[int, str], int] = {}
    for pid, status, n in (await db.execute(select(BoardAttendee.post_id, BoardAttendee.status, func.count()).where(
            BoardAttendee.post_id.in_(ids)).group_by(BoardAttendee.post_id, BoardAttendee.status))).all():
        counts[(pid, status)] = n
    statuses = dict((await db.execute(select(BoardAttendee.post_id, BoardAttendee.status).where(
        BoardAttendee.post_id.in_(ids), BoardAttendee.user_id == user.id))).all())
    going: dict[int, list[User]] = {}
    for pid, u in (await db.execute(select(BoardAttendee.post_id, User).join(User, User.id == BoardAttendee.user_id).where(
            BoardAttendee.post_id.in_(ids), BoardAttendee.status == "going").order_by(BoardAttendee.created_at))).all():
        going.setdefault(pid, []).append(u)
    comments = dict((await db.execute(select(BoardComment.post_id, func.count()).where(
        BoardComment.post_id.in_(ids)).group_by(BoardComment.post_id))).all())
    author_ids = {p.author_id for p in posts if p.author_id}
    authors = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(author_ids)))).scalars().all()} if author_ids else {}
    cover_ids = {p.cover_attachment_id for p in posts if p.cover_attachment_id}
    covers = {a.id: a for a in (await db.execute(select(Attachment).where(Attachment.id.in_(cover_ids)))).scalars().all()} if cover_ids else {}

    out = []
    for p in posts:
        member = mine.get(p.conversation_id)
        status = statuses.get(p.id)
        organiser = p.author_id == user.id
        cover = covers.get(p.cover_attachment_id or 0)
        out.append({
            "id": p.id,
            "community": communities.get(p.conversation_id),
            "kind": p.kind,
            "author": user_summary(authors.get(p.author_id)),
            "title": p.title,
            "body": p.body or "",
            "starts_at": iso(p.starts_at),
            "ends_at": iso(p.ends_at),
            "place": p.place,
            "place_url": p.place_url,
            "capacity": p.capacity,
            "going_count": counts.get((p.id, "going"), 0),
            "waitlist_count": counts.get((p.id, "waitlist"), 0),
            "link_url": p.link_url,
            "cover_url": signed_url(cover) if cover else None,
            "comments_mode": p.comments_mode,
            "join_mode": p.join_mode,
            "comment_count": comments.get(p.id, 0),
            "pinned": p.pinned,
            "closed": p.closed,
            "my_status": status,
            "can_comment": comment_block(p, member, user, status) is None,
            "can_edit": organiser or staff_of(member, user),
            "chat_conversation_id": p.chat_conversation_id if (status == "going" or organiser) else None,
            "attendees": [user_summary(u) for u in going.get(p.id, [])[:ATTENDEES_SHOWN]],
            "created_at": iso(p.created_at),
            "updated_at": iso(p.updated_at),
        })
    return out


def comment_out(c: BoardComment, author: User | None, user: User, staff: bool) -> dict:
    return {"id": c.id, "post_id": c.post_id, "author": user_summary(author), "body": c.body,
            "created_at": iso(c.created_at), "can_delete": staff or (c.author_id == user.id)}


# ---------- feed ----------

def _period(when: str, tz: ZoneInfo, now: datetime) -> tuple[datetime | None, datetime | None]:
    """[start, end) of the starting time for today / weekend / week, in the person's time zone."""
    today = now.astimezone(tz).date()

    def midnight(d: date) -> datetime:
        return datetime.combine(d, time(), tzinfo=tz).astimezone(timezone.utc)

    if when == "today":
        return None, midnight(today + timedelta(days=1))
    if when == "weekend":
        saturday = today + timedelta(days=5 - today.weekday()) if today.weekday() < 5 else today - timedelta(days=today.weekday() - 5)
        return midnight(saturday), midnight(saturday + timedelta(days=2))
    if when == "week":
        return None, now + timedelta(days=7)
    return None, None


async def feed(db: AsyncSession, user: User, community_ids, *, kind: str | None = None, when: str = "all",
               before_id: int | None = None, limit: int = 20, community_view: bool = False, tz: str | None = None) -> dict:
    """A page of posts. `before_id` is the last post already shown: the page continues after it."""
    limit = max(1, min(limit, 50))
    if when not in WHENS:
        raise HTTPException(400, t("err_invalid_filter"))
    if kind and kind not in KINDS:
        raise HTTPException(400, t("err_invalid_filter"))
    now = utcnow()
    q = select(BoardPost).where(BoardPost.deleted_at.is_(None), BoardPost.conversation_id.in_(community_ids))
    if kind:
        q = q.where(BoardPost.kind == kind)
    cursor = await db.get(BoardPost, before_id) if before_id else None

    if when in ("today", "weekend", "week", "upcoming"):
        start, end = _period(when, zone(tz), now)
        q = q.where(BoardPost.kind.in_(PLAN_KINDS), plan_end() >= now)
        if start:
            q = q.where(BoardPost.starts_at >= start)
        if end:
            q = q.where(BoardPost.starts_at < end)
        if cursor and cursor.starts_at:
            q = q.where(tuple_(BoardPost.starts_at, BoardPost.id) > tuple_(cursor.starts_at, cursor.id))
        rows = list((await db.execute(q.order_by(BoardPost.starts_at, BoardPost.id).limit(limit + 1))).scalars().all())
        pinned: list[BoardPost] = []
    elif when == "past":
        q = q.where(BoardPost.kind.in_(PLAN_KINDS), plan_end() < now)
        if cursor and cursor.starts_at:
            q = q.where(tuple_(BoardPost.starts_at, BoardPost.id) < tuple_(cursor.starts_at, cursor.id))
        rows = list((await db.execute(q.order_by(BoardPost.starts_at.desc(), BoardPost.id.desc()).limit(limit + 1))).scalars().all())
        pinned = []
    else:
        pinned = []
        if community_view:
            # Pinned posts lead the first page; the pages go on with the others, newest first.
            if not before_id:
                pinned = list((await db.execute(q.where(BoardPost.pinned.is_(True)).order_by(BoardPost.id.desc()))).scalars().all())
            q = q.where(BoardPost.pinned.is_(False))
            if cursor and not cursor.pinned:
                q = q.where(BoardPost.id < cursor.id)
        elif before_id:
            q = q.where(BoardPost.id < before_id)
        rows = list((await db.execute(q.order_by(BoardPost.id.desc()).limit(limit + 1))).scalars().all())
    has_more = len(rows) > limit
    return {"posts": await posts_out(db, user, pinned + rows[:limit]), "has_more": has_more}


def my_community_ids(user: User):
    return select(ConversationMember.conversation_id).join(
        Conversation, Conversation.id == ConversationMember.conversation_id).where(
        ConversationMember.user_id == user.id, Conversation.kind == "channel",
        ConversationMember.away.is_(False), ConversationMember.banned.is_(False))


async def my_plans(db: AsyncSession, user: User, when: str) -> list[dict]:
    now = utcnow()
    attending = select(BoardAttendee.post_id).where(BoardAttendee.user_id == user.id)
    q = select(BoardPost).where(BoardPost.deleted_at.is_(None), BoardPost.kind.in_(PLAN_KINDS))
    if when == "organizing":
        q = q.where(BoardPost.author_id == user.id, plan_end() >= now).order_by(BoardPost.starts_at, BoardPost.id)
    elif when == "past":
        going = select(BoardAttendee.post_id).where(BoardAttendee.user_id == user.id, BoardAttendee.status == "going")
        q = q.where(or_(BoardPost.author_id == user.id, BoardPost.id.in_(going)), plan_end() < now).order_by(
            BoardPost.starts_at.desc(), BoardPost.id.desc())
    elif when == "upcoming":
        q = q.where(or_(BoardPost.author_id == user.id, BoardPost.id.in_(attending)), plan_end() >= now).order_by(
            BoardPost.starts_at, BoardPost.id)
    else:
        raise HTTPException(400, t("err_invalid_filter"))
    posts = list((await db.execute(q.limit(100))).scalars().all())
    return await posts_out(db, user, posts)


# ---------- plan chat ----------

async def _system(db: AsyncSession, conv: Conversation, body: str) -> None:
    msg = Message(conversation_id=conv.id, sender_id=None, kind="system", body=body, mentions=[], created_at=utcnow())
    db.add(msg)
    await db.flush()
    conv.last_message_id, conv.last_message_at = msg.id, msg.created_at


async def create_plan_chat(db: AsyncSession, post: BoardPost, author: User) -> None:
    chat = Conversation(kind="group", title=post.title[:120], created_by_id=author.id, created_at=utcnow(),
                        slow_mode_seconds=0, rules_markdown="", policy_json={"board_post_id": post.id})
    db.add(chat)
    await db.flush()
    await join(db, chat, author.id, role="owner", notify="all")
    await _system(db, chat, t("sys_group_created", {"name": author.display_name}))
    post.chat_conversation_id = chat.id


async def chat_add(db: AsyncSession, post: BoardPost, user: User) -> None:
    chat = await db.get(Conversation, post.chat_conversation_id) if post.chat_conversation_id else None
    if chat and not await get_membership(db, chat.id, user.id):
        await join(db, chat, user.id, notify="all")
        await _system(db, chat, t("sys_member_joined", {"name": user.display_name}))


async def chat_remove(db: AsyncSession, post: BoardPost, user: User) -> None:
    if not post.chat_conversation_id or post.author_id == user.id:
        return
    member = await get_membership(db, post.chat_conversation_id, user.id)
    if member and member.role != "owner":
        await db.delete(member)
        chat = await db.get(Conversation, post.chat_conversation_id)
        await _system(db, chat, t("sys_member_left", {"name": user.display_name, "by": user.display_name}))


# ---------- attendance ----------

async def going_count(db: AsyncSession, post_id: int) -> int:
    return (await db.execute(select(func.count()).select_from(BoardAttendee).where(
        BoardAttendee.post_id == post_id, BoardAttendee.status == "going"))).scalar_one()


def has_room(post: BoardPost, going: int) -> bool:
    return not post.capacity or going < post.capacity


async def promote(db: AsyncSession, post: BoardPost) -> list[User]:
    """Fill free places with the oldest people on the waiting list. Returns who moved up (not yet committed)."""
    moved = []
    going = await going_count(db, post.id)
    while has_room(post, going):
        nxt = (await db.execute(select(BoardAttendee).where(
            BoardAttendee.post_id == post.id, BoardAttendee.status == "waitlist").order_by(
            BoardAttendee.created_at, BoardAttendee.user_id).limit(1))).scalar_one_or_none()
        if not nxt:
            break
        nxt.status = "going"
        going += 1
        u = await db.get(User, nxt.user_id)
        if u:
            await chat_add(db, post, u)
            moved.append(u)
    return moved


async def remove_attendee(db: AsyncSession, post: BoardPost, attendee: BoardAttendee) -> list[User]:
    was_going = attendee.status == "going"
    u = await db.get(User, attendee.user_id)
    await db.delete(attendee)
    await db.flush()
    if not was_going:
        return []
    if u:
        await chat_remove(db, post, u)
    return await promote(db, post)


# ---------- notifications ----------

async def tell(db: AsyncSession, users: list[User], post: BoardPost, key: str, params: dict | None = None) -> None:
    """Push and email (preference "plans") about a plan."""
    params = {"plan": post.title, "date": when_text(post), "place": post.place or "", **(params or {})}
    users = [u for u in users if u]
    if not users:
        return
    push_plan(users, post, key, params)
    for u in users:
        await notify_email.notify(db, u, "plans", key, params, None if key == "email_plan_cancelled" else f"/app/p/{post.id}")


def push_plan(users: list[User], post: BoardPost, key: str, params: dict) -> None:
    push_notice(users, "plan", key, params, f"/app/p/{post.id}")


async def attendee_users(db: AsyncSession, post: BoardPost, statuses=("going", "waitlist"), exclude: int | None = None) -> list[User]:
    res = await db.execute(select(User).join(BoardAttendee, BoardAttendee.user_id == User.id).where(
        BoardAttendee.post_id == post.id, BoardAttendee.status.in_(statuses)))
    return [u for u in res.scalars().all() if u.id != exclude]


async def plan_reminders_due(db: AsyncSession) -> list[tuple[User, BoardPost, str, dict]]:
    """People going to a plan that starts within the next 24 hours, with the notice key that keeps it to once."""
    now = utcnow()
    rows = (await db.execute(select(User, BoardPost).join(BoardAttendee, BoardAttendee.user_id == User.id).join(
        BoardPost, BoardPost.id == BoardAttendee.post_id).where(
        BoardAttendee.status == "going", BoardPost.deleted_at.is_(None), BoardPost.kind.in_(PLAN_KINDS),
        BoardPost.starts_at > now, BoardPost.starts_at <= now + timedelta(hours=24)).limit(2000))).all()
    out = []
    for u, p in rows:
        key = f"plan_reminder:{p.id}:{p.starts_at.astimezone(timezone.utc):%Y%m%d%H%M}"
        out.append((u, p, key, {"plan": p.title, "date": when_text(p), "place": p.place or ""}))
    return out


async def delete_post_data(db: AsyncSession, post: BoardPost) -> None:
    """Soft-delete a post; its plan chat stays, read-only."""
    post.deleted_at = utcnow()
    if post.chat_conversation_id:
        chat = await db.get(Conversation, post.chat_conversation_id)
        if chat:
            chat.policy_json = {**(chat.policy_json or {}), "read_only": True}
            await _system(db, chat, t("sys_plan_cancelled", {"plan": post.title}))

