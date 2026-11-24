"""Blocking people: GET /me/blocks, POST and DELETE /users/{id}/block.

Blocking someone ends our friendship, follows and pending requests; neither of us can then open a direct message,
send a friend request or follow the other, nor write in a direct message we already had. I get no notifications of
what they write, and the app hides their messages from me in groups and communities.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.conversations.service import user_summary
from app.core.deps import get_current_user, get_db
from app.core.i18n import t
from app.core.models import DMRequest, Follow, FriendRequest, Friendship, User, UserBlock

router = APIRouter(tags=["social"])


async def blocked_between(db: AsyncSession, a: int, b: int) -> bool:
    """Either of the two blocked the other."""
    return bool((await db.execute(select(UserBlock.blocker_id).where(or_(
        and_(UserBlock.blocker_id == a, UserBlock.blocked_id == b),
        and_(UserBlock.blocker_id == b, UserBlock.blocked_id == a))).limit(1))).first())


async def require_not_blocked(db: AsyncSession, a: int, b: int) -> None:
    if await blocked_between(db, a, b):
        raise HTTPException(403, t("err_blocked"))


async def blocking(db: AsyncSession, user_ids: list[int]) -> dict[int, set[int]]:
    """For each person, who they blocked."""
    out: dict[int, set[int]] = {}
    if user_ids:
        for blocker, blocked in (await db.execute(select(UserBlock.blocker_id, UserBlock.blocked_id).where(
                UserBlock.blocker_id.in_(user_ids)))).all():
            out.setdefault(blocker, set()).add(blocked)
    return out


@router.get("/me/blocks", response_model=list[dict])
async def my_blocks(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(UserBlock, User).join(User, User.id == UserBlock.blocked_id).where(
        UserBlock.blocker_id == user.id).order_by(UserBlock.created_at.desc()))).all()
    return [{**user_summary(u), "blocked_at": b.created_at.isoformat().replace("+00:00", "Z")} for b, u in rows]


@router.post("/users/{user_id}/block", response_model=dict)
async def block(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user_id == user.id:
        raise HTTPException(400, t("err_cannot_block_self"))
    other = await db.get(User, user_id)
    if not other or other.bot_role:
        raise HTTPException(404, t("err_user_not_found"))
    if not await db.get(UserBlock, (user.id, user_id)):
        db.add(UserBlock(blocker_id=user.id, blocked_id=user_id))
    pair = lambda a, b: or_(and_(a == user.id, b == user_id), and_(a == user_id, b == user.id))  # noqa: E731
    await db.execute(delete(Friendship).where(pair(Friendship.user_id, Friendship.friend_id)))
    await db.execute(delete(Follow).where(pair(Follow.follower_id, Follow.following_id)))
    await db.execute(delete(FriendRequest).where(pair(FriendRequest.from_user_id, FriendRequest.to_user_id)))
    await db.execute(delete(DMRequest).where(pair(DMRequest.from_user_id, DMRequest.to_user_id)))
    await db.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/block", response_model=dict)
async def unblock(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(UserBlock).where(UserBlock.blocker_id == user.id, UserBlock.blocked_id == user_id))
    await db.commit()
    return {"ok": True}
