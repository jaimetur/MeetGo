"""Settings of the interest communities, set per interest in the administration and applied to every zone's community.

With the fixed age ranges each interest has one community per province and range (18-30, 31-60, 61+). With an age span
(for example 25-40) it has one community per province, keyed "custom", where people whose age (from the date of birth)
fits the span meet whatever their range. Switching between the two joins or splits those communities, keeping their
members, messages, posts and requests.
"""

from collections import Counter

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Conversation, ConversationMember, Interest, User

SPAN_KEY = "custom"


def has_span(interest: Interest | None) -> bool:
    return bool(interest and (interest.min_age is not None or interest.max_age is not None))


def interest_key(interest: Interest | None, age_key: str) -> str:
    """The age key of the interest's community for someone of `age_key`."""
    return SPAN_KEY if has_span(interest) else age_key


def channel_values(interest: Interest | None) -> dict:
    """The settings a new community of the interest starts with."""
    if not interest:
        return {"retention_days": 365, "access_mode": "open", "board_mode": "open", "policy_json": {}}
    questions = [q for q in (interest.join_questions or []) if q][:3]
    return {
        "retention_days": interest.retention_days or 365, "access_mode": interest.access_mode or "open",
        "board_mode": interest.board_mode or "open", "min_age": interest.min_age, "max_age": interest.max_age,
        "policy_json": {"join_questions": questions} if questions else {},
    }


async def merge_channels(db: AsyncSession, target: int, others: list[int]) -> None:
    """Moves members, messages, posts, series and requests of `others` into `target`, and deletes `others`."""
    if not others:
        return
    params = {"t": target, "o": others}
    await db.execute(text("""
        INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_message_id, notify,
            muted_until, pinned, hidden, strikes, last_strike_at, silenced_until, banned, ban_until,
            email_notified_message_id, away)
        SELECT DISTINCT ON (user_id) :t, user_id, role, joined_at, 0, notify, muted_until, pinned, hidden, strikes,
            last_strike_at, silenced_until, banned, ban_until, 0, away
        FROM conversation_members WHERE conversation_id = ANY(:o) ORDER BY user_id, joined_at
        ON CONFLICT DO NOTHING"""), params)
    for table in ("messages", "board_posts", "board_series", "community_requests"):
        await db.execute(text(f"UPDATE {table} SET conversation_id = :t WHERE conversation_id = ANY(:o)"), params)
    await db.execute(text("""
        UPDATE conversation_members SET
            last_read_message_id = (SELECT coalesce(max(id), 0) FROM messages WHERE conversation_id = :t),
            email_notified_message_id = (SELECT coalesce(max(id), 0) FROM messages WHERE conversation_id = :t)
        WHERE conversation_id = :t AND last_read_message_id = 0"""), {"t": target})
    await db.execute(text("DELETE FROM conversations WHERE id = ANY(:o)"), {"o": others})
    await db.execute(text("""
        UPDATE conversations SET last_message_id = (SELECT max(id) FROM messages WHERE conversation_id = :t),
            last_message_at = (SELECT max(created_at) FROM messages WHERE conversation_id = :t) WHERE id = :t"""), {"t": target})


async def _member_count(db: AsyncSession, conv_id: int) -> int:
    return len((await db.execute(select(ConversationMember.user_id).where(ConversationMember.conversation_id == conv_id))).all())


async def _recompute_away(db: AsyncSession, conv: Conversation) -> None:
    """Whoever no longer fits the community (its province and age) keeps the membership, away, as when moving zone."""
    from app.communities.service import in_zone
    rows = (await db.execute(select(ConversationMember, User).join(User, User.id == ConversationMember.user_id).where(
        ConversationMember.conversation_id == conv.id))).all()
    for member, user in rows:
        if user.bot_role:
            continue
        member.away = not in_zone(user, conv)


async def apply_interest_settings(db: AsyncSession, interest: Interest, had_span: bool) -> None:
    """Applies the interest's settings to all its communities, joining them per province when an age span starts and
    splitting them back into the fixed ranges when it ends. Commits."""
    from app.conversations.service import user_age_key
    span = has_span(interest)
    interest_id = interest.id
    convs = list((await db.execute(select(Conversation).where(
        Conversation.kind == "channel", Conversation.interest_id == interest.id))).scalars().all())
    if span and not had_span:
        by_province: dict[str, list[Conversation]] = {}
        for c in convs:
            by_province.setdefault(c.province, []).append(c)
        for _, group in by_province.items():
            sizes = {c.id: await _member_count(db, c.id) for c in group}
            group.sort(key=lambda c: (-sizes[c.id], c.id))
            target, others = group[0], [c.id for c in group[1:]]
            await merge_channels(db, target.id, others)
            target.age_range = SPAN_KEY
        await db.flush()
    elif had_span and not span:
        for c in [c for c in convs if c.age_range == SPAN_KEY]:
            ages = Counter()
            for (u,) in (await db.execute(select(User).join(ConversationMember, ConversationMember.user_id == User.id).where(
                    ConversationMember.conversation_id == c.id, User.bot_role.is_(None)))).all():
                ages[user_age_key(u)] += 1
            key = ages.most_common(1)[0][0] if ages else "31_60"
            existing = (await db.execute(select(Conversation).where(
                Conversation.kind == "channel", Conversation.interest_id == interest.id, Conversation.province == c.province,
                Conversation.age_range == key))).scalar_one_or_none()
            if existing:
                await merge_channels(db, existing.id, [c.id])
            else:
                c.age_range = key
        await db.flush()
    values = channel_values(interest)  # before expire_all: the interest is read once more otherwise
    db.expire_all()
    for c in (await db.execute(select(Conversation).where(
            Conversation.kind == "channel", Conversation.interest_id == interest_id))).scalars().all():
        c.retention_days, c.access_mode, c.board_mode = values["retention_days"], values["access_mode"], values["board_mode"]
        c.min_age, c.max_age = values.get("min_age"), values.get("max_age")
        c.policy_json = {**(c.policy_json or {}), "join_questions": values["policy_json"].get("join_questions", [])}
        await _recompute_away(db, c)
    await db.commit()
