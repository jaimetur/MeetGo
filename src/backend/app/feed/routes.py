"""Everyone's wall (Inicio → My wall / My friends) and stories of 24 hours.

Posts: text with up to 10 photos or a video, for friends, followers or everyone of the zone; reactions, comments
(with replies), shares (to my wall, with a comment), saved posts, reports, and a notice to the author.
Stories: a photo, a video or a text on a colour, for 24 hours; who saw them (the author), reactions and replies, which
reach the author as a direct message.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, require_write_access
from app.core.i18n import t
from app.core.models import (Attachment, FeedComment, FeedPost, FeedReaction, FeedSave, Follow, Friendship, Report,
                             Story, StoryView, User, utcnow)
from app.feed import service as feed

router = APIRouter(tags=["feed"])
MAX_MEDIA = 10
PAGE = 20


class PostIn(BaseModel):
    body: str = Field(default="", max_length=5000)
    audience: str = "friends"
    place: str | None = Field(default=None, max_length=120)
    attachment_ids: list[int] = Field(default_factory=list, max_length=MAX_MEDIA)
    shared_from_id: int | None = None


class PostEditIn(BaseModel):
    body: str | None = Field(default=None, max_length=5000)
    audience: str | None = None
    place: str | None = Field(default=None, max_length=120)


class ReactionIn(BaseModel):
    emoji: str | None = Field(default=None, max_length=32)  # none: take mine away


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    parent_id: int | None = None


class ReportIn(BaseModel):
    reason: str = Field(max_length=64)
    details: str | None = Field(default=None, max_length=1000)


class StoryIn(BaseModel):
    kind: str  # photo | video | text
    text: str = Field(default="", max_length=500)
    bg: str | None = Field(default=None, max_length=32)
    audience: str = "friends"
    hidden_from: list[int] = Field(default_factory=list, max_length=500)
    attachment_id: int | None = None


class StoryViewIn(BaseModel):
    reaction: str | None = Field(default=None, max_length=32)


class StoryReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


def _audience(value: str) -> str:
    if value not in feed.AUDIENCES:
        raise HTTPException(400, t("err_feed_audience"))
    return value


async def _post_for(db: AsyncSession, user: User, post_id: int) -> FeedPost:
    post = await db.get(FeedPost, post_id)
    if not await feed.can_see_post(db, user, post):
        raise HTTPException(404, t("err_feed_post_not_found"))
    return post


def _notice(users: list[User], key: str, params: dict, post_id: int) -> None:
    from app.push.service import push_notice
    push_notice([u for u in users if u], "feed", key, params, f"/app/f/{post_id}")


# ---------- posts ----------

@router.post("/feed/posts", response_model=dict)
async def create_post(payload: PostIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    body = payload.body.strip()
    origin = await _post_for(db, user, payload.shared_from_id) if payload.shared_from_id else None
    if origin and origin.shared_from_id:  # sharing a share shares the original
        origin = await _post_for(db, user, origin.shared_from_id)
    media = []
    if payload.attachment_ids:
        media = list((await db.execute(select(Attachment).where(
            Attachment.id.in_(payload.attachment_ids), Attachment.uploader_id == user.id, Attachment.message_id.is_(None),
            Attachment.feed_post_id.is_(None), Attachment.story_id.is_(None)))).scalars().all())
        if any(not (a.mime.startswith("image/") or a.mime.startswith("video/")) for a in media):
            raise HTTPException(400, t("err_feed_media"))
    if not body and not media and not origin:
        raise HTTPException(400, t("err_empty_message"))
    post = FeedPost(user_id=user.id, body=body, audience=_audience(payload.audience), place=(payload.place or "").strip() or None,
                    province=user.province, mentions=await feed.mention_ids(db, body, user.id),
                    shared_from_id=origin.id if origin else None, created_at=utcnow())
    db.add(post)
    await db.flush()
    for a in media:
        a.feed_post_id = post.id
    await db.commit()
    feed.check_later("post", post.id)
    mentioned = (await db.execute(select(User).where(User.id.in_(post.mentions or [0])))).scalars().all()
    _notice(list(mentioned), "email_feed_mention", {"name": user.shown_name}, post.id)
    if origin and origin.user_id != user.id:
        _notice([await db.get(User, origin.user_id)], "email_feed_share", {"name": user.shown_name}, origin.id)
    return (await feed.posts_out(db, user, [post]))[0]


@router.get("/feed/posts/{post_id}", response_model=dict)
async def get_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return (await feed.posts_out(db, user, [await _post_for(db, user, post_id)]))[0]


@router.patch("/feed/posts/{post_id}", response_model=dict)
async def edit_post(post_id: int, payload: PostEditIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    post = await _post_for(db, user, post_id)
    if post.user_id != user.id:
        raise HTTPException(403, t("err_forbidden"))
    if payload.body is not None:
        post.body = payload.body.strip()
        post.mentions = await feed.mention_ids(db, post.body, user.id)
    if payload.audience is not None:
        post.audience = _audience(payload.audience)
    if payload.place is not None:
        post.place = payload.place.strip() or None
    post.edited_at = utcnow()
    await db.commit()
    feed.check_later("post", post.id)
    return (await feed.posts_out(db, user, [post]))[0]


@router.delete("/feed/posts/{post_id}", response_model=dict)
async def delete_post(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post = await db.get(FeedPost, post_id)
    if not post or (post.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, t("err_feed_post_not_found"))
    post.deleted_at = utcnow()
    await db.commit()
    return {"ok": True}


async def _page(db: AsyncSession, user: User, where, before_id: int | None) -> dict:
    query = select(FeedPost).where(FeedPost.deleted_at.is_(None), feed.visible(FeedPost, user), *where)
    if before_id:
        query = query.where(FeedPost.id < before_id)
    rows = list((await db.execute(query.order_by(FeedPost.id.desc()).limit(PAGE + 1))).scalars().all())
    return {"posts": await feed.posts_out(db, user, rows[:PAGE]), "more": len(rows) > PAGE}


@router.get("/feed/wall/{user_id}", response_model=dict)
async def wall(user_id: int, before_id: int | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Someone's wall (mine with my id): their posts and shares I may see."""
    return await _page(db, user, [FeedPost.user_id == user_id], before_id)


