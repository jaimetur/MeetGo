from datetime import datetime, date
from fastapi import FastAPI, Depends, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, delete, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as redis

from .config import settings
from .db import Base, engine
from .deps import get_db, get_current_user
from .models import (
    User, Interest, UserInterest, Room, RoomRule, RoomMessage,
    DMRequest, DMConversation, DMMessage, DMStatus,
    Follow, FriendRequest, FriendRequestStatus, Friendship, Post
)
from .schemas import (
    RegisterIn, LoginIn, Token, UserOut, UserSummary, UpdateProfileIn,
    InterestOut, SetInterestsIn, JoinRoomIn, RoomOut, RoomRuleOut, RoomRuleUpdateIn, RoomMessageOut,
    DMRequestOut, DMRequestCreateIn, DMRequestResolveIn, DMConversationOut, DMMessageOut,
    FollowOut, FriendRequestOut, FriendRequestCreateIn, FriendRequestResolveIn,
    PostOut, PostCreateIn
)
from .security import hash_password, verify_password, create_access_token, decode_token
from .utils import age_range_from_dob
from .chat import room_ws_loop

app = FastAPI(title="MeetGo Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _user_out(u: User) -> UserOut:
    return UserOut(
        id=u.id,
        display_name=u.display_name,
        dob=u.dob,
        age_range=u.age_range,
        province=u.province,
        city=u.city,
        accept_dm=u.accept_dm,
        avatar_url=u.avatar_url,
        bio=u.bio,
    )

def _user_summary(u: User) -> UserSummary:
    return UserSummary(id=u.id, display_name=u.display_name, avatar_url=u.avatar_url)

def _interest_out(i: Interest) -> InterestOut:
    return InterestOut(id=i.id, slug=i.slug, name=i.name)

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Seed interests
    async with AsyncSession(engine) as db:
        defaults = [
            ("cafe", "Quedar para un café"),
            ("senderismo", "Senderismo"),
            ("cine", "Cine"),
            ("deporte", "Deporte"),
            ("networking", "Networking"),
        ]
        for slug, name in defaults:
            res = await db.execute(select(Interest).where(Interest.slug == slug))
            if not res.scalar_one_or_none():
                db.add(Interest(slug=slug, name=name))
        await db.commit()

# ---------------- Auth ----------------
@app.post("/auth/register", response_model=UserOut)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not payload.email and not payload.phone:
        raise HTTPException(400, "Provide email or phone")
    ar = age_range_from_dob(payload.dob)

    if payload.email:
        res = await db.execute(select(User).where(User.email == payload.email))
        if res.scalar_one_or_none():
            raise HTTPException(409, "Email already used")
    if payload.phone:
        res = await db.execute(select(User).where(User.phone == payload.phone))
        if res.scalar_one_or_none():
            raise HTTPException(409, "Phone already used")

    u = User(
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password) if payload.password else None,
        display_name=payload.display_name,
        dob=payload.dob,
        age_range=ar,
        province=payload.province.strip(),
        city=(payload.city.strip() if payload.city else None),
        accept_dm=bool(payload.accept_dm),
        avatar_url=payload.avatar_url,
        bio=payload.bio,
    )
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return _user_out(u)

@app.post("/auth/login", response_model=Token)
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)):
    if not payload.email and not payload.phone:
        raise HTTPException(400, "Provide email or phone")
    q = select(User)
    if payload.email:
        q = q.where(User.email == payload.email)
    else:
        q = q.where(User.phone == payload.phone)
    res = await db.execute(q)
    u = res.scalar_one_or_none()
    if not u:
        raise HTTPException(401, "Invalid credentials")
    if u.password_hash and payload.password:
        if not verify_password(payload.password, u.password_hash):
            raise HTTPException(401, "Invalid credentials")
    elif u.password_hash and not payload.password:
        raise HTTPException(401, "Password required")
    return Token(access_token=create_access_token(str(u.id)))

@app.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return _user_out(user)

