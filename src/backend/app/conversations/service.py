"""Conversations: access checks, channel membership by zone and interest, and JSON shapes."""

from collections import defaultdict
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import t
from app.core.models import (
    Attachment, Conversation, ConversationKind, ConversationMember, Interest, Message, MessageReaction, User,
    UserInterest, utcnow,
)
from app.core.schemas import utc_iso
from app.core.utils import age_range_from_dob, normalize_age_range, can_access_age_range, age_from_dob
from app.realtime.service import online_ids
from app.messaging.storage import attachment_out

AGE_LABELS = {"18_30": "18-30", "31_60": "31-60", "61_plus": "61+"}
SNIPPET = 140


def iso(dt: datetime | None) -> str | None:
    return utc_iso(dt) if dt else None


def user_summary(u: User | None) -> dict | None:
    if not u:
        return None
    # display_name is how the person is shown (first name and alias); username is the alias (for @mentions)
    return {"id": u.id, "display_name": u.shown_name, "username": u.display_name, "avatar_url": u.avatar_url}


def user_age_key(user: User) -> str:
    try:
        return age_range_from_dob(user.dob).value
    except Exception:
        return normalize_age_range(user.age_range).value


def user_years(user: User) -> int | None:
    """Age in years from the date of birth (which can be changed only once)."""
    try:
        return age_from_dob(user.dob)
    except Exception:
        return None


def has_age_span(conv: Conversation) -> bool:
    return conv.min_age is not None or conv.max_age is not None


def fits_age(user: User, conv: Conversation) -> bool:
    """Whether the person's age fits the community: its own span (min_age-max_age, communities made by people) or,
    without one, the fixed range of its zone (18-30, 31-60, 61+). Always from the date of birth, never chosen."""
    if has_age_span(conv):
        years = user_years(user)
        return years is not None and (conv.min_age or 0) <= years <= (conv.max_age if conv.max_age is not None else 200)
    return conv.age_range == user_age_key(user)


def age_fits_sql(user: User):
    """SQL for fits_age over Conversation rows."""
    from sqlalchemy import and_, func, or_
    years = user_years(user)
    span = or_(Conversation.min_age.is_not(None), Conversation.max_age.is_not(None))
    return or_(
        and_(~span, Conversation.age_range == user_age_key(user)),
        and_(span, func.coalesce(Conversation.min_age, 0) <= (years if years is not None else -1),
             func.coalesce(Conversation.max_age, 200) >= (years if years is not None else -1)),
    )


def in_scope(user: User, conv: Conversation) -> bool:
    """The person's province is in the community's scope: its province, or the provinces its creator widened it to."""
    return user.province in (conv.scope_provinces or [conv.province])


def scope_sql(province: str):
    """SQL: communities whose scope includes this province."""
    return or_(Conversation.province == province, Conversation.scope_provinces.contains([province]))


def can_join_channel(user: User, conv: Conversation) -> bool:
    if not in_scope(user, conv):
        return False
    try:
        age = age_from_dob(user.dob)
        user_range = age_range_from_dob(user.dob)
        from app.core.models import AgeRange
        return can_access_age_range(age, user_range, AgeRange(conv.age_range))
    except Exception:
        return False


async def get_membership(db: AsyncSession, conversation_id: int, user_id: int) -> ConversationMember | None:
    res = await db.execute(select(ConversationMember).where(
        ConversationMember.conversation_id == conversation_id, ConversationMember.user_id == user_id))
    return res.scalar_one_or_none()


async def require_member(db: AsyncSession, conversation_id: int, user: User,
                         read_only_ok: bool = False) -> tuple[Conversation, ConversationMember]:
    """The conversation and my membership. `read_only_ok`: also when I was expelled by a change of the community's
    filters (I still read what was written until then)."""
    conv = await db.get(Conversation, conversation_id)
    member = await get_membership(db, conversation_id, user.id) if conv else None
    expelled = bool(member and member.expelled_message_id is not None)
    if not conv or not member or (member.away and not (read_only_ok and expelled)):  # away: a zone the person has left
        raise HTTPException(404, t("err_conversation_not_found"))
    return conv, member


def is_staff(member: ConversationMember | None, user: User) -> bool:
    return user.role == "admin" or bool(member and member.role in ("owner", "admin", "moderator"))


