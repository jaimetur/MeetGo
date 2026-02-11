import enum
from datetime import datetime
from sqlalchemy import (
    String, Integer, DateTime, Boolean, ForeignKey, Text, UniqueConstraint, Enum, JSON
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

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

    # Profile
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)

    accept_dm: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_active_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
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

class Interest(Base):
    __tablename__ = "interests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))

class UserInterest(Base):
    __tablename__ = "user_interests"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    interest_id: Mapped[int] = mapped_column(ForeignKey("interests.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    province: Mapped[str] = mapped_column(String(64), index=True)
    age_range: Mapped[AgeRange] = mapped_column(
        Enum(AgeRange, values_callable=lambda obj: [e.value for e in obj], name="agerange"),
        index=True,
    )
    interest_id: Mapped[int] = mapped_column(ForeignKey("interests.id"), index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    interest = relationship("Interest")
    __table_args__ = (UniqueConstraint("province", "age_range", "interest_id", name="uq_room_key"),)

class RoomRule(Base):
    __tablename__ = "room_rules"
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), primary_key=True)
    rules_markdown: Mapped[str] = mapped_column(Text, default="")
    policy_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

class RoomDiscipline(Base):
    __tablename__ = "room_discipline"
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    strikes: Mapped[int] = mapped_column(Integer, default=0)
    last_strike_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    muted_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class RoomMessage(Base):
    __tablename__ = "room_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    moderation_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)

class DMRequest(Base):
    __tablename__ = "dm_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[DMStatus] = mapped_column(Enum(DMStatus), default=DMStatus.PENDING, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

class DMConversation(Base):
    __tablename__ = "dm_conversations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user1_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    user2_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user1_id", "user2_id", name="uq_dm_pair"),)

class DMMessage(Base):
    __tablename__ = "dm_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("dm_conversations.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

# Social: follow + friend requests + feed posts
class Follow(Base):
    __tablename__ = "follows"
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    following_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class FriendRequest(Base):
    __tablename__ = "friend_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    from_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    to_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[FriendRequestStatus] = mapped_column(Enum(FriendRequestStatus), default=FriendRequestStatus.PENDING, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

class Friendship(Base):
    __tablename__ = "friendships"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    friend_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Post(Base):
    __tablename__ = "posts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class AppSetting(Base):
    __tablename__ = "app_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
