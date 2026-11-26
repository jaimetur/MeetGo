"""Everyone's wall and stories: who may see what, and how a post or a story is sent to the app.

A post or a story is for the author's friends (by default), their followers (and friends) or everyone of their zone
(and their friends and followers). Blocking hides everything either way; a story can also be hidden from some people.
"""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.conversations.service import user_summary
from app.core.models import (Attachment, FeedComment, FeedPost, FeedReaction, FeedSave, Follow, Friendship, Story,
                             StoryView, User, UserBlock, utcnow)
from app.messaging.storage import attachment_out

AUDIENCES = ("friends", "followers", "public")
STORY_HOURS = 24
MENTION_RE = re.compile(r"@([\w.\-]{2,40})")


def _friends_of(viewer_id: int):
    return select(Friendship.friend_id).where(Friendship.user_id == viewer_id)


def _following_of(viewer_id: int):
    return select(Follow.following_id).where(Follow.follower_id == viewer_id)


def _blocked_with(viewer_id: int):
    return select(UserBlock.blocked_id).where(UserBlock.blocker_id == viewer_id).union(
        select(UserBlock.blocker_id).where(UserBlock.blocked_id == viewer_id))


def visible(model, viewer: User):
    """The posts (or stories) `viewer` may see."""
    friends, following = _friends_of(viewer.id), _following_of(viewer.id)
    return and_(
        model.user_id.not_in(_blocked_with(viewer.id)),
        or_(
            model.user_id == viewer.id,
            model.user_id.in_(friends),
            and_(model.audience.in_(("followers", "public")), model.user_id.in_(following)),
            and_(model.audience == "public", model.province == viewer.province),
        ),
    )


async def can_see_post(db: AsyncSession, viewer: User, post: FeedPost | None) -> bool:
    if not post or post.deleted_at:
        return False
    return bool((await db.execute(select(FeedPost.id).where(FeedPost.id == post.id, visible(FeedPost, viewer)))).first())


async def mention_ids(db: AsyncSession, body: str, author_id: int) -> list[int]:
    names = {m.lower() for m in MENTION_RE.findall(body or "")}
    if not names:
        return []
    rows = (await db.execute(select(User.id).where(func.lower(User.display_name).in_(names), User.id != author_id))).scalars().all()
    return sorted(set(rows))


async def posts_out(db: AsyncSession, viewer: User, posts: list[FeedPost], nested: bool = True) -> list[dict]:
    """Posts as the app shows them: author, text, photos or video, the post shared (if still visible), reactions,
    my reaction, comments and shares counted, saved or not."""
    if not posts:
        return []
    ids = [p.id for p in posts]
    authors = {u.id: u for u in (await db.execute(select(User).where(User.id.in_({p.user_id for p in posts})))).scalars().all()}
    media: dict[int, list] = {}
    for a in (await db.execute(select(Attachment).where(Attachment.feed_post_id.in_(ids)).order_by(Attachment.id))).scalars().all():
        media.setdefault(a.feed_post_id, []).append(attachment_out(a))
    reactions: dict[int, dict[str, int]] = {}
    for pid, emoji, n in (await db.execute(select(FeedReaction.post_id, FeedReaction.emoji, func.count()).where(
            FeedReaction.post_id.in_(ids)).group_by(FeedReaction.post_id, FeedReaction.emoji))).all():
        reactions.setdefault(pid, {})[emoji] = int(n)
    mine = dict((await db.execute(select(FeedReaction.post_id, FeedReaction.emoji).where(
        FeedReaction.post_id.in_(ids), FeedReaction.user_id == viewer.id))).all())
    comments = dict((await db.execute(select(FeedComment.post_id, func.count()).where(
        FeedComment.post_id.in_(ids), FeedComment.deleted_at.is_(None)).group_by(FeedComment.post_id))).all())
    shares = dict((await db.execute(select(FeedPost.shared_from_id, func.count()).where(
        FeedPost.shared_from_id.in_(ids), FeedPost.deleted_at.is_(None)).group_by(FeedPost.shared_from_id))).all())
    saved = set((await db.execute(select(FeedSave.post_id).where(FeedSave.user_id == viewer.id, FeedSave.post_id.in_(ids)))).scalars().all())
    shared: dict[int, dict] = {}
    if nested:
        origin_ids = {p.shared_from_id for p in posts if p.shared_from_id}
        if origin_ids:
            origins = (await db.execute(select(FeedPost).where(FeedPost.id.in_(origin_ids), FeedPost.deleted_at.is_(None),
                                                               visible(FeedPost, viewer)))).scalars().all()
            shared = {o["id"]: o for o in await posts_out(db, viewer, list(origins), nested=False)}
    out = []
    for p in posts:
        out.append({
            "id": p.id, "author": user_summary(authors.get(p.user_id)), "body": p.body, "audience": p.audience,
            "place": p.place, "created_at": p.created_at.isoformat(), "edited": bool(p.edited_at),
            "media": media.get(p.id, []),
            "shared_from_id": p.shared_from_id,
            "shared": shared.get(p.shared_from_id) if p.shared_from_id else None,
            "reactions": reactions.get(p.id, {}), "my_reaction": mine.get(p.id),
            "comments": int(comments.get(p.id, 0)), "shares": int(shares.get(p.id, 0)),
            "saved": p.id in saved, "mine": p.user_id == viewer.id,
        })
    return out