@app.patch("/me/profile", response_model=UserOut)
async def update_profile(payload: UpdateProfileIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.city is not None:
        user.city = payload.city.strip() if payload.city else None
    if payload.accept_dm is not None:
        user.accept_dm = bool(payload.accept_dm)
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    if payload.bio is not None:
        user.bio = payload.bio
    user.last_active_at = datetime.utcnow()
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_out(user)

# Public profile
@app.get("/users/{user_id}", response_model=UserOut)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db), me_user: User = Depends(get_current_user)):
    res = await db.execute(select(User).where(User.id == user_id))
    u = res.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    # Optional privacy: restrict to same province
    if u.province != me_user.province:
        raise HTTPException(403, "Forbidden (different province)")
    return _user_out(u)

# ---------------- Interests ----------------
@app.get("/interests", response_model=list[InterestOut])
async def list_interests(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Interest).order_by(Interest.name))
    return [_interest_out(i) for i in res.scalars().all()]

@app.post("/me/interests", response_model=dict)
async def set_my_interests(payload: SetInterestsIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(UserInterest).where(UserInterest.user_id == user.id))
    if payload.interest_slugs:
        res = await db.execute(select(Interest).where(Interest.slug.in_(payload.interest_slugs)))
        interests = res.scalars().all()
        for it in interests:
            db.add(UserInterest(user_id=user.id, interest_id=it.id))
    await db.commit()
    return {"ok": True}

# ---------------- Rooms ----------------
async def _get_or_create_room(db: AsyncSession, province: str, age_range, interest_id: int) -> Room:
    res = await db.execute(select(Room).where(Room.province == province, Room.age_range == age_range, Room.interest_id == interest_id))
    room = res.scalar_one_or_none()
    if room:
        return room
    room = Room(province=province, age_range=age_range, interest_id=interest_id)
    db.add(room)
    await db.flush()

    default_rules = (
        "- Respeto. Cero acoso.\n"
        "- No spam ni autopromo.\n"
        "- No compartas teléfono en la sala; usa privado si procede.\n"
        "- Si incumples, el bot puede borrar, silenciar o banear.\n"
    )
    default_policy = {
        "max_messages_per_minute": settings.DEFAULT_MAX_MSGS_PER_MIN,
        "block_links": True,
        "block_phone_numbers": True,
        "caps_ratio_threshold": settings.DEFAULT_CAPS_RATIO_THRESHOLD,
        "strike_policy": {"warn": 1, "mute": 2, "ban": 4, "decay_days": 30},
        "mute_durations_minutes": [10, 60, 1440],
    }
    db.add(RoomRule(room_id=room.id, rules_markdown=default_rules, policy_json=default_policy))
    await db.commit()
    await db.refresh(room)
    return room

@app.get("/rooms/my", response_model=list[RoomOut])
async def my_rooms(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(UserInterest.interest_id).where(UserInterest.user_id == user.id))
    interest_ids = list(res.scalars().all())
    if not interest_ids:
        return []
    res = await db.execute(select(Interest).where(Interest.id.in_(interest_ids)))
    interests = res.scalars().all()

    rooms = []
    for it in interests:
        room = await _get_or_create_room(db, user.province, user.age_range, it.id)
        rooms.append(RoomOut(id=room.id, province=room.province, age_range=room.age_range, interest=_interest_out(it)))
    return rooms

@app.post("/rooms/join", response_model=RoomOut)
async def join_room(payload: JoinRoomIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Interest).where(Interest.slug == payload.interest_slug))
    interest = res.scalar_one_or_none()
    if not interest:
        raise HTTPException(404, "Interest not found")

    res = await db.execute(select(UserInterest).where(UserInterest.user_id == user.id, UserInterest.interest_id == interest.id))
    if not res.scalar_one_or_none():
        db.add(UserInterest(user_id=user.id, interest_id=interest.id))

    room = await _get_or_create_room(db, user.province, user.age_range, interest.id)
    return RoomOut(id=room.id, province=room.province, age_range=room.age_range, interest=_interest_out(interest))

