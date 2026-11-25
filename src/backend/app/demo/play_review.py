"""Content for the Google Play reviewer's account, so the review shows MeetGo as it is used.

The reviewer's account is created by a person (administration → Users, or signing up) with a password only they
know; this fills its zone with believable, made-up activity: a few demo people, interest communities with chat, board
posts and comments, and plans with people going and their plan chat, one of them with the reviewer going.
Demo people have an address at demo.meetgo.invalid, no password (they cannot sign in) and "Demo account" in their bio.
It can run again: what already exists is kept.

    docker compose exec app python -m app.demo.play_review playreview@meetgo.app
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

DOMAIN = "demo.meetgo.invalid"
BIO = "Cuenta de demostración de MeetGo."
PEOPLE = [("lucia", "Lucía Martín"), ("carlos", "Carlos Ruiz"), ("marta", "Marta Gil"),
          ("pablo", "Pablo Ortega"), ("elena", "Elena Navarro"), ("javier", "Javier Soto")]
INTERESTS = ["senderismo", "cine", "tomar_algo"]
CHATS = {
    "senderismo": [("lucia", "¡Buenas! ¿Alguien se anima a una ruta este finde?"),
                   ("carlos", "Yo me apunto si es por la mañana, que luego aprieta el calor 🥵"),
                   ("marta", "He subido la ruta del sábado al tablón, quedan plazas 😉"),
                   ("javier", "Perfecto, llevo bastones de sobra por si alguien los necesita")],
    "cine": [("pablo", "¿Habéis visto el cartel del cine de verano? Este viernes ponen un clásico"),
             ("elena", "¡Sí! Yo voy seguro, ¿quedamos antes para cenar algo?"),
             ("javier", "Me apunto a la cena 🍕")],
    "tomar_algo": [("marta", "Buenos días ☕ ¿Algún sitio nuevo para desayunar por el centro?"),
             ("elena", "La cafetería de la plaza tiene unas tostadas buenísimas"),
             ("carlos", "Confirmo, y el café está muy bien")],
}


def _next(weekday: int, hour: int, minute: int = 0) -> datetime:
    """The next given weekday (0 = Monday) at that time in Madrid, in UTC; at least two days ahead."""
    tz = ZoneInfo("Europe/Madrid")
    today = datetime.now(tz).date()
    days = (weekday - today.weekday()) % 7 or 7
    if days < 2:
        days += 7
    return datetime.combine(today + timedelta(days=days), time(hour, minute), tz).astimezone(timezone.utc)


async def _person(db, reviewer: User, key: str, name: str) -> User:
    email = f"{key}@{DOMAIN}"
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user:
        return user
    first, last = name.split(" ", 1)
    # the alias is one word and unique: the first name, with the account key when someone already has it
    alias = first if not (await db.execute(select(User.id).where(func.lower(User.display_name) == first.lower()))).first() else f"{first}_{key}"
    user = User(email=email, phone=None, password_hash=None, display_name=alias, first_name=first, last_name=last, dob=reviewer.dob,
                age_range=reviewer.age_range, country=reviewer.country, province=reviewer.province, accept_dm=True,
                bio=BIO, role="user", email_verified=True)
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


async def seed(email: str) -> dict:
    async with SessionLocal() as db:
        reviewer = (await db.execute(select(User).where(func.lower(User.email) == email.strip().lower()))).scalar_one_or_none()
        if not reviewer:
            raise SystemExit(f"No account with the address {email}: create it first (administration → Users).")
        people = {k: await _person(db, reviewer, k, n) for k, n in PEOPLE}
        interests = {i.slug: i for i in (await db.execute(select(Interest).where(Interest.slug.in_(INTERESTS)))).scalars().all()}
        convs: dict[str, Conversation] = {}
        for slug, interest in interests.items():
            for u in [reviewer, *people.values()]:
                convs[slug] = await join_interest_channel(db, u, interest.id)
                if not await db.get(UserInterest, (u.id, interest.id)):
                    db.add(UserInterest(user_id=u.id, interest_id=interest.id))
        await db.flush()

        demo_ids = [u.id for u in people.values()]
        for slug, lines in CHATS.items():
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
                               kind="meetup", title="Ruta suave por el sendero del río",
                               body="Unos 8 km llanos, ideal para empezar. Trae agua, gorra y calzado cómodo. 🥾",
                               starts_at=_next(5, 9), ends_at=_next(5, 12), place="Aparcamiento del parque del río",
                               capacity=10, comments_mode="all", join_mode="open")
            await _post(db, convs["senderismo"], p["javier"], [], kind="thread",
                        title="Rutas fáciles para empezar: ¿recomendaciones?",
                        body="Estoy empezando y busco rutas de menos de 10 km. ¿Cuáles os gustan?", comments_mode="all")
            chat = await db.get(Conversation, hike.chat_conversation_id) if hike.chat_conversation_id else None
            if chat and not (await db.execute(select(func.count()).select_from(Message).where(
                    Message.conversation_id == chat.id, Message.sender_id.in_(demo_ids)))).scalar_one():
                start = utcnow() - timedelta(hours=1)
                await _say(db, chat, p["lucia"], "¡Hola a todos! Nos vemos a las 9 en el aparcamiento 👋", start)
                await _say(db, chat, p["carlos"], "Allí estaré. ¿Alguien necesita que le lleve en coche?", start + timedelta(minutes=12))
        if "cine" in convs:
            await _post(db, convs["cine"], p["pablo"], [p["elena"], p["javier"]], kind="event",
                        title="Cine de verano: un clásico al aire libre",
                        body="Sesión en el auditorio al aire libre. Quedamos antes para cenar algo cerca.",
                        starts_at=_next(4, 21, 30), ends_at=_next(4, 23, 30), place="Auditorio municipal",
                        capacity=None, comments_mode="all", join_mode="open")
        if "tomar_algo" in convs:
            coffee = await _post(db, convs["tomar_algo"], p["marta"], [], kind="notice",
                                 title="¿Café el domingo por la mañana?",
                                 body="Me apetece conocer gente nueva de la zona. ¿Alguien se apunta a un café tranquilo?",
                                 comments_mode="all")
            if not (await db.execute(select(func.count()).select_from(BoardComment).where(BoardComment.post_id == coffee.id))).scalar_one():
                db.add(BoardComment(post_id=coffee.id, author_id=p["elena"].id, body="¡Yo me apunto! ☕", created_at=utcnow() - timedelta(hours=5)))
                db.add(BoardComment(post_id=coffee.id, author_id=p["carlos"].id, body="Si es después de las 11, cuenta conmigo", created_at=utcnow() - timedelta(hours=4)))
        await db.commit()
        return {"reviewer": reviewer.id, "people": len(people), "communities": len(convs)}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python -m app.demo.play_review <reviewer email>")
    print(asyncio.run(seed(sys.argv[1])))
