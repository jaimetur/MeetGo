"""Content for the Google Play reviewer's account, so the review shows MeetGo as it is used.

The reviewer's account is created by a person (administration → Users, or signing up) with a password only they
know; this fills its zone with believable, made-up activity: a few demo people, interest communities with chat, board
posts and comments, and plans with people going and their plan chat, one of them with the reviewer going.
Demo people have an address at demo.meetgo.invalid, no password (they cannot sign in) and "Demo account" in their bio.
It can run again: what already exists is kept.

    docker compose exec app python -m app.demo.play_review playreview@meetgo.app [--lang en]

The content is in Spanish unless --lang says another language (the store screenshots are taken in each of them).
"""

import asyncio
import sys
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.core.models import (
    BoardAttendee, BoardComment, BoardPost, Conversation, Interest, Message, User, UserInterest, utcnow,
)
from app.board.service import chat_add, create_plan_chat
from app.conversations.service import join_interest_channel
from app.demo.play_review_texts import KEYS, TEXTS

DOMAIN = "demo.meetgo.invalid"
INTERESTS = ["senderismo", "cine", "tomar_algo"]


def _next(weekday: int, hour: int, minute: int = 0) -> datetime:
    """The next given weekday (0 = Monday) at that time in Madrid, in UTC; at least two days ahead."""
    tz = ZoneInfo("Europe/Madrid")
    today = datetime.now(tz).date()
    days = (weekday - today.weekday()) % 7 or 7
    if days < 2:
        days += 7
    return datetime.combine(today + timedelta(days=days), time(hour, minute), tz).astimezone(timezone.utc)


async def _person(db, reviewer: User, key: str, name: str, bio: str) -> User:
    email = f"{key}@{DOMAIN}"
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        return user
    first, last = name.split(" ", 1)
    # the alias is one word and unique: the first name, with the account key when someone already has it
    alias = first if not (await db.execute(select(User.id).where(func.lower(User.display_name) == first.lower()))).first() else f"{first}_{key}"
    user = User(email=email, phone=None, password_hash=None, display_name=alias, first_name=first, last_name=last, dob=reviewer.dob,
                age_range=reviewer.age_range, country=reviewer.country, province=reviewer.province, accept_dm=True,
                bio=bio, role="user", email_verified=True, lang=reviewer.lang)
    db.add(user)
    await db.flush()
    return user


async def _say(db, conv: Conversation, user: User, body: str, when: datetime) -> None:
    msg = Message(conversation_id=conv.id, sender_id=user.id, kind="text", body=body, mentions=[], created_at=when)
    db.add(msg)
    await db.flush()
    conv.last_message_id, conv.last_message_at = msg.id, when


async def _post(db, conv: Conversation, author: User, going: list[User], **fields) -> BoardPost:
    post = (await db.execute(select(BoardPost).where(
        BoardPost.conversation_id == conv.id, BoardPost.title == fields["title"],
        BoardPost.deleted_at.is_(None)))).scalar_one_or_none()
    if post:
        return post
    now = utcnow()
    post = BoardPost(conversation_id=conv.id, author_id=author.id, created_at=now - timedelta(hours=20),
                     updated_at=now - timedelta(hours=20), **fields)
    db.add(post)
    await db.flush()
    if post.kind in ("meetup", "event"):
        db.add(BoardAttendee(post_id=post.id, user_id=author.id, status="going", created_at=now))
        await create_plan_chat(db, post, author)
        for u in going:
            db.add(BoardAttendee(post_id=post.id, user_id=u.id, status="going", created_at=now))
            await chat_add(db, post, u)
    return post