# ---------- channels ----------

async def channel_for(db: AsyncSession, province: str, age_key: str, interest_id: int) -> Conversation:
    """The interest's community of a zone (made with the interest's settings if missing). With an age span the
    interest has one community per province, whatever the range."""
    from app.communities.interest_settings import channel_values, interest_key
    interest = await db.get(Interest, interest_id)
    age_key = interest_key(interest, age_key)
    await db.execute(
        pg_insert(Conversation)
        .values(kind=ConversationKind.CHANNEL.value, province=province, age_range=age_key, interest_id=interest_id,
                created_at=utcnow(), slow_mode_seconds=0, rules_markdown=DEFAULT_RULES, **channel_values(interest))
        .on_conflict_do_nothing(constraint="uq_channel_key")
    )
    res = await db.execute(select(Conversation).where(
        Conversation.kind == "channel", Conversation.province == province,
        Conversation.age_range == age_key, Conversation.interest_id == interest_id))
    return res.scalar_one()


DEFAULT_RULES = (
    "- Respeto ante todo: nada de acoso.\n"
    "- Sin spam ni autopromoción.\n"
    "- No compartas teléfonos en el chat; usa mensajes directos.\n"
    "- Los planes se organizan mejor en un grupo.\n"
)


async def join(db: AsyncSession, conv: Conversation, user_id: int, role: str = "member", notify: str | None = None) -> ConversationMember:
    member = await get_membership(db, conv.id, user_id)
    if member:
        if member.hidden:
            member.hidden = False
        if member.away:  # back in that zone: the membership returns as it was
            member.away = False
        member.expelled_message_id = None  # joining again after being expelled by a change of filters
        return member
    member = ConversationMember(
        conversation_id=conv.id, user_id=user_id, role=role,
        notify=notify or ("mentions" if conv.kind == "channel" else "all"),
        last_read_message_id=conv.last_message_id or 0,
    )
    db.add(member)
    await db.flush()
    return member


async def join_interest_channel(db: AsyncSession, user: User, interest_id: int) -> Conversation:
    conv = await channel_for(db, user.province, user_age_key(user), interest_id)
    # Communities that need approval or an invitation are not joined just by choosing the interest.
    if conv.access_mode == "open" or await get_membership(db, conv.id, user.id):
        await join(db, conv, user.id)
    return conv


async def leave_interest_channel(db: AsyncSession, user: User, interest_id: int, province: str, age_key: str) -> None:
    from app.communities.interest_settings import interest_key
    age_key = interest_key(await db.get(Interest, interest_id), age_key)
    res = await db.execute(select(Conversation.id).where(
        Conversation.kind == "channel", Conversation.province == province,
        Conversation.age_range == age_key, Conversation.interest_id == interest_id))
    cid = res.scalar_one_or_none()
    if cid:
        member = await get_membership(db, cid, user.id)
        if member and not member.banned:
            await db.delete(member)


async def move_channels_to_zone(db: AsyncSession, user: User, old_province: str, old_age: str) -> None:
    """After a change of province or age range: channels of other zones become away (kept, with their role) and those of
    the new zone come back. Nothing new is joined."""
    age = user_age_key(user)
    res = await db.execute(select(ConversationMember, Conversation).join(
        Conversation, Conversation.id == ConversationMember.conversation_id).where(
        ConversationMember.user_id == user.id, Conversation.kind == "channel"))
    for member, conv in res.all():
        if member.expelled_message_id is None:  # expelled ones stay out (read only)
            member.away = not (in_scope(user, conv) and fits_age(user, conv))


# ---------- direct messages ----------

def dm_key(a: int, b: int) -> str:
    x, y = sorted((a, b))
    return f"{x}:{y}"


async def dm_between(db: AsyncSession, a: int, b: int, create: bool = True) -> Conversation | None:
    key = dm_key(a, b)
    res = await db.execute(select(Conversation).where(Conversation.dm_key == key))
    conv = res.scalar_one_or_none()
    if conv or not create:
        return conv
    await db.execute(pg_insert(Conversation).values(kind="dm", dm_key=key, created_at=utcnow(), slow_mode_seconds=0,
                                                   rules_markdown="", policy_json={}).on_conflict_do_nothing())
    res = await db.execute(select(Conversation).where(Conversation.dm_key == key))
    conv = res.scalar_one()
    for uid in (a, b):
        await join(db, conv, uid, notify="all")
    return conv


