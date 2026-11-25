import enum
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def naive_utcnow() -> datetime:
    """For the original tables, which store UTC without a zone."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgeRange(str, enum.Enum):
    R18_30 = "18_30"
    R31_60 = "31_60"
    R61_PLUS = "61_plus"
    # Earlier ranges (18-30, 31-50, 51+).
    R31_50 = "31_50"
    R51_PLUS = "51_plus"
    # Backwards compatibility with existing DB values.
    R31_55 = "31_55"
    R55_PLUS = "55_plus"
    # Legacy prefixed values from older enums.
    R18_30_LEGACY = "R18_30"
    R31_50_LEGACY = "R31_50"
    R51_PLUS_LEGACY = "R51_PLUS"
    R31_55_LEGACY = "R31_55"
    R55_PLUS_LEGACY = "R55_PLUS"


class DMStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class FriendRequestStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"


class ConversationKind(str, enum.Enum):
    CHANNEL = "channel"
    GROUP = "group"
    DM = "dm"


class MemberRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MODERATOR = "moderator"
    MEMBER = "member"


STAFF_ROLES = {MemberRole.OWNER.value, MemberRole.ADMIN.value, MemberRole.MODERATOR.value}


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)

    display_name: Mapped[str] = mapped_column(String(64))
    dob: Mapped[str] = mapped_column(String(10))  # YYYY-MM-DD
    age_range: Mapped[AgeRange] = mapped_column(
        Enum(AgeRange, values_callable=lambda obj: [e.value for e in obj], name="agerange"),
        index=True,
    )
    country: Mapped[str | None] = mapped_column(String(2), index=True, nullable=True)
    province: Mapped[str] = mapped_column(String(64), index=True)
    city: Mapped[str | None] = mapped_column(String(64), nullable=True)
    dob_change_count: Mapped[int] = mapped_column(Integer, default=0)

    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)

    accept_dm: Mapped[bool] = mapped_column(Boolean, default=False)
    # Privacy, as in WhatsApp: blue ticks (read receipts in direct messages) and who sees my "last seen" (all, friends,
    # nobody); both work both ways: switching them off hides the others' too.
    read_receipts: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen_privacy: Mapped[str] = mapped_column(String(16), default="all")
    calendar_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)  # my plans as a calendar feed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)
    role: Mapped[str] = mapped_column(String(32), default="user", index=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    email_verification_token: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    email_verification_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reset_token: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    reset_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_temp: Mapped[bool] = mapped_column(Boolean, default=False)
    phone_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    login_count: Mapped[int] = mapped_column(Integer, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    session_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    session_active: Mapped[bool] = mapped_column(Boolean, default=False)
    total_connected_seconds: Mapped[int] = mapped_column(Integer, default=0)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False)
    banned_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Accounts created while subscriptions are enabled need an active plan or grant to write.
    access_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Automatic emails: language of the person (es/en), their choices ({"mentions": bool, ...}; missing keys use the
    # defaults) and when the last digest of unread messages went out.
    lang: Mapped[str] = mapped_column(String(8), default="es", server_default="es")
    email_prefs: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    last_digest_email_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bot accounts (bot-admin, bot-moderator): the role they have in every community; None for people.
    bot_role: Mapped[str | None] = mapped_column(String(16), nullable=True)


class Interest(Base):
    __tablename__ = "interests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    # Set in the administration; empty means automatic (guessed from the name in the app).
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(32), nullable=True)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Restrictions: the age ranges it exists for (empty = all) and whether it is open at all.
    age_ranges: Mapped[list] = mapped_column(JSONB, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Interests (slugs) this community is about, 1-5 including its own: people with any of them get it suggested.
    tags: Mapped[list] = mapped_column(JSONB, default=list)
    # The settings of its communities (every zone), as in a community made by people: an age span instead of the fixed
    # ranges (then one community per province), who joins, who posts on the board, how long the chat keeps messages.
    min_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    access_mode: Mapped[str] = mapped_column(String(16), default="open")
    board_mode: Mapped[str] = mapped_column(String(16), default="open")
    retention_days: Mapped[int] = mapped_column(Integer, default=365)
    join_questions: Mapped[list] = mapped_column(JSONB, default=list)


class UserInterest(Base):
    __tablename__ = "user_interests"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    interest_id: Mapped[int] = mapped_column(ForeignKey("interests.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)


class DMRequest(Base):
    __tablename__ = "dm_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[DMStatus] = mapped_column(Enum(DMStatus), default=DMStatus.PENDING, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UserBlock(Base):
    """Someone I blocked: no direct messages, requests or follows between us, and I do not see what they write."""
    __tablename__ = "user_blocks"
    blocker_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    blocked_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Follow(Base):
    __tablename__ = "follows"
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    following_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)


class FriendRequest(Base):
    __tablename__ = "friend_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[FriendRequestStatus] = mapped_column(Enum(FriendRequestStatus), default=FriendRequestStatus.PENDING, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Friendship(Base):
    __tablename__ = "friendships"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    friend_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)


class Post(Base):
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=naive_utcnow)


class AppSetting(Base):
    __tablename__ = "app_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)


# ---------------- Messaging ----------------

class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Channels: the zone they belong to.
    province: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    age_range: Mapped[str | None] = mapped_column(String(16), nullable=True)
    interest_id: Mapped[int | None] = mapped_column(ForeignKey("interests.id"), nullable=True, index=True)
    # Direct messages: "<smaller user id>:<larger user id>".
    dm_key: Mapped[str | None] = mapped_column(String(40), nullable=True, unique=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    slow_mode_seconds: Mapped[int] = mapped_column(Integer, default=0)
    rules_markdown: Mapped[str] = mapped_column(Text, default="")
    policy_json: Mapped[dict] = mapped_column(JSONB, default=dict)
    invite_code: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)
    # Communities made by people may admit an age span (from the date of birth) instead of their creator's range.
    # Communities: how many days their chat keeps its messages (older ones are deleted); None keeps them.
    # Communities made by people: the interests (slugs, up to 5) they are about, to suggest them to people.
    interest_tags: Mapped[list] = mapped_column(JSONB, default=list)
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pinned_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    legacy_room_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    legacy_dm_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    # Communities (channels): who joins (open | request | invite) and who publishes on the board (open | admins).
    access_mode: Mapped[str] = mapped_column(String(16), default="open", server_default="open")
    board_mode: Mapped[str] = mapped_column(String(16), default="open", server_default="open")
    __table_args__ = (UniqueConstraint("province", "age_range", "interest_id", name="uq_channel_key"),)


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default=MemberRole.MEMBER.value)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_delivered_message_id: Mapped[int] = mapped_column(BigInteger, default=0)  # reached the person's app (✓✓)
    last_read_message_id: Mapped[int] = mapped_column(BigInteger, default=0)
    notify: Mapped[str] = mapped_column(String(16), default="all")  # all | mentions | none
    muted_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    hidden: Mapped[bool] = mapped_column(Boolean, default=False)
    # Moderation inside this conversation.
    strikes: Mapped[int] = mapped_column(Integer, default=0)
    last_strike_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    silenced_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    banned: Mapped[bool] = mapped_column(Boolean, default=False)
    # Temporary ban in a community: until then the person reads but cannot write (chat, board, comments).
    ban_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Newest message already covered by an email, so a digest never repeats a message.
    email_notified_message_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    # Channel of a zone the person has left: kept (with its role) but hidden, silent and read-only until they return.
    away: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # The person deleted the chat for themselves: messages up to this one are not shown to them.
    cleared_message_id: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    sender_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="text")  # text | system
    body: Mapped[str] = mapped_column(Text, default="")
    reply_to_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    thread_root_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    thread_reply_count: Mapped[int] = mapped_column(Integer, default=0)
    thread_last_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    also_in_channel: Mapped[bool] = mapped_column(Boolean, default=False)
    mentions: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=func.now())
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    moderation_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    __table_args__ = (
        Index("ix_messages_conversation_id_id", "conversation_id", "id"),
        UniqueConstraint("sender_id", "client_id", name="uq_message_client_id"),
    )


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReceiptMark(Base):
    """When a member's ✓✓ (delivered) or blue ✓✓ (read) moved up to a message, in direct messages and groups: a message
    was delivered / read by them at the first mark at or after it (the message's Info, as in WhatsApp)."""
    __tablename__ = "receipt_marks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(10))  # delivered | read
    message_id: Mapped[int] = mapped_column(BigInteger)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (Index("ix_receipt_marks_lookup", "conversation_id", "user_id", "kind", "message_id"),)


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=True, index=True)
    uploader_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    storage_key: Mapped[str] = mapped_column(String(255))
    thumb_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str] = mapped_column(String(128))
    size: Mapped[int] = mapped_column(Integer)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Device(Base):
    __tablename__ = "devices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # fcm | webpush
    token: Mapped[str] = mapped_column(Text, unique=True)  # FCM token or Web Push endpoint
    keys: Mapped[dict] = mapped_column(JSONB, default=dict)  # Web Push p256dh/auth
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Report(Base):
    """A reported message or, with post_id, a reported board post."""
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True, nullable=True)
    post_id: Mapped[int | None] = mapped_column(ForeignKey("board_posts.id", ondelete="CASCADE"), index=True, nullable=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(64))
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open | dismissed | actioned
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("message_id", "reporter_id", name="uq_report_once"),
                      UniqueConstraint("post_id", "reporter_id", name="uq_report_post_once"))