@app.get("/rooms/{room_id}/rules", response_model=RoomRuleOut)
async def get_room_rules(room_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Room).where(Room.id == room_id))
    room = res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Room not found")
    if room.province != user.province or room.age_range != user.age_range:
        raise HTTPException(403, "Forbidden")
    res = await db.execute(select(RoomRule).where(RoomRule.room_id == room_id))
    rule = res.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, "Rules not found")
    return RoomRuleOut(room_id=rule.room_id, rules_markdown=rule.rules_markdown, policy_json=rule.policy_json or {})

@app.get("/rooms/{room_id}/messages", response_model=list[RoomMessageOut])
async def list_room_messages(room_id: int, limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Room).where(Room.id == room_id))
    room = res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, "Room not found")
    if room.province != user.province or room.age_range != user.age_range:
        raise HTTPException(403, "Forbidden")

    res = await db.execute(select(RoomMessage).where(RoomMessage.room_id == room_id).order_by(RoomMessage.id.desc()).limit(limit))
    msgs = list(reversed(res.scalars().all()))

    # Fetch user summaries in one shot
    user_ids = sorted({m.user_id for m in msgs})
    users_map = {}
    if user_ids:
        resu = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in resu.scalars().all():
            users_map[u.id] = _user_summary(u)

    out = []
    for m in msgs:
        out.append(RoomMessageOut(
            id=m.id,
            room_id=m.room_id,
            user_id=m.user_id,
            user=users_map.get(m.user_id) or UserSummary(id=m.user_id, display_name="Unknown", avatar_url=None),
            content="" if m.is_deleted else m.content,
            created_at=m.created_at,
            is_deleted=m.is_deleted,
            moderation_reason=m.moderation_reason,
        ))
    return out

@app.websocket("/ws/rooms/{room_id}")
async def room_ws(room_id: int, websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008); return

    redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    async with AsyncSession(engine) as db:
        try:
            user_id = int(decode_token(token))
        except Exception:
            await websocket.close(code=1008); return

        # access control
        res = await db.execute(select(Room).where(Room.id == room_id))
        room = res.scalar_one_or_none()
        if not room:
            await websocket.close(code=1008); return
        res = await db.execute(select(User).where(User.id == user_id))
        u = res.scalar_one_or_none()
        if not u or room.province != u.province or room.age_range != u.age_range:
            await websocket.close(code=1008); return

        await room_ws_loop(websocket, room_id, user_id, db, redis_client)

# ---------------- DMs (requests + messages) ----------------
async def _dm_daily_key(user_id: int) -> str:
    today = date.today().isoformat()
    return f"dm_opened:{user_id}:{today}"

@app.post("/dm/requests", response_model=DMRequestOut)
async def create_dm_request(payload: DMRequestCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.to_user_id == user.id:
        raise HTTPException(400, "Cannot DM yourself")

    res = await db.execute(select(User).where(User.id == payload.to_user_id))
    other = res.scalar_one_or_none()
    if not other:
        raise HTTPException(404, "User not found")
    if not other.accept_dm:
        raise HTTPException(403, "User does not accept DMs")

    redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    key = await _dm_daily_key(user.id)
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, 60 * 60 * 26)
    if count > 10:
        raise HTTPException(429, "Daily DM limit reached (10)")

    res = await db.execute(select(DMRequest).where(DMRequest.from_user_id == user.id, DMRequest.to_user_id == other.id, DMRequest.status == DMStatus.PENDING))
    if res.scalar_one_or_none():
        raise HTTPException(409, "DM request already pending")

    req = DMRequest(from_user_id=user.id, to_user_id=other.id, status=DMStatus.PENDING)
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return DMRequestOut(id=req.id, from_user_id=req.from_user_id, to_user_id=req.to_user_id, status=req.status, created_at=req.created_at)

@app.get("/dm/requests/incoming", response_model=list[DMRequestOut])
async def list_incoming(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMRequest).where(DMRequest.to_user_id == user.id, DMRequest.status == DMStatus.PENDING).order_by(DMRequest.id.desc()))
    return [DMRequestOut(id=r.id, from_user_id=r.from_user_id, to_user_id=r.to_user_id, status=r.status, created_at=r.created_at) for r in res.scalars().all()]