async def comments_out(db: AsyncSession, viewer: User, rows: list[FeedComment]) -> list[dict]:
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_({c.user_id for c in rows} or {0})))).scalars().all()}
    return [{"id": c.id, "post_id": c.post_id, "parent_id": c.parent_id, "author": user_summary(users.get(c.user_id)),
             "body": c.body, "created_at": c.created_at.isoformat(), "mine": c.user_id == viewer.id} for c in rows]


# ---------- stories ----------

def story_visible(viewer: User):
    return and_(Story.expires_at > utcnow(), visible(Story, viewer),
                or_(Story.user_id == viewer.id, ~Story.hidden_from.contains([viewer.id])))


async def stories_out(db: AsyncSession, viewer: User, stories: list[Story]) -> list[dict]:
    """The stories by person, as the strip and the viewer show them: mine first, then those with something unseen,
    the newest first; each person's stories oldest first."""
    if not stories:
        return []
    ids = [s.id for s in stories]
    seen = dict((await db.execute(select(StoryView.story_id, StoryView.reaction).where(
        StoryView.story_id.in_(ids), StoryView.user_id == viewer.id))).all())
    views = dict((await db.execute(select(StoryView.story_id, func.count()).where(
        StoryView.story_id.in_([s.id for s in stories if s.user_id == viewer.id] or [0])).group_by(StoryView.story_id))).all())
    media = {a.story_id: attachment_out(a) for a in (await db.execute(select(Attachment).where(Attachment.story_id.in_(ids)))).scalars().all()}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_({s.user_id for s in stories})))).scalars().all()}
    groups: dict[int, list] = {}
    for s in sorted(stories, key=lambda s: s.created_at):
        groups.setdefault(s.user_id, []).append({
            "id": s.id, "kind": s.kind, "text": s.text, "bg": s.bg, "media": media.get(s.id),
            "created_at": s.created_at.isoformat(), "expires_at": s.expires_at.isoformat(),
            "seen": s.id in seen or s.user_id == viewer.id, "my_reaction": seen.get(s.id),
            "views": int(views.get(s.id, 0)) if s.user_id == viewer.id else None,
            "audience": s.audience if s.user_id == viewer.id else None,
        })
    out = [{"user": user_summary(users.get(uid)), "mine": uid == viewer.id, "stories": items,
            "all_seen": all(i["seen"] for i in items), "last_at": items[-1]["created_at"]} for uid, items in groups.items()]
    out.sort(key=lambda g: (not g["mine"], g["all_seen"], _neg(g["last_at"])))
    return out


def _neg(iso: str) -> str:
    """Sorts ISO dates newest first inside a tuple sorted ascending."""
    return "".join(chr(255 - ord(ch)) for ch in iso)


def story_expiry():
    return utcnow() + timedelta(hours=STORY_HOURS)


# ---------- automatic moderation (in the background) ----------

FEED_RULES = """- Respect: no harassment, insults, threats or hate.
- No sexual content, violence or illegal things.
- No spam or advertising, and no phone numbers."""


def check_later(kind: str, item_id: int) -> None:
    """After answering: Claude reads the post, comment or story; if it breaks the rules it is hidden and goes to
    Administration → Moderation as a report."""
    from app.communities import automod
    from app.messaging.service import _background
    if automod.enabled():
        _background(_check(kind, item_id))


async def _check(kind: str, item_id: int) -> None:
    from app.communities.automod import judge
    from app.communities.service import bot_ids
    from app.core import ai
    from app.core.db import SessionLocal
    from app.core.models import Report
    await ai.refresh_if_stale()
    async with SessionLocal() as db:
        model = {"post": FeedPost, "comment": FeedComment, "story": Story}[kind]
        item = await db.get(model, item_id)
        text = (getattr(item, "body", None) or getattr(item, "text", None) or "") if item else ""
        if not item or not text.strip() or getattr(item, "deleted_at", None):
            return
        verdict = await judge(FEED_RULES, text)
        if not verdict or not verdict.get("violation"):
            return
        bots = await bot_ids(db)
        reporter = next(iter(bots.values()), None) or item.user_id
        post_id = item.id if kind == "post" else item.post_id if kind == "comment" else None
        if kind == "story":
            await db.delete(item)
        else:
            item.deleted_at = utcnow()
        if post_id:
            db.add(Report(feed_post_id=post_id, reporter_id=reporter, reason="automod",
                          details=f"{kind}: {verdict.get('rule') or ''} — {text[:500]}"))
        await db.commit()
