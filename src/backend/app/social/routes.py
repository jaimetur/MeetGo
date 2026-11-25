from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, require_write_access
from app.core.i18n import t
from app.core.models import Follow, FriendRequest, FriendRequestStatus, Friendship, Post, User
from app.core.schemas import FollowOut, FriendRequestCreateIn, FriendRequestOut, FriendRequestResolveIn, PostCreateIn, PostOut, UserSummary
from app.mail import notify_email
from app.realtime import service as realtime
from app.conversations.service import user_summary
from app.accounts.common import summary

from app.social.blocks import require_not_blocked

router = APIRouter(tags=["social"])


@router.post("/follow/{user_id}", response_model=FollowOut)
async def follow_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    if user_id == user.id:
        raise HTTPException(400, t("err_cannot_follow_self"))
    other = await db.get(User, user_id)
    if not other:
        raise HTTPException(404, t("err_user_not_found"))
    await require_not_blocked(db, user.id, user_id)
    if not await db.get(Follow, (user.id, user_id)):
        db.add(Follow(follower_id=user.id, following_id=user_id))
        await db.commit()
    return FollowOut(follower_id=user.id, following_id=user_id)


@router.delete("/follow/{user_id}", response_model=dict)
async def unfollow_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(Follow).where(Follow.follower_id == user.id, Follow.following_id == user_id))
    await db.commit()
    return {"ok": True}


@router.get("/following", response_model=list[int])
async def following(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Follow.following_id).where(Follow.follower_id == user.id))
    return list(res.scalars().all())


async def _add_friendship(db: AsyncSession, a: int, b: int) -> None:
    for x, y in ((a, b), (b, a)):
        if not await db.get(Friendship, (x, y)):
            db.add(Friendship(user_id=x, friend_id=y))


def _fr_out(r: FriendRequest) -> FriendRequestOut:
    return FriendRequestOut(id=r.id, from_user_id=r.from_user_id, to_user_id=r.to_user_id, status=r.status, created_at=r.created_at)


@router.post("/friends/requests", response_model=FriendRequestOut)
async def create_friend_request(payload: FriendRequestCreateIn, db: AsyncSession = Depends(get_db),
                                user: User = Depends(require_write_access)):
    if payload.to_user_id == user.id:
        raise HTTPException(400, t("err_cannot_friend_self"))
    other = await db.get(User, payload.to_user_id)
    if not other:
        raise HTTPException(404, t("err_user_not_found"))
    await require_not_blocked(db, user.id, other.id)
    if await db.get(Friendship, (user.id, other.id)):
        raise HTTPException(409, t("err_already_friends"))
    res = await db.execute(select(FriendRequest).where(FriendRequest.from_user_id == user.id, FriendRequest.to_user_id == other.id,
                                                       FriendRequest.status == FriendRequestStatus.PENDING))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_request_pending"))
    # The other person already asked: accept their request instead of creating a crossed one.
    res = await db.execute(select(FriendRequest).where(FriendRequest.from_user_id == other.id, FriendRequest.to_user_id == user.id,
                                                       FriendRequest.status == FriendRequestStatus.PENDING))
    reverse = res.scalar_one_or_none()
    if reverse:
        reverse.status = FriendRequestStatus.ACCEPTED
        reverse.resolved_at = datetime.utcnow()
        await _add_friendship(db, user.id, other.id)
        await db.commit()
        await realtime.publish([user.id, other.id], {"type": "requests.changed"})
        await notify_email.notify(db, other, "requests", "email_friend_accepted", {"name": user.shown_name}, "/app/people")
        return _fr_out(reverse)
    fr = FriendRequest(from_user_id=user.id, to_user_id=other.id, status=FriendRequestStatus.PENDING)
    db.add(fr)
    await db.commit()
    await db.refresh(fr)
    await realtime.publish([other.id], {"type": "requests.changed"})
    await notify_email.notify(db, other, "requests", "email_friend_request", {"name": user.shown_name}, "/app/people")
    return _fr_out(fr)


@router.get("/friends/requests/incoming", response_model=list[dict])
async def incoming_friend_requests(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(FriendRequest, User).join(User, User.id == FriendRequest.from_user_id).where(
        FriendRequest.to_user_id == user.id, FriendRequest.status == FriendRequestStatus.PENDING).order_by(FriendRequest.id.desc()))
    return [{**_fr_out(r).model_dump(mode="json"), "from_user": user_summary(u)} for r, u in res.all()]


@router.post("/friends/requests/{request_id}/resolve", response_model=dict)
async def resolve_friend_request(request_id: int, payload: FriendRequestResolveIn, db: AsyncSession = Depends(get_db),
                                 user: User = Depends(get_current_user)):
    req = await db.get(FriendRequest, request_id)
    if not req:
        raise HTTPException(404, t("err_request_not_found"))
    if req.to_user_id != user.id:
        raise HTTPException(403, t("err_forbidden"))
    if req.status != FriendRequestStatus.PENDING:
        raise HTTPException(409, t("err_already_resolved"))
    req.status = FriendRequestStatus.ACCEPTED if payload.accept else FriendRequestStatus.REJECTED
    req.resolved_at = datetime.utcnow()
    if payload.accept:
        await _add_friendship(db, req.from_user_id, req.to_user_id)
    await db.commit()
    await realtime.publish([req.from_user_id, user.id], {"type": "requests.changed"})
    if payload.accept:
        await notify_email.notify(db, await db.get(User, req.from_user_id), "requests", "email_friend_accepted",
                                  {"name": user.shown_name}, "/app/people")
    return {"ok": True}


@router.get("/friends", response_model=list[dict])
async def list_friends(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(User).join(Friendship, Friendship.friend_id == User.id).where(
        Friendship.user_id == user.id).order_by(User.display_name))
    users = res.scalars().all()
    online = await realtime.online_ids([u.id for u in users])
    return [{**user_summary(u), "online": u.id in online} for u in users]


@router.delete("/friends/{friend_id}", response_model=dict)
async def remove_friend(friend_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(Friendship).where(
        ((Friendship.user_id == user.id) & (Friendship.friend_id == friend_id))
        | ((Friendship.user_id == friend_id) & (Friendship.friend_id == user.id))))
    await db.commit()
    return {"ok": True}


@router.post("/posts", response_model=PostOut)
async def create_post(payload: PostCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    content = payload.content.strip()
    if not content:
        raise HTTPException(400, t("err_empty_message"))
    p = Post(user_id=user.id, content=content[:4000])
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return PostOut(id=p.id, user_id=p.user_id, user=summary(user), content=p.content, created_at=p.created_at)


@router.get("/feed", response_model=list[PostOut])
async def get_feed(limit: int = 50, before_id: int | None = None, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    limit = max(1, min(limit, 100))
    following_ids = select(Follow.following_id).where(Follow.follower_id == user.id)
    q = select(Post, User).join(User, User.id == Post.user_id).where(
        (Post.user_id.in_(following_ids)) | (Post.user_id == user.id))
    if before_id:
        q = q.where(Post.id < before_id)
    rows = (await db.execute(q.order_by(Post.id.desc()).limit(limit))).all()
    return [PostOut(id=p.id, user_id=p.user_id, user=UserSummary(id=u.id, display_name=u.shown_name, username=u.display_name, avatar_url=u.avatar_url),
                    content=p.content, created_at=p.created_at) for p, u in rows]