# ---------------- Communities and board ----------------

class CommunityRequest(Base):
    """Someone asking to join a community in "request" mode."""
    __tablename__ = "community_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending | accepted | rejected
    answers: Mapped[list] = mapped_column(JSONB, default=list)  # to the community's join questions
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class BoardPost(Base):
    __tablename__ = "board_posts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)  # thread | meetup | event | notice
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text, default="")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    place: Mapped[str | None] = mapped_column(String(200), nullable=True)
    place_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    link_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    cover_attachment_id: Mapped[int | None] = mapped_column(ForeignKey("attachments.id", ondelete="SET NULL"), nullable=True)
    comments_mode: Mapped[str] = mapped_column(String(16), default="all")  # all | attendees | off
    join_mode: Mapped[str] = mapped_column(String(16), default="open")  # open | approval
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    closed: Mapped[bool] = mapped_column(Boolean, default=False)
    chat_conversation_id: Mapped[int | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    # in_person | online | hybrid; the video call link is shown only to the people going.
    mode: Mapped[str] = mapped_column(String(16), default="in_person")
    online_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    max_guests: Mapped[int] = mapped_column(Integer, default=0)  # companions each person may bring (+1, +2…)
    series_id: Mapped[int | None] = mapped_column(ForeignKey("board_series.id", ondelete="SET NULL"), nullable=True, index=True)
    cohost_ids: Mapped[list] = mapped_column(JSONB, default=list)  # co-organisers: manage the plan like its author
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BoardSeries(Base):
    """A plan that repeats: each date is a plan of its own (attendees, chat), made a few weeks ahead from `template`."""
    __tablename__ = "board_series"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    freq: Mapped[str] = mapped_column(String(16))  # weekly | biweekly | monthly
    tz: Mapped[str] = mapped_column(String(64), default="Europe/Madrid")
    first_starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    template: Mapped[dict] = mapped_column(JSONB, default=dict)
    ended: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BoardAttendee(Base):
    __tablename__ = "board_attendees"
    post_id: Mapped[int] = mapped_column(ForeignKey("board_posts.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    status: Mapped[str] = mapped_column(String(16))  # going | waitlist | pending
    guests: Mapped[int] = mapped_column(Integer, default=0)  # companions (+1, +2…), they take places too
    attended: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # check-in by the organisers
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 1-5, after the plan, seen by organisers
    rating_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BoardComment(Base):
    __tablename__ = "board_comments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("board_posts.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# ---------------- Subscriptions ----------------

class PromoCode(Base):
    __tablename__ = "promo_codes"
    code: Mapped[str] = mapped_column(String(64), primary_key=True)  # normalised, upper case
    aliases: Mapped[list] = mapped_column(JSONB, default=list)
    duration: Mapped[str] = mapped_column(String(16), default="1y")  # 1m | 3m | 6m | 1y | life | YYYY-MM-DD
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used: Mapped[int] = mapped_column(Integer, default=0)
    public: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_on: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD, last valid day
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AccessGrant(Base):
    __tablename__ = "access_grants"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    source: Mapped[str] = mapped_column(String(64))  # promo code or "admin"
    until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # None: for life
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StripeSubscription(Base):
    __tablename__ = "stripe_subscriptions"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    customer_id: Mapped[str] = mapped_column(String(64))
    subscription_id: Mapped[str] = mapped_column(String(64), unique=True)
    plan: Mapped[str] = mapped_column(String(16))  # monthly | yearly
    status: Mapped[str] = mapped_column(String(32))
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlaySubscription(Base):
    __tablename__ = "play_subscriptions"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    token_enc: Mapped[str] = mapped_column(Text)
    product_id: Mapped[str] = mapped_column(String(64))
    base_plan: Mapped[str | None] = mapped_column(String(32), nullable=True)
    state: Mapped[str] = mapped_column(String(48))
    expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmailNotice(Base):
    """One-off automatic emails already sent (for example "your free year ends in 7 days"), so they go out once."""
    __tablename__ = "email_notices"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(96), primary_key=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
