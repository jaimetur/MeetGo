from datetime import datetime, timezone
from typing import Annotated

from pydantic import BaseModel, Field, PlainSerializer
from .models import AgeRange, DMStatus, FriendRequestStatus


def utc_iso(value: datetime) -> str:
    """Serialize as UTC with a trailing Z; stored datetimes without a zone are UTC."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


UTCDateTime = Annotated[datetime, PlainSerializer(utc_iso, return_type=str)]

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    password_temp: bool = False

class RegisterIn(BaseModel):
    email: str
    phone: str
    password: str | None = None
    display_name: str
    dob: str  # YYYY-MM-DD
    country: str | None = None
    province: str
    city: str | None = None
    accept_dm: bool = False
    avatar_url: str | None = None
    bio: str | None = None

class LoginIn(BaseModel):
    email: str
    password: str | None = None

class UserOut(BaseModel):
    id: int
    display_name: str
    dob: str
    age_range: AgeRange
    country: str | None
    province: str
    city: str | None
    accept_dm: bool
    avatar_url: str | None
    bio: str | None

class MeOut(UserOut):
    email: str | None
    dob_change_count: int
    email_verified: bool
    role: str
    phone: str | None
    login_count: int
    last_login_at: UTCDateTime | None
    last_seen_at: UTCDateTime | None
    total_connected_seconds: int
    session_active: bool
    session_started_at: UTCDateTime | None

class UserSummary(BaseModel):
    id: int
    display_name: str
    avatar_url: str | None

class UpdateProfileIn(BaseModel):
    display_name: str | None = None
    email: str | None = None
    password: str | None = None
    dob: str | None = None
    country: str | None = None
    province: str | None = None
    phone: str | None = None
    city: str | None = None
    accept_dm: bool | None = None
    avatar_url: str | None = None
    bio: str | None = None

class ForgotPasswordIn(BaseModel):
    email: str

class ResetPasswordIn(BaseModel):
    token: str
    new_password: str

class VerifyEmailIn(BaseModel):
    token: str

class AdminLoginIn(BaseModel):
    username: str
    password: str

class AdminUserUpdateIn(BaseModel):
    display_name: str | None = None
    email: str | None = None
    phone: str | None = None
    password: str | None = None
    role: str | None = None
    email_verified: bool | None = None
    is_banned: bool | None = None
    banned_until: UTCDateTime | None = None
    dob: str | None = None
    country: str | None = None
    province: str | None = None
    city: str | None = None

class AdminUserCreateIn(BaseModel):
    display_name: str
    email: str
    phone: str
    password: str
    dob: str
    country: str | None = None
    province: str
    city: str | None = None
    role: str | None = None

class InterestOut(BaseModel):
    id: int
    slug: str
    name: str

class SetInterestsIn(BaseModel):
    interest_slugs: list[str] = Field(default_factory=list)

class JoinRoomIn(BaseModel):
    interest_slug: str

class LeaveRoomIn(BaseModel):
    room_id: int

class RoomOut(BaseModel):
    id: int
    province: str
    age_range: AgeRange
    interest: InterestOut

class RoomRuleOut(BaseModel):
    room_id: int
    rules_markdown: str
    policy_json: dict

class RoomRuleUpdateIn(BaseModel):
    rules_markdown: str
    policy_json: dict

class RoomMessageOut(BaseModel):
    id: int
    room_id: int
    user_id: int
    user: UserSummary
    content: str
    created_at: UTCDateTime
    is_deleted: bool
    moderation_reason: str | None

class DMRequestOut(BaseModel):
    id: int
    from_user_id: int
    to_user_id: int
    status: DMStatus
    created_at: UTCDateTime

class DMRequestCreateIn(BaseModel):
    to_user_id: int

class DMRequestResolveIn(BaseModel):
    accept: bool

class DMConversationOut(BaseModel):
    id: int
    user1_id: int
    user2_id: int

class DMMessageOut(BaseModel):
    id: int
    conversation_id: int
    user_id: int
    content: str
    created_at: UTCDateTime

# Social
class FollowOut(BaseModel):
    follower_id: int
    following_id: int

class FriendRequestOut(BaseModel):
    id: int
    from_user_id: int
    to_user_id: int
    status: FriendRequestStatus
    created_at: UTCDateTime

class FriendRequestCreateIn(BaseModel):
    to_user_id: int

class FriendRequestResolveIn(BaseModel):
    accept: bool

class PostOut(BaseModel):
    id: int
    user_id: int
    user: UserSummary
    content: str
    created_at: UTCDateTime

class PostCreateIn(BaseModel):
    content: str

class AdminInterestIn(BaseModel):
    slug: str
    name: str

class AdminSmtpTestIn(BaseModel):
    to_email: str