@router.get("/feed/friends", response_model=dict)
async def friends_feed(before_id: int | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """What my friends and the people I follow post, newest first."""
    people = select(Friendship.friend_id).where(Friendship.user_id == user.id).union(
        select(Follow.following_id).where(Follow.follower_id == user.id))
    return await _page(db, user, [FeedPost.user_id.in_(people)], before_id)


@router.get("/feed/saved", response_model=dict)
async def saved(before_id: int | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await _page(db, user, [FeedPost.id.in_(select(FeedSave.post_id).where(FeedSave.user_id == user.id))], before_id)


@router.put("/feed/posts/{post_id}/reaction", response_model=dict)
async def react(post_id: int, payload: ReactionIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    post = await _post_for(db, user, post_id)
    had = await db.get(FeedReaction, (post.id, user.id))
    if payload.emoji:
        if had:
            had.emoji = payload.emoji
        else:
            db.add(FeedReaction(post_id=post.id, user_id=user.id, emoji=payload.emoji, created_at=utcnow()))
    elif had:
        await db.delete(had)
    await db.commit()
    if payload.emoji and not had and post.user_id != user.id:
        _notice([await db.get(User, post.user_id)], "email_feed_reaction", {"name": user.shown_name, "emoji": payload.emoji}, post.id)
    return (await feed.posts_out(db, user, [post]))[0]


@router.get("/feed/posts/{post_id}/reactions", response_model=list[dict])
async def reactions(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from app.conversations.service import user_summary
    post = await _post_for(db, user, post_id)
    rows = (await db.execute(select(FeedReaction, User).join(User, User.id == FeedReaction.user_id).where(
        FeedReaction.post_id == post.id).order_by(FeedReaction.created_at.desc()))).all()
    return [{"user": user_summary(u), "emoji": r.emoji} for r, u in rows]


@router.get("/feed/posts/{post_id}/comments", response_model=list[dict])
async def comments(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post = await _post_for(db, user, post_id)
    rows = list((await db.execute(select(FeedComment).where(FeedComment.post_id == post.id, FeedComment.deleted_at.is_(None))
                                  .order_by(FeedComment.id))).scalars().all())
    return await feed.comments_out(db, user, rows)


@router.post("/feed/posts/{post_id}/comments", response_model=dict)
async def comment(post_id: int, payload: CommentIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    post = await _post_for(db, user, post_id)
    parent = await db.get(FeedComment, payload.parent_id) if payload.parent_id else None
    if payload.parent_id and (not parent or parent.post_id != post.id):
        raise HTTPException(404, t("err_feed_post_not_found"))
    c = FeedComment(post_id=post.id, user_id=user.id, parent_id=parent.parent_id or parent.id if parent else None,
                    body=payload.body.strip(), created_at=utcnow())
    db.add(c)
    await db.commit()
    feed.check_later("comment", c.id)
    tell = {post.user_id} | ({parent.user_id} if parent else set()) | set(await feed.mention_ids(db, c.body, user.id))
    tell.discard(user.id)
    people = (await db.execute(select(User).where(User.id.in_(tell or {0})))).scalars().all()
    _notice(list(people), "email_feed_comment", {"name": user.shown_name}, post.id)
    return (await feed.comments_out(db, user, [c]))[0]


@router.delete("/feed/comments/{comment_id}", response_model=dict)
async def delete_comment(comment_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    c = await db.get(FeedComment, comment_id)
    post = await db.get(FeedPost, c.post_id) if c else None
    if not c or not post or user.id not in (c.user_id, post.user_id) and user.role != "admin":
        raise HTTPException(404, t("err_feed_post_not_found"))
    c.deleted_at = utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/feed/posts/{post_id}/save", response_model=dict)
async def save(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    post = await _post_for(db, user, post_id)
    if not await db.get(FeedSave, (user.id, post.id)):
        db.add(FeedSave(user_id=user.id, post_id=post.id, created_at=utcnow()))
        await db.commit()
    return {"ok": True, "saved": True}


@router.delete("/feed/posts/{post_id}/save", response_model=dict)
async def unsave(post_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(FeedSave).where(FeedSave.user_id == user.id, FeedSave.post_id == post_id))
    await db.commit()
    return {"ok": True, "saved": False}


@router.post("/feed/posts/{post_id}/report", response_model=dict)
async def report(post_id: int, payload: ReportIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    post = await _post_for(db, user, post_id)
    if post.user_id == user.id:
        raise HTTPException(400, t("err_report_own"))
    db.add(Report(feed_post_id=post.id, reporter_id=user.id, reason=payload.reason, details=payload.details))
    await db.commit()
    from app.mail.notify_email import notify_admins_report
    await notify_admins_report(db, payload.reason)
    return {"ok": True}


# ---------- stories ----------

@router.get("/stories", response_model=list[dict])
async def stories(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """The stories I may see now, by person: mine first, then those with something new."""
    rows = list((await db.execute(select(Story).where(feed.story_visible(user)))).scalars().all())
    return await feed.stories_out(db, user, rows)


@router.post("/stories", response_model=dict)
async def create_story(payload: StoryIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    if payload.kind not in ("photo", "video", "text"):
        raise HTTPException(400, t("err_feed_media"))
    media = None
    if payload.kind in ("photo", "video"):
        media = await db.get(Attachment, payload.attachment_id or 0)
        wanted = "image/" if payload.kind == "photo" else "video/"
        if not media or media.uploader_id != user.id or media.message_id or media.feed_post_id or media.story_id or not media.mime.startswith(wanted):
            raise HTTPException(400, t("err_feed_media"))
    elif not payload.text.strip():
        raise HTTPException(400, t("err_empty_message"))
    story = Story(user_id=user.id, kind=payload.kind, text=payload.text.strip(), bg=payload.bg, audience=_audience(payload.audience),
                  province=user.province, hidden_from=sorted(set(payload.hidden_from) - {user.id}), created_at=utcnow(),
                  expires_at=feed.story_expiry())
    db.add(story)
    await db.flush()
    if media:
        media.story_id = story.id
    await db.commit()
    feed.check_later("story", story.id)
    return {"ok": True, "id": story.id}


async def _story_for(db: AsyncSession, user: User, story_id: int) -> Story:
    story = (await db.execute(select(Story).where(Story.id == story_id, feed.story_visible(user)))).scalar_one_or_none()
    if not story:
        raise HTTPException(404, t("err_story_not_found"))
    return story


@router.post("/stories/{story_id}/view", response_model=dict)
async def view_story(story_id: int, payload: StoryViewIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Seen (and, with `reaction`, reacted to); the author is told of a reaction."""
    story = await _story_for(db, user, story_id)
    if story.user_id == user.id:
        return {"ok": True}
    view = await db.get(StoryView, (story.id, user.id))
    if not view:
        view = StoryView(story_id=story.id, user_id=user.id, viewed_at=utcnow())
        db.add(view)
    new_reaction = payload.reaction and payload.reaction != view.reaction
    if payload.reaction:
        view.reaction = payload.reaction
    await db.commit()
    if new_reaction:
        from app.push.service import push_notice
        push_notice([await db.get(User, story.user_id)], "story", "email_story_reaction",
                    {"name": user.shown_name, "emoji": payload.reaction}, "/app/")
    return {"ok": True}


@router.get("/stories/{story_id}/viewers", response_model=list[dict])
async def story_viewers(story_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Who saw my story, and how they reacted (only for me)."""
    from app.conversations.service import user_summary
    story = await db.get(Story, story_id)
    if not story or story.user_id != user.id:
        raise HTTPException(404, t("err_story_not_found"))
    rows = (await db.execute(select(StoryView, User).join(User, User.id == StoryView.user_id).where(
        StoryView.story_id == story.id).order_by(StoryView.viewed_at.desc()))).all()
    return [{"user": user_summary(u), "reaction": v.reaction, "viewed_at": v.viewed_at.isoformat()} for v, u in rows]


@router.post("/stories/{story_id}/reply", response_model=dict)
async def reply_story(story_id: int, payload: StoryReplyIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_write_access)):
    """A reply to a story reaches its author as a direct message (whoever may see it may answer it)."""
    from app.conversations.service import dm_between, get_membership, join
    from app.messaging.service import send_message
    from app.social.blocks import require_not_blocked
    story = await _story_for(db, user, story_id)
    if story.user_id == user.id:
        raise HTTPException(400, t("err_cannot_dm_self"))
    await require_not_blocked(db, user.id, story.user_id)
    conv = await dm_between(db, user.id, story.user_id)
    member = await get_membership(db, conv.id, user.id) or await join(db, conv, user.id)
    preview = story.text[:60] if story.kind == "text" else ""
    body = t("ui_story_reply_body", {"text": payload.body.strip(), "story": preview}) if preview else t("ui_story_reply_body_media", {"text": payload.body.strip()})
    await db.commit()
    msg, _ = await send_message(db, conv, member, user, body=body)
    from app.realtime import service as realtime
    await realtime.publish([user.id, story.user_id], {"type": "conversation.changed", "conversation_id": conv.id})
    return {"ok": True, "conversation_id": conv.id}


@router.delete("/stories/{story_id}", response_model=dict)
async def delete_story(story_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    story = await db.get(Story, story_id)
    if not story or (story.user_id != user.id and user.role != "admin"):
        raise HTTPException(404, t("err_story_not_found"))
    await db.delete(story)
    await db.commit()
    return {"ok": True}