# ---------- conversation list ----------

async def conversations_out(db: AsyncSession, user: User, only_ids: list[int] | None = None) -> list[dict]:
    q = select(ConversationMember, Conversation).join(Conversation, Conversation.id == ConversationMember.conversation_id).where(
        ConversationMember.user_id == user.id, ConversationMember.hidden.is_(False),
        or_(ConversationMember.away.is_(False), ConversationMember.expelled_message_id.is_not(None)))  # expelled: read only
    if only_ids is not None:
        q = q.where(Conversation.id.in_(only_ids))
    rows = (await db.execute(q)).all()
    if not rows:
        return []
    ids = [c.id for _, c in rows]

    counts = dict((await db.execute(
        select(ConversationMember.conversation_id, func.count())
        .join(User, User.id == ConversationMember.user_id).where(
            ConversationMember.conversation_id.in_(ids), ConversationMember.banned.is_(False),
            ConversationMember.away.is_(False), User.bot_role.is_(None))  # the community bots do not count
        .group_by(ConversationMember.conversation_id))).all())

    main_stream = or_(Message.thread_root_id.is_(None), Message.also_in_channel.is_(True))
    unread_q = (
        select(Message.conversation_id, func.count())
        .join(ConversationMember, and_(ConversationMember.conversation_id == Message.conversation_id,
                                       ConversationMember.user_id == user.id))
        .where(Message.conversation_id.in_(ids), Message.id > ConversationMember.last_read_message_id,
               or_(Message.sender_id.is_(None), Message.sender_id != user.id), Message.deleted_at.is_(None), main_stream)
        .group_by(Message.conversation_id)
    )
    unread = dict((await db.execute(unread_q)).all())
    mention_q = (
        select(Message.conversation_id, func.count())
        .join(ConversationMember, and_(ConversationMember.conversation_id == Message.conversation_id,
                                       ConversationMember.user_id == user.id))
        .where(Message.conversation_id.in_(ids), Message.id > ConversationMember.last_read_message_id,
               Message.deleted_at.is_(None), Message.mentions.contains([user.id]))
        .group_by(Message.conversation_id)
    )
    mentions = dict((await db.execute(mention_q)).all())

    last_ids = [c.last_message_id for _, c in rows if c.last_message_id]
    last_msgs: dict[int, Message] = {}
    senders: dict[int, User] = {}
    if last_ids:
        for m in (await db.execute(select(Message).where(Message.id.in_(last_ids)))).scalars().all():
            last_msgs[m.id] = m
        sender_ids = {m.sender_id for m in last_msgs.values() if m.sender_id}
        if sender_ids:
            for u in (await db.execute(select(User).where(User.id.in_(sender_ids)))).scalars().all():
                senders[u.id] = u
    attach_ids = set()
    voice_ids = set()
    if last_ids:
        for mid, fname in (await db.execute(select(Attachment.message_id, Attachment.file_name).where(Attachment.message_id.in_(last_ids)))).all():
            attach_ids.add(mid)
            if (fname or "").startswith("voice_note_"):
                voice_ids.add(mid)

    dm_ids = [c.id for _, c in rows if c.kind == "dm"]
    others: dict[int, User] = {}
    if dm_ids:
        res = await db.execute(select(ConversationMember.conversation_id, User).join(User, User.id == ConversationMember.user_id).where(
            ConversationMember.conversation_id.in_(dm_ids), ConversationMember.user_id != user.id))
        for cid, u in res.all():
            others[cid] = u
    online = await online_ids([u.id for u in others.values()])
    friends = set()
    if others:
        from app.core.models import Friendship
        friends = set((await db.execute(select(Friendship.friend_id).where(
            Friendship.user_id == user.id, Friendship.friend_id.in_([u.id for u in others.values()])))).scalars().all())

    interest_ids = {c.interest_id for _, c in rows if c.interest_id}
    interests = {}
    if interest_ids:
        interests = {i.id: i for i in (await db.execute(select(Interest).where(Interest.id.in_(interest_ids)))).scalars().all()}

    # the chat of a plan or event: its post and kind, so the app opens the plan from the chat and groups it under its
    # community (whether the plan is still to come or already past)
    from app.core.models import BoardPost
    group_ids = [c.id for _, c in rows if c.kind == "group"]
    plans = {cid: (pid, kind, community) for cid, pid, kind, community in (await db.execute(
        select(BoardPost.chat_conversation_id, BoardPost.id, BoardPost.kind, BoardPost.conversation_id)
        .where(BoardPost.chat_conversation_id.in_(group_ids)))).all()} if group_ids else {}

    out = []
    for member, conv in rows:
        last = last_msgs.get(conv.last_message_id or 0)
        if last and last.id <= (member.cleared_message_id or 0):
            last = None
        expelled = member.expelled_message_id is not None
        if expelled and last and last.id > member.expelled_message_id:  # nothing written after the expulsion
            last = None
        other = others.get(conv.id)
        item = conversation_base(conv, member, interests.get(conv.interest_id), other, online,
                                 last_seen_shown(user, other, bool(other and other.id in friends)))
        item.update({
            "member_count": counts.get(conv.id, 0),
            "unread_count": 0 if expelled else min(unread.get(conv.id, 0), 999),
            "mention_count": 0 if expelled else mentions.get(conv.id, 0),
            "plan": ({"post_id": plans[conv.id][0], "kind": plans[conv.id][1], "community_id": plans[conv.id][2]}
                     if conv.id in plans else None),
            "last_message": {**last_message_out(last, senders.get(last.sender_id) if last else None,
                                                bool(last and last.id in attach_ids)), "voice": last.id in voice_ids} if last else None,
        })
        if expelled:
            item["last_message_at"] = iso(last.created_at) if last else None
        out.append(item)
    out.sort(key=lambda c: (not c["pinned"], -(_ts(c["last_message_at"]))), reverse=False)
    return out


