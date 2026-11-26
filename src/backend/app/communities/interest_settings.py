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


RANK = {"country": 0, "region": 1, "province": 2}
ARCHIVE_DAYS = 30  # how long the chats of joined zones stay to read


async def copy_history(db: AsyncSession, source_id: int, target_id: int) -> None:
    """Copies the chat of `source` into `target`: its messages (threads, replies and pinned one kept) and their files.
    Reactions and reports stay in the original."""
    from app.core.models import Attachment, Message
    source = await db.get(Conversation, source_id)
    ids: dict[int, int] = {}
    for m in (await db.execute(select(Message).where(Message.conversation_id == source_id).order_by(Message.id))).scalars().all():
        copy = Message(conversation_id=target_id, sender_id=m.sender_id, kind=m.kind, body=m.body,
                       reply_to_id=ids.get(m.reply_to_id) if m.reply_to_id else None,
                       thread_root_id=ids.get(m.thread_root_id) if m.thread_root_id else None,
                       thread_reply_count=m.thread_reply_count, thread_last_reply_at=m.thread_last_reply_at,
                       also_in_channel=m.also_in_channel, mentions=list(m.mentions or []), created_at=m.created_at,
                       edited_at=m.edited_at, deleted_at=m.deleted_at, moderation_reason=m.moderation_reason)
        db.add(copy)
        await db.flush()
        ids[m.id] = copy.id
    if ids:
        for a in (await db.execute(select(Attachment).where(Attachment.message_id.in_(list(ids))))).scalars().all():
            db.add(Attachment(message_id=ids[a.message_id], uploader_id=a.uploader_id, storage_key=a.storage_key,
                              thumb_key=a.thumb_key, file_name=a.file_name, mime=a.mime, size=a.size, width=a.width,
                              height=a.height, created_at=a.created_at))
        target = await db.get(Conversation, target_id)
        target.last_message_id = max(ids.values())
        target.last_message_at = source.last_message_at
        if source.pinned_message_id in ids:
            target.pinned_message_id = ids[source.pinned_message_id]
        await db.execute(text("""UPDATE conversation_members SET last_read_message_id = :m, email_notified_message_id = :m
            WHERE conversation_id = :t AND last_read_message_id < :m"""), {"t": target_id, "m": max(ids.values())})
    await db.flush()


async def _move_people_and_board(db: AsyncSession, target: int, others: list[int]) -> None:
    """Members, posts, series and requests of `others` into `target`; their chats stay where they are."""
    params = {"t": target, "o": others}
    await db.execute(text("""
        INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_message_id, notify,
            muted_until, pinned, hidden, strikes, last_strike_at, silenced_until, banned, ban_until,
            email_notified_message_id, away)
        SELECT DISTINCT ON (user_id) :t, user_id, role, joined_at, 0, notify, muted_until, pinned, hidden, strikes,
            last_strike_at, silenced_until, banned, ban_until, 0, away
        FROM conversation_members WHERE conversation_id = ANY(:o) ORDER BY user_id, away, joined_at
        ON CONFLICT DO NOTHING"""), params)
    for table in ("board_posts", "board_series", "community_requests"):
        await db.execute(text(f"UPDATE {table} SET conversation_id = :t WHERE conversation_id = ANY(:o)"), params)


def _archive(c: Conversation, name: str, into: int) -> None:
    """A joined zone's chat: a read-only chat of its people, kept ARCHIVE_DAYS to look things up, then deleted."""
    from datetime import timedelta
    from app.core.models import utcnow
    c.title = f"{name} · {c.scope_label or c.province}"[:120]
    c.kind, c.interest_id = "group", None
    c.province = c.scope_kind = c.scope_value = c.scope_label = None
    c.scope_provinces = None
    c.policy_json = {**(c.policy_json or {}), "read_only": True, "archived_into": into,
                     "archived_until": (utcnow() + timedelta(days=ARCHIVE_DAYS)).isoformat()}


