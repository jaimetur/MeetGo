"""Demo content for the Google Play reviewer's account."""

from sqlalchemy import func, select

from app.core.models import BoardPost, User
from app.demo.play_review import seed

from tests.helpers import make_user


async def test_fills_the_reviewer_zone_and_runs_again(client, db_session):
    rev = await make_user(client, db_session, "playreview@example.com", "Play Review")
    out = await seed("playreview@example.com")
    assert out["people"] == 6 and out["communities"] == 3
    again = await seed("PlayReview@example.com")
    assert again == out

    mine = (await client.get("/communities", params={"mine": 1}, headers=rev[0])).json()
    assert {c["slug"] for c in mine} == {"senderismo", "cine", "tomar_algo"}
    assert all(c["member_count"] == 7 for c in mine)  # the reviewer and six demo people, bots not counted
    feed = (await client.get("/board/feed", headers=rev[0])).json()["posts"]
    assert {p["kind"] for p in feed} == {"meetup", "event", "thread", "notice"}
    plans = (await client.get("/me/plans", headers=rev[0])).json()
    assert [p["title"] for p in plans] == ["Ruta suave por el sendero del río"] and plans[0]["chat_conversation_id"]
    convs = (await client.get("/conversations", headers=rev[0])).json()
    assert any(c["kind"] == "group" for c in convs)  # the plan chat

    async with db_session() as db:
        demo = (await db.execute(select(User).where(User.email.like("%@demo.meetgo.invalid")))).scalars().all()
        assert len(demo) == 6 and all(u.password_hash is None for u in demo)
        assert (await db.execute(select(func.count()).select_from(BoardPost))).scalar_one() == 4