def _ts(value: str | None) -> float:
    if not value:
        return 0.0
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def last_seen_shown(viewer: User, other: User | None, is_friend: bool) -> str | None:
    """The other person's "last seen", as in WhatsApp: as they allow it (everyone, friends, nobody), and only if I share
    mine (with "nobody" I do not see anyone's)."""
    if not other or not other.last_seen_at or (viewer.last_seen_privacy or "all") == "nobody":
        return None
    allowed = other.last_seen_privacy or "all"
    if allowed == "nobody" or (allowed == "friends" and not is_friend):
        return None
    return iso(other.last_seen_at)


def conversation_base(conv: Conversation, member: ConversationMember, interest: Interest | None,
                      other: User | None, online: set[int], last_seen: str | None = None) -> dict:
    if conv.kind == "channel":
        title = interest.label() if interest else (conv.title or "chat")
        slug = interest.slug if interest else None
        # where and for whom: the fixed range, or the community's own age span (communities made by people, interests
        # with a custom range)
        if conv.min_age is not None or conv.max_age is not None:
            ages = f"{conv.min_age or 18}–{conv.max_age}" if conv.max_age is not None else f"{conv.min_age}+"
        else:
            ages = AGE_LABELS.get(conv.age_range or "", conv.age_range or "")
        subtitle = f"{conv.scope_label or conv.province} · {ages}"
    elif conv.kind == "dm":
        title = other.shown_name if other else "—"
        slug = None
        subtitle = None
    else:
        title = conv.title or "Grupo"
        slug = None
        subtitle = None
    return {
        "id": conv.id,
        "kind": conv.kind,
        "title": title,
        "slug": slug,
        "subtitle": subtitle,
        "avatar_url": conv.avatar_url if conv.kind != "dm" else (other.avatar_url if other else None),
        "province": conv.scope_label or conv.province,
        "age_range": conv.age_range,
        # expelled by a change of the community's filters: the chat stays, read only
        "read_only": member.expelled_message_id is not None,
        "min_age": conv.min_age,
        "max_age": conv.max_age,
        "interest": {"id": interest.id, "slug": interest.slug, "name": interest.label()} if interest else None,
        "other_user": ({**user_summary(other), "online": other.id in online, "last_seen_at": last_seen} if other else None),
        "role": member.role,
        "notify": member.notify,
        "muted_until": iso(member.muted_until),
        "pinned": member.pinned,
        "banned": member.banned,
        "silenced_until": iso(member.silenced_until) if member.silenced_until and member.silenced_until > utcnow() else None,
        "last_read_message_id": member.last_read_message_id,
        "last_message_at": iso(conv.last_message_at or conv.created_at),
        "slow_mode_seconds": conv.slow_mode_seconds,
        "pinned_message_id": conv.pinned_message_id,
        "description": conv.description,
    }