async def regroup_geo(db: AsyncSession, interest: Interest) -> None:
    """Puts the interest's communities at its geographic width (country, region or province), keeping every member.

    Narrower (split): each wide community stays as the zone most of its people are in, and the people of every other
    zone move to their zone's new community, which starts with a copy of the wide one's chat history.
    Wider (join): the communities of the same new zone (and age range) become one new community with all their people,
    posts and requests; its chat starts empty (their conversations would get mixed), and each old chat stays read only
    for ARCHIVE_DAYS days for its people to look things up. A zone with a single community just takes the new width,
    history and all. Does not commit."""
    from sqlalchemy import delete
    from app.communities.zones import geo_data, scope_values, zone_language, zone_of
    from app.conversations.service import channel_for, join, user_age_key
    data = await geo_data(db)
    level, interest_id, name = interest.geo_level, interest.id, interest.name  # read now: later commits expire it
    level = level if level in RANK else "country"
    convs = list((await db.execute(select(Conversation).where(
        Conversation.kind == "channel", Conversation.interest_id == interest_id))).scalars().all())
    if not convs:
        return
    people: dict[int, list[User]] = {}
    for member, user in (await db.execute(select(ConversationMember, User).join(User, User.id == ConversationMember.user_id).where(
            ConversationMember.conversation_id.in_([c.id for c in convs]), ConversationMember.banned.is_(False),
            ConversationMember.away.is_(False), User.bot_role.is_(None)))).all():
        people.setdefault(member.conversation_id, []).append(user)

    def zone_for(c: Conversation) -> dict:
        """The zone of the new width most of its people are in (or where the community was)."""
        zones = Counter(zone_of(data, u.province, level)["key"] for u in people.get(c.id, []) if u.province)
        if zones:
            key = zones.most_common(1)[0][0]
            return zone_of(data, next(u.province for u in people[c.id] if u.province and zone_of(data, u.province, level)["key"] == key), level)
        return zone_of(data, (c.scope_provinces or [c.province])[0], level)

    async def rekey(c: Conversation, zone: dict) -> None:
        for col, value in scope_values(zone).items():
            setattr(c, col, value)
        if not c.language:
            c.language = zone_language(data, zone)

    width = {c.id: c.scope_kind if c.scope_kind in RANK else "province" for c in convs}
    splits = [c for c in convs if RANK[width[c.id]] < RANK[level]]
    rest = [c for c in convs if c not in splits]
    # free the zone keys first, so two communities never hold the same one at once
    for c in convs:
        c.province = f"tmp:{c.id}"
    await db.flush()

    # wider (or the same): join by zone
    groups: dict[tuple[str, str | None], list[Conversation]] = {}
    zone_by_key: dict[str, dict] = {}
    for c in rest:
        z = zone_for(c)
        zone_by_key[z["key"]] = z
        groups.setdefault((z["key"], c.age_range), []).append(c)
    for (key, age), group in groups.items():
        if len(group) == 1:
            await rekey(group[0], zone_by_key[key])
            continue
        for c in group:
            _archive(c, name, 0)
        await db.flush()
        fresh = await channel_for(db, zone_by_key[key]["provinces"][0] if zone_by_key[key]["provinces"] else key, age or "31_60", interest_id)
        await _move_people_and_board(db, fresh.id, [c.id for c in group])
        for c in group:
            c.policy_json = {**c.policy_json, "archived_into": fresh.id}

    # narrower: split each wide community by its people's zones
    new_ids: set[int] = set()
    for c in splits:
        await rekey(c, zone_for(c))
        await db.flush()
        for u in people.get(c.id, []):
            if not u.province or u.province in (c.scope_provinces or [c.province]):
                continue
            other = await channel_for(db, u.province, user_age_key(u), interest_id)
            if other.id == c.id:
                continue
            if other.id not in {x.id for x in convs} and other.id not in new_ids:
                new_ids.add(other.id)
                await copy_history(db, c.id, other.id)
            await join(db, other, u.id)
            await db.execute(delete(ConversationMember).where(
                ConversationMember.conversation_id == c.id, ConversationMember.user_id == u.id))
    await db.flush()


async def regroup_all_once(db: AsyncSession) -> None:
    """At startup, once: every interest's communities at its width (country by default since 0025). Commits."""
    from app.core.app_settings import get_section, set_section
    done = await get_section(db, "migrations")
    if done.get("geo_levels"):
        return
    for interest_id in (await db.execute(select(Interest.id))).scalars().all():
        interest = await db.get(Interest, interest_id)
        await regroup_geo(db, interest)
        await apply_interest_settings(db, interest, has_span(interest))
    await set_section(db, "migrations", {**done, "geo_levels": True})


async def adult_span_once(db: AsyncSession, slugs: dict[str, int]) -> None:
    """Once: these interests (Economy, Politics) become for every adult from that age, their communities of each zone
    joined with their members and messages. Later changes in the administration are kept. Commits."""
    from app.core.app_settings import get_section, set_section
    done = await get_section(db, "migrations")
    if done.get("adult_span"):
        return
    for slug, min_age in slugs.items():
        interest = (await db.execute(select(Interest).where(Interest.slug == slug))).scalar_one_or_none()
        if interest and not has_span(interest):
            interest.min_age, interest.max_age = min_age, None
            await db.flush()
            await apply_interest_settings(db, interest, had_span=False)
    await set_section(db, "migrations", {**done, "adult_span": True})
