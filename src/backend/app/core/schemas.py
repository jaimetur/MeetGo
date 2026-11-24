from datetime import datetime, timezone
from typing import Annotated

from pydantic import BaseModel, Field, PlainSerializer
from app.core.models import AgeRange, DMStatus, FriendRequestStatus


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
    promo_code: str | None = None

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
    bot_role: str | None = None  # bot-admin / bot-moderator accounts
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
    # Which automatic emails the person gets (mentions, messages, requests and, for administrators, reports).
    email_prefs: dict[str, bool] = Field(default_factory=dict)

class EmailPrefsIn(BaseModel):
    mentions: bool | None = None
    messages: bool | None = None
    requests: bool | None = None
    reports: bool | None = None
    plans: bool | None = None

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

class DeleteMeIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class BanIn(BaseModel):
    hours: int | None = Field(default=None, ge=1, le=24 * 365)  # None: for good


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
    category: str | None = None
    icon: str | None = None
    color: str | None = None
    age_ranges: list[str] = Field(default_factory=list)
    active: bool = True

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
    category: str | None = None
    icon: str | None = None
    color: str | None = None
    age_ranges: list[str] | None = None
    active: bool | None = None

class AdminSmtpTestIn(BaseModel):
    to_email: str


# ---------------- Messaging ----------------

class GroupCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    member_ids: list[int] = Field(default_factory=list, max_length=200)


class ConversationUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    avatar_url: str | None = Field(default=None, max_length=512)
    slow_mode_seconds: int | None = Field(default=None, ge=0, le=3600)
    rules_markdown: str | None = Field(default=None, max_length=4000)
    pinned_message_id: int | None = None


class MembersAddIn(BaseModel):
    user_ids: list[int] = Field(min_length=1, max_length=200)


class MemberRoleIn(BaseModel):
    role: str = Field(pattern="^(admin|moderator|member)$")


class MemberSettingsIn(BaseModel):
    notify: str | None = Field(default=None, pattern="^(all|mentions|none)$")
    mute_minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 365)
    pinned: bool | None = None


class ModerateIn(BaseModel):
    action: str = Field(pattern="^(silence|unsilence|ban|unban|remove)$")
    minutes: int = Field(default=60, ge=1, le=60 * 24 * 30)


class MessageCreateIn(BaseModel):
    body: str = Field(default="", max_length=8000)
    client_id: str | None = Field(default=None, max_length=64)
    reply_to_id: int | None = None
    thread_root_id: int | None = None
    also_in_channel: bool = False
    mention_ids: list[int] = Field(default_factory=list, max_length=50)
    attachment_ids: list[int] = Field(default_factory=list, max_length=10)


class MessageEditIn(BaseModel):
    body: str = Field(max_length=8000)


class ReadIn(BaseModel):
    message_id: int


class ReportIn(BaseModel):
    reason: str = Field(pattern="^(child_safety|spam|harassment|hate|sexual|violence|other)$")
    details: str | None = Field(default=None, max_length=1000)


class DMOpenIn(BaseModel):
    user_id: int


class DeviceIn(BaseModel):
    kind: str = Field(pattern="^(fcm|webpush)$")
    token: str = Field(min_length=10, max_length=4096)
    keys: dict = Field(default_factory=dict)


# ---------------- Subscriptions ----------------

class RedeemIn(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class CheckoutIn(BaseModel):
    plan: str = Field(pattern="^(monthly|yearly)$")


class CompleteIn(BaseModel):
    session_id: str = Field(min_length=5, max_length=255)


class PlayLinkIn(BaseModel):
    token: str = Field(min_length=10, max_length=4096)
    product: str | None = Field(default=None, max_length=64)


class AdminAccessIn(BaseModel):
    free_until: str = Field(pattern=r"^(lifetime|none|\d{4}-\d{2}-\d{2})$")


class PromoCodeIn(BaseModel):
    code: str = Field(min_length=2, max_length=64)
    aliases: list[str] = Field(default_factory=list, max_length=10)
    duration: str = Field(pattern=r"^(1m|3m|6m|1y|life|\d{4}-\d{2}-\d{2})$")
    max_uses: int | None = Field(default=None, ge=1)
    public: bool = False
    expires_on: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class ReportResolveIn(BaseModel):
    status: str = Field(pattern="^(dismissed|actioned)$")
    delete_message: bool = False


# ---------------- Communities and board ----------------

class CommunityCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    avatar_url: str | None = Field(default=None, max_length=512)
    access_mode: str = Field(default="open", pattern="^(open|request|invite)$")
    board_mode: str = Field(default="open", pattern="^(open|admins)$")
    min_age: int | None = Field(default=None, ge=18, le=120)
    max_age: int | None = Field(default=None, ge=18, le=120)
    join_questions: list[str] | None = Field(default=None, max_length=3)


class CommunityUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    avatar_url: str | None = Field(default=None, max_length=512)
    access_mode: str | None = Field(default=None, pattern="^(open|request|invite)$")
    board_mode: str | None = Field(default=None, pattern="^(open|admins)$")
    rules: str | None = Field(default=None, max_length=4000)
    join_questions: list[str] | None = Field(default=None, max_length=3)


class JoinIn(BaseModel):
    answers: list[str] = Field(default_factory=list, max_length=3)


class ResolveIn(BaseModel):
    accept: bool


class BoardPostIn(BaseModel):
    kind: str = Field(pattern="^(thread|meetup|event|notice)$")
    title: str = Field(min_length=1, max_length=160)
    body: str | None = Field(default=None, max_length=8000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    place: str | None = Field(default=None, max_length=200)
    place_url: str | None = Field(default=None, max_length=512)
    capacity: int | None = Field(default=None, ge=1, le=10000)
    link_url: str | None = Field(default=None, max_length=512)
    cover_attachment_id: int | None = None
    comments_mode: str | None = Field(default=None, pattern="^(all|attendees|off)$")
    join_mode: str | None = Field(default=None, pattern="^(open|approval)$")
    mode: str | None = Field(default=None, pattern="^(in_person|online|hybrid)$")
    online_url: str | None = Field(default=None, max_length=512)
    max_guests: int | None = Field(default=None, ge=0, le=5)
    repeat: str | None = Field(default=None, pattern="^(weekly|biweekly|monthly)$")
    repeat_until: datetime | None = None
    tz: str | None = Field(default=None, max_length=64)


class BoardPostUpdateIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    body: str | None = Field(default=None, max_length=8000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    place: str | None = Field(default=None, max_length=200)
    place_url: str | None = Field(default=None, max_length=512)
    capacity: int | None = Field(default=None, ge=0, le=10000)  # 0: no limit
    link_url: str | None = Field(default=None, max_length=512)
    cover_attachment_id: int | None = None  # 0: no cover
    comments_mode: str | None = Field(default=None, pattern="^(all|attendees|off)$")
    join_mode: str | None = Field(default=None, pattern="^(open|approval)$")
    pinned: bool | None = None
    closed: bool | None = None
    mode: str | None = Field(default=None, pattern="^(in_person|online|hybrid)$")
    online_url: str | None = Field(default=None, max_length=512)
    max_guests: int | None = Field(default=None, ge=0, le=5)
    scope: str | None = Field(default=None, pattern="^(one|following)$")  # a plan that repeats: this date or the following ones too


class AttendIn(BaseModel):
    guests: int = Field(default=0, ge=0, le=5)


class CheckinIn(BaseModel):
    attended: bool | None = None


class RatingIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    note: str | None = Field(default=None, max_length=1000)


class CohostsIn(BaseModel):
    user_ids: list[int] = Field(default_factory=list, max_length=10)


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