@app.post("/dm/requests/{request_id}/resolve", response_model=dict)
async def resolve_request(request_id: int, payload: DMRequestResolveIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMRequest).where(DMRequest.id == request_id))
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Request not found")
    if req.to_user_id != user.id:
        raise HTTPException(403, "Forbidden")
    if req.status != DMStatus.PENDING:
        raise HTTPException(409, "Already resolved")

    req.status = DMStatus.ACCEPTED if payload.accept else DMStatus.REJECTED
    req.resolved_at = datetime.utcnow()

    conv_id = None
    if req.status == DMStatus.ACCEPTED:
        u1, u2 = sorted([req.from_user_id, req.to_user_id])
        res = await db.execute(select(DMConversation).where(DMConversation.user1_id == u1, DMConversation.user2_id == u2))
        conv = res.scalar_one_or_none()
        if not conv:
            conv = DMConversation(user1_id=u1, user2_id=u2)
            db.add(conv); await db.flush()
        conv_id = conv.id

    await db.commit()
    return {"ok": True, "conversation_id": conv_id}

@app.get("/dm/conversations", response_model=list[DMConversationOut])
async def list_conversations(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMConversation).where(or_(DMConversation.user1_id == user.id, DMConversation.user2_id == user.id)).order_by(DMConversation.id.desc()))
    return [DMConversationOut(id=c.id, user1_id=c.user1_id, user2_id=c.user2_id) for c in res.scalars().all()]

@app.get("/dm/conversations/{conv_id}/messages", response_model=list[DMMessageOut])
async def list_dm_messages(conv_id: int, limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMConversation).where(DMConversation.id == conv_id))
    conv = res.scalar_one_or_none()
    if not conv or (conv.user1_id != user.id and conv.user2_id != user.id):
        raise HTTPException(404, "Conversation not found")
    res = await db.execute(select(DMMessage).where(DMMessage.conversation_id == conv_id).order_by(DMMessage.id.desc()).limit(limit))
    msgs = list(reversed(res.scalars().all()))
    return [DMMessageOut(id=m.id, conversation_id=m.conversation_id, user_id=m.user_id, content=m.content, created_at=m.created_at) for m in msgs]

@app.post("/dm/conversations/{conv_id}/messages", response_model=DMMessageOut)
async def send_dm_message(conv_id: int, content: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMConversation).where(DMConversation.id == conv_id))
    conv = res.scalar_one_or_none()
    if not conv or (conv.user1_id != user.id and conv.user2_id != user.id):
        raise HTTPException(404, "Conversation not found")
    msg = DMMessage(conversation_id=conv_id, user_id=user.id, content=content.strip())
    db.add(msg); await db.commit(); await db.refresh(msg)
    return DMMessageOut(id=msg.id, conversation_id=msg.conversation_id, user_id=msg.user_id, content=msg.content, created_at=msg.created_at)

# ---------------- Social: follow ----------------
@app.post("/follow/{user_id}", response_model=FollowOut)
async def follow_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user_id == user.id:
        raise HTTPException(400, "Cannot follow yourself")
    res = await db.execute(select(User).where(User.id == user_id))
    other = res.scalar_one_or_none()
    if not other or other.province != user.province:
        raise HTTPException(404, "User not found")
    res = await db.execute(select(Follow).where(Follow.follower_id == user.id, Follow.following_id == user_id))
    if res.scalar_one_or_none():
        return FollowOut(follower_id=user.id, following_id=user_id)
    db.add(Follow(follower_id=user.id, following_id=user_id))
    await db.commit()
    return FollowOut(follower_id=user.id, following_id=user_id)

@app.delete("/follow/{user_id}", response_model=dict)
async def unfollow_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(Follow).where(Follow.follower_id == user.id, Follow.following_id == user_id))
    await db.commit()
    return {"ok": True}

