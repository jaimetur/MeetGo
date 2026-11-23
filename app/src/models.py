import enum
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger, Boolean, DateTime, Enum, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def naive_utcnow() -> datetime:
    """For the original tables, which store UTC without a zone."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AgeRange(str, enum.Enum):
    R18_30 = "18_30"
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


class Interest(Base):
    __tablename__ = "interests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))


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
    pinned_message_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    legacy_room_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    legacy_dm_id: Mapped[int | None] = mapped_column(Integer, nullable=True, unique=True)
    __table_args__ = (UniqueConstraint("province", "age_range", "interest_id", name="uq_channel_key"),)


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default=MemberRole.MEMBER.value)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
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
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    reporter_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    reason: Mapped[str] = mapped_column(String(64))
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)  # open | dismissed | actioned
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    resolved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    __table_args__ = (UniqueConstraint("message_id", "reporter_id", name="uq_report_once"),)


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