async def seed(email: str, lang: str = "es") -> dict:
    tx = TEXTS.get(lang) or TEXTS["es"]
    async with SessionLocal() as db:
        reviewer = (await db.execute(select(User).where(func.lower(User.email) == email.strip().lower()))).scalar_one_or_none()
        if not reviewer:
            raise SystemExit(f"No account with the address {email}: create it first (administration → Users).")
        people = {k: await _person(db, reviewer, k, n, tx["bio"]) for k, n in zip(KEYS, tx["people"])}
        interests = {i.slug: i for i in (await db.execute(select(Interest).where(Interest.slug.in_(INTERESTS)))).scalars().all()}
        convs: dict[str, Conversation] = {}
        for slug, interest in interests.items():
            for u in [reviewer, *people.values()]:
                convs[slug] = await join_interest_channel(db, u, interest.id)
                if not await db.get(UserInterest, (u.id, interest.id)):
                    db.add(UserInterest(user_id=u.id, interest_id=interest.id))
        await db.flush()

        demo_ids = [u.id for u in people.values()]
        speakers = {"senderismo": ["lucia", "carlos", "marta", "javier"], "cine": ["pablo", "elena", "javier"],
                    "tomar_algo": ["marta", "elena", "carlos"]}
        for slug in INTERESTS:
            lines = list(zip(speakers[slug], tx[slug]))
            conv = convs.get(slug)
            said = conv and (await db.execute(select(func.count()).select_from(Message).where(
                Message.conversation_id == conv.id, Message.sender_id.in_(demo_ids)))).scalar_one()
            if conv and not said:
                start = utcnow() - timedelta(hours=3)
                for i, (who, body) in enumerate(lines):
                    await _say(db, conv, people[who], body, start + timedelta(minutes=9 * i))

        p = people
        if "senderismo" in convs:
            hike = await _post(db, convs["senderismo"], p["lucia"], [p["carlos"], p["marta"], reviewer],
                               kind="meetup", title=tx["hike"][0], body=tx["hike"][1],
                               starts_at=_next(5, 9), ends_at=_next(5, 12), place=tx["hike"][2],
                               capacity=10, comments_mode="all", join_mode="open")
            await _post(db, convs["senderismo"], p["javier"], [], kind="thread",
                        title=tx["question"][0], body=tx["question"][1], comments_mode="all")
            chat = await db.get(Conversation, hike.chat_conversation_id) if hike.chat_conversation_id else None
            if chat and not (await db.execute(select(func.count()).select_from(Message).where(
                    Message.conversation_id == chat.id, Message.sender_id.in_(demo_ids)))).scalar_one():
                start = utcnow() - timedelta(hours=1)
                await _say(db, chat, p["lucia"], tx["plan_chat"][0], start)
                await _say(db, chat, p["carlos"], tx["plan_chat"][1], start + timedelta(minutes=12))
        if "cine" in convs:
            await _post(db, convs["cine"], p["pablo"], [p["elena"], p["javier"]], kind="event",
                        title=tx["film"][0], body=tx["film"][1],
                        starts_at=_next(4, 21, 30), ends_at=_next(4, 23, 30), place=tx["film"][2],
                        capacity=None, comments_mode="all", join_mode="open")
        if "tomar_algo" in convs:
            coffee = await _post(db, convs["tomar_algo"], p["marta"], [], kind="notice",
                                 title=tx["coffee"][0], body=tx["coffee"][1],
                                 comments_mode="all")
            if not (await db.execute(select(func.count()).select_from(BoardComment).where(BoardComment.post_id == coffee.id))).scalar_one():
                db.add(BoardComment(post_id=coffee.id, author_id=p["elena"].id, body=tx["comments"][0], created_at=utcnow() - timedelta(hours=5)))
                db.add(BoardComment(post_id=coffee.id, author_id=p["carlos"].id, body=tx["comments"][1], created_at=utcnow() - timedelta(hours=4)))
        await db.commit()
        return {"reviewer": reviewer.id, "people": len(people), "communities": len(convs)}


if __name__ == "__main__":
    args = sys.argv[1:]
    lang = "es"
    if "--lang" in args:
        i = args.index("--lang")
        lang = args[i + 1] if i + 1 < len(args) else "es"
        args = args[:i] + args[i + 2:]
    if len(args) != 1 or lang not in TEXTS:
        raise SystemExit(f"Usage: python -m app.demo.play_review <reviewer email> [--lang {'|'.join(TEXTS)}]")
    print(asyncio.run(seed(args[0], lang)))