# ---------------- Social: friend requests ----------------
@app.post("/friends/requests", response_model=FriendRequestOut)
async def create_friend_request(payload: FriendRequestCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.to_user_id == user.id:
        raise HTTPException(400, "Cannot friend yourself")
    res = await db.execute(select(User).where(User.id == payload.to_user_id))
    other = res.scalar_one_or_none()
    if not other or other.province != user.province:
        raise HTTPException(404, "User not found")

    # Already friends?
    res = await db.execute(select(Friendship).where(Friendship.user_id == user.id, Friendship.friend_id == other.id))
    if res.scalar_one_or_none():
        raise HTTPException(409, "Already friends")

    res = await db.execute(select(FriendRequest).where(FriendRequest.from_user_id == user.id, FriendRequest.to_user_id == other.id, FriendRequest.status == FriendRequestStatus.PENDING))
    if res.scalar_one_or_none():
        raise HTTPException(409, "Request already pending")

    fr = FriendRequest(from_user_id=user.id, to_user_id=other.id, status=FriendRequestStatus.PENDING)
    db.add(fr); await db.commit(); await db.refresh(fr)
    return FriendRequestOut(id=fr.id, from_user_id=fr.from_user_id, to_user_id=fr.to_user_id, status=fr.status, created_at=fr.created_at)

@app.get("/friends/requests/incoming", response_model=list[FriendRequestOut])
async def incoming_friend_requests(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(FriendRequest).where(FriendRequest.to_user_id == user.id, FriendRequest.status == FriendRequestStatus.PENDING).order_by(FriendRequest.id.desc()))
    return [FriendRequestOut(id=r.id, from_user_id=r.from_user_id, to_user_id=r.to_user_id, status=r.status, created_at=r.created_at) for r in res.scalars().all()]

@app.post("/friends/requests/{request_id}/resolve", response_model=dict)
async def resolve_friend_request(request_id: int, payload: FriendRequestResolveIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(FriendRequest).where(FriendRequest.id == request_id))
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(404, "Request not found")
    if req.to_user_id != user.id:
        raise HTTPException(403, "Forbidden")
    if req.status != FriendRequestStatus.PENDING:
        raise HTTPException(409, "Already resolved")

    req.status = FriendRequestStatus.ACCEPTED if payload.accept else FriendRequestStatus.REJECTED
    req.resolved_at = datetime.utcnow()
    if req.status == FriendRequestStatus.ACCEPTED:
        a, b = req.from_user_id, req.to_user_id
        # store both directions
        db.add(Friendship(user_id=a, friend_id=b))
        db.add(Friendship(user_id=b, friend_id=a))
    await db.commit()
    return {"ok": True}

@app.get("/friends", response_model=list[UserSummary])
async def list_friends(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Friendship.friend_id).where(Friendship.user_id == user.id))
    ids = list(res.scalars().all())
    if not ids:
        return []
    res = await db.execute(select(User).where(User.id.in_(ids)))
    return [_user_summary(u) for u in res.scalars().all()]

# ---------------- Feed posts ----------------
@app.post("/posts", response_model=PostOut)
async def create_post(payload: PostCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    p = Post(user_id=user.id, content=payload.content.strip())
    db.add(p); await db.commit(); await db.refresh(p)
    return PostOut(id=p.id, user_id=p.user_id, user=_user_summary(user), content=p.content, created_at=p.created_at)

@app.get("/feed", response_model=list[PostOut])
async def get_feed(limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    # feed = your posts + posts from people you follow (same province enforced by follow)
    res = await db.execute(select(Follow.following_id).where(Follow.follower_id == user.id))
    following_ids = list(res.scalars().all())
    ids = set(following_ids + [user.id])
    res = await db.execute(select(Post).where(Post.user_id.in_(ids)).order_by(Post.id.desc()).limit(limit))
    posts = list(reversed(res.scalars().all()))
    # user summaries
    uids = sorted({p.user_id for p in posts})
    umap = {}
    if uids:
        resu = await db.execute(select(User).where(User.id.in_(uids)))
        for u in resu.scalars().all():
            umap[u.id] = _user_summary(u)
    return [PostOut(id=p.id, user_id=p.user_id, user=umap.get(p.user_id) or UserSummary(id=p.user_id, display_name="Unknown", avatar_url=None), content=p.content, created_at=p.created_at) for p in posts]
