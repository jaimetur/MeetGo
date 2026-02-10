from datetime import datetime
from pydantic import BaseModel, Field
from .models import AgeRange, DMStatus, FriendRequestStatus

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class RegisterIn(BaseModel):
    email: str | None = None
    phone: str | None = None
    password: str | None = None
    display_name: str
    dob: str  # YYYY-MM-DD
    province: str
    city: str | None = None
    accept_dm: bool = False
    avatar_url: str | None = None
    bio: str | None = None

class LoginIn(BaseModel):
    email: str | None = None
    phone: str | None = None
    password: str | None = None

class UserOut(BaseModel):
    id: int
    display_name: str
    dob: str
    age_range: AgeRange
    province: str
    city: str | None
    accept_dm: bool
    avatar_url: str | None
    bio: str | None

class UserSummary(BaseModel):
    id: int
    display_name: str
    avatar_url: str | None

class UpdateProfileIn(BaseModel):
    display_name: str | None = None
    city: str | None = None
    accept_dm: bool | None = None
    avatar_url: str | None = None
    bio: str | None = None

class InterestOut(BaseModel):
    id: int
    slug: str
    name: str

class SetInterestsIn(BaseModel):
    interest_slugs: list[str] = Field(default_factory=list)

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
    created_at: datetime
    is_deleted: bool
    moderation_reason: str | None

class DMRequestOut(BaseModel):
    id: int
    from_user_id: int
    to_user_id: int
    status: DMStatus
    created_at: datetime

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
    created_at: datetime

# Social
class FollowOut(BaseModel):
    follower_id: int
    following_id: int

class FriendRequestOut(BaseModel):
    id: int
    from_user_id: int
    to_user_id: int
    status: FriendRequestStatus
    created_at: datetime

class FriendRequestCreateIn(BaseModel):
    to_user_id: int

class FriendRequestResolveIn(BaseModel):
    accept: bool

class PostOut(BaseModel):
    id: int
    user_id: int
    user: UserSummary
    content: str
    created_at: datetime

class PostCreateIn(BaseModel):
    content: str