def last_message_out(m: Message, sender: User | None, has_attachments: bool) -> dict:
    body = "" if m.deleted_at else (m.body or "")
    return {
        "id": m.id,
        "kind": m.kind,
        "sender_id": m.sender_id,
        "sender_name": sender.shown_name if sender else None,
        "body": body[:SNIPPET],
        "deleted": bool(m.deleted_at),
        "has_attachments": has_attachments,
        "created_at": iso(m.created_at),
    }


# ---------- messages ----------

async def messages_out(db: AsyncSession, messages: list[Message], me_id: int) -> list[dict]:
    if not messages:
        return []
    ids = [m.id for m in messages]
    user_ids = {m.sender_id for m in messages if m.sender_id}

    reply_ids = {m.reply_to_id for m in messages if m.reply_to_id}
    replies: dict[int, Message] = {}
    if reply_ids:
        for r in (await db.execute(select(Message).where(Message.id.in_(reply_ids)))).scalars().all():
            replies[r.id] = r
            if r.sender_id:
                user_ids.add(r.sender_id)

    roots = [m.id for m in messages if m.thread_reply_count]
    participants: dict[int, list[int]] = defaultdict(list)
    if roots:
        res = await db.execute(select(Message.thread_root_id, Message.sender_id).where(
            Message.thread_root_id.in_(roots), Message.deleted_at.is_(None)).order_by(Message.id.desc()))
        for root_id, sid in res.all():
            if sid and sid not in participants[root_id] and len(participants[root_id]) < 3:
                participants[root_id].append(sid)
                user_ids.add(sid)

    users = {}
    if user_ids:
        users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}

    reactions: dict[int, dict[str, list[int]]] = defaultdict(dict)
    for r in (await db.execute(select(MessageReaction).where(MessageReaction.message_id.in_(ids)).order_by(MessageReaction.created_at))).scalars().all():
        reactions[r.message_id].setdefault(r.emoji, []).append(r.user_id)

    attachments: dict[int, list[dict]] = defaultdict(list)
    for a in (await db.execute(select(Attachment).where(Attachment.message_id.in_(ids)).order_by(Attachment.id))).scalars().all():
        attachments[a.message_id].append(attachment_out(a))

    out = []
    for m in messages:
        reply = replies.get(m.reply_to_id or 0)
        deleted = bool(m.deleted_at)
        out.append({
            "id": m.id,
            "conversation_id": m.conversation_id,
            "client_id": m.client_id,
            "kind": m.kind,
            "sender": user_summary(users.get(m.sender_id)) if m.sender_id else None,
            "body": "" if deleted else m.body,
            "created_at": iso(m.created_at),
            "edited_at": iso(m.edited_at),
            "deleted": deleted,
            "moderation_reason": m.moderation_reason,
            "reply_to": ({
                "id": reply.id,
                "sender_name": users[reply.sender_id].shown_name if reply.sender_id in users else None,
                "body": "" if reply.deleted_at else (reply.body or "")[:SNIPPET],
                "deleted": bool(reply.deleted_at),
            } if reply else None),
            "thread_root_id": m.thread_root_id,
            "also_in_channel": m.also_in_channel,
            "thread": ({
                "count": m.thread_reply_count,
                "last_reply_at": iso(m.thread_last_reply_at),
                "participants": [user_summary(users[u]) for u in participants.get(m.id, []) if u in users],
            } if m.thread_reply_count else None),
            "mentions": m.mentions or [],
            "reactions": [{"emoji": e, "count": len(uids), "user_ids": uids[:50], "me": me_id in uids}
                          for e, uids in reactions.get(m.id, {}).items()],
            "attachments": [] if deleted else attachments.get(m.id, []),
        })
    return out
