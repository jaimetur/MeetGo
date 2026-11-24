"""Deleting an account, by the person themselves (DELETE /me, the app's Settings) or by an administrator.

What goes: the account, its profile and photo, interests, friends, follows and requests, its memberships, its
comments and sign-ups. What they wrote in chats and on boards is emptied and marked as removed (the conversation
keeps its thread, without their words). Communities they owned pass to the oldest admin or member. A web
subscription is cancelled; one from Google Play is cancelled in Google Play itself.
"""

import logging

from sqlalchemy import delete, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import (
    BoardAttendee, BoardComment, BoardPost, Conversation, ConversationMember, DMRequest, Follow, FriendRequest,
    Friendship, Message, Post, User, UserInterest, utcnow,
)

logger = logging.getLogger("meetgo.accounts")


async def _table_exists(db: AsyncSession, name: str) -> bool:
    return bool((await db.execute(text("SELECT to_regclass(:n)"), {"n": f"public.{name}"})).scalar())


async def delete_account(db: AsyncSession, user: User) -> None:
    from app.accounts.avatar import _remove as remove_avatar
    from app.billing import service as billing
    from app.communities.service import hand_over_ownership

    uid = user.id
    try:
        await billing.stripe_set_cancel(db, user, True)
    except Exception:  # no web subscription, or Stripe not configured
        pass
    # communities they own pass to someone else
    owned = (await db.execute(select(Conversation).join(ConversationMember, ConversationMember.conversation_id == Conversation.id).where(
        ConversationMember.user_id == uid, ConversationMember.role == "owner", Conversation.kind == "channel"))).scalars().all()
    for conv in owned:
        await hand_over_ownership(db, conv, uid)
    now = utcnow()
    await db.execute(update(Message).where(Message.sender_id == uid, Message.deleted_at.is_(None)).values(
        body="", deleted_at=now, moderation_reason="ACCOUNT_DELETED", mentions=[]))
    await db.execute(update(BoardPost).where(BoardPost.author_id == uid, BoardPost.deleted_at.is_(None)).values(deleted_at=now))
    await db.execute(delete(BoardComment).where(BoardComment.author_id == uid))
    await db.execute(delete(BoardAttendee).where(BoardAttendee.user_id == uid))
    # Tables from version 0.1 that are kept after the migration and have no cascading keys.
    if await _table_exists(db, "dm_messages"):
        await db.execute(text("""DELETE FROM dm_messages WHERE user_id = :u OR conversation_id IN
                                 (SELECT id FROM dm_conversations WHERE user1_id = :u OR user2_id = :u)"""), {"u": uid})
        await db.execute(text("DELETE FROM dm_conversations WHERE user1_id = :u OR user2_id = :u"), {"u": uid})
    if await _table_exists(db, "room_messages"):
        await db.execute(text("DELETE FROM room_messages WHERE user_id = :u"), {"u": uid})
        await db.execute(text("DELETE FROM room_discipline WHERE user_id = :u"), {"u": uid})
        await db.execute(text("UPDATE room_rules SET updated_by_user_id = NULL WHERE updated_by_user_id = :u"), {"u": uid})
    await db.execute(delete(DMRequest).where(or_(DMRequest.from_user_id == uid, DMRequest.to_user_id == uid)))
    await db.execute(delete(FriendRequest).where(or_(FriendRequest.from_user_id == uid, FriendRequest.to_user_id == uid)))
    await db.execute(delete(Friendship).where(or_(Friendship.user_id == uid, Friendship.friend_id == uid)))
    await db.execute(delete(Follow).where(or_(Follow.follower_id == uid, Follow.following_id == uid)))
    await db.execute(delete(Post).where(Post.user_id == uid))
    await db.execute(delete(UserInterest).where(UserInterest.user_id == uid))
    await db.execute(update(Conversation).where(Conversation.created_by_id == uid).values(created_by_id=None))
    remove_avatar(user.avatar_url)
    await db.execute(delete(User).where(User.id == uid))
    await db.commit()
    logger.info("Account %s deleted", uid)
