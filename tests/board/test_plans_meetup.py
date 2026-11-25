"""Plans like Meetup: companions, online plans, plans that repeat, check-in, ratings, co-organisers and calendars;
communities with join questions and their own age span."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.core.models import BoardAttendee, BoardPost, BoardSeries

from tests.board.test_board import _community, _post, iso, soon
from tests.helpers import make_user


async def _people(client, db_session, n, dob="1990-05-01"):
    return [await make_user(client, db_session, f"p{i}.{dob}@example.com", f"Person{i}", dob=dob) for i in range(n)]


async def test_companions_take_places_and_a_party_waits_whole(client, db_session):
    owner, ana, bea, cris = await _people(client, db_session, 4)
    com = await _community(client, owner, ana, bea, cris)
    post = await _post(client, owner[0], com["id"], capacity=4, max_guests=2)
    assert (await client.post(f"/posts/{post['id']}/attend", json={"guests": 3}, headers=ana[0])).status_code == 400  # more than allowed
    assert (await client.post(f"/posts/{post['id']}/attend", json={"guests": 2}, headers=ana[0])).json()["status"] == "going"  # 1+3 = 4
    assert (await client.post(f"/posts/{post['id']}/attend", json={"guests": 1}, headers=bea[0])).json()["status"] == "waitlist"
    assert (await client.post(f"/posts/{post['id']}/attend", headers=cris[0])).json()["status"] == "waitlist"
    seen = (await client.get(f"/posts/{post['id']}", headers=owner[0])).json()
    assert seen["going_count"] == 4 and seen["max_guests"] == 2
    # Ana brings one fewer: one place frees up, Bea's party of 2 does not fit, Cris goes up
    await client.put(f"/posts/{post['id']}/guests", json={"guests": 1}, headers=ana[0])
    statuses = {a["display_name"]: a["status"] for a in (await client.get(f"/posts/{post['id']}/attendees", headers=owner[0])).json()}
    assert statuses["Person3"] == "going" and statuses["Person2"] == "waitlist"


async def test_online_link_only_for_people_going(client, db_session):
    owner, ana = await _people(client, db_session, 2)
    com = await _community(client, owner, ana)
    post = await _post(client, owner[0], com["id"], mode="online", online_url="https://meet.example.com/abc")
    assert (await client.get(f"/posts/{post['id']}", headers=ana[0])).json()["online_url"] is None
    await client.post(f"/posts/{post['id']}/attend", headers=ana[0])
    got = (await client.get(f"/posts/{post['id']}", headers=ana[0])).json()
    assert got["online_url"] == "https://meet.example.com/abc" and got["mode"] == "online"


async def test_a_weekly_plan_makes_its_dates_and_edits_the_following(client, db_session):
    owner, ana = await _people(client, db_session, 2)
    com = await _community(client, owner, ana)
    first = await _post(client, owner[0], com["id"], starts_at=soon(24), repeat="weekly", tz="Europe/Madrid")
    assert first["series"]["freq"] == "weekly"
    async with db_session() as db:
        dates = (await db.execute(select(BoardPost).where(BoardPost.series_id == first["series"]["id"]).order_by(BoardPost.starts_at))).scalars().all()
    assert 4 <= len(dates) <= 6 and all(d.chat_conversation_id for d in dates)
    gaps = {round((dates[i + 1].starts_at - dates[i].starts_at).total_seconds() / 86400) for i in range(len(dates) - 1)}
    assert gaps <= {7}  # one week apart (the hour stays even over a summer time change)
    second = dates[1]
    await client.patch(f"/posts/{second.id}", json={"place": "Plaza Mayor", "scope": "following"}, headers=owner[0])
    async with db_session() as db:
        places = [p.place for p in (await db.execute(select(BoardPost).where(BoardPost.series_id == first["series"]["id"]).order_by(BoardPost.starts_at))).scalars().all()]
        tpl = (await db.get(BoardSeries, first["series"]["id"])).template
    assert places[0] != "Plaza Mayor" and set(places[1:]) == {"Plaza Mayor"} and tpl["place"] == "Plaza Mayor"
    await client.delete(f"/posts/{dates[2].id}?scope=following", headers=owner[0])
    async with db_session() as db:
        live = (await db.execute(select(BoardPost).where(BoardPost.series_id == first["series"]["id"], BoardPost.deleted_at.is_(None)))).scalars().all()
        series = await db.get(BoardSeries, first["series"]["id"])
    assert len(live) == 2 and series.ended


async def test_monthly_keeps_the_weekday_of_the_month():
    from app.board.service import occurrence
    s = BoardSeries(freq="monthly", tz="Europe/Madrid", first_starts_at=datetime(2026, 1, 8, 18, tzinfo=timezone.utc))  # 2nd Thursday
    days = [occurrence(s, k).astimezone(timezone.utc) for k in range(4)]
    assert all(d.weekday() == 3 and 8 <= d.day <= 14 for d in days)


async def test_checkin_ratings_and_cohosts(client, db_session):
    owner, ana, bea = await _people(client, db_session, 3)
    com = await _community(client, owner, ana, bea)
    post = await _post(client, owner[0], com["id"], starts_at=soon(1))
    for p in (ana, bea):
        await client.post(f"/posts/{post['id']}/attend", headers=p[0])
    # Ana as co-organiser: she marks attendance; Bea cannot
    res = await client.put(f"/posts/{post['id']}/cohosts", json={"user_ids": [ana[1]["id"]]}, headers=owner[0])
    assert [c["id"] for c in res.json()["cohosts"]] == [ana[1]["id"]]
    assert (await client.post(f"/posts/{post['id']}/attendees/{bea[1]['id']}/checkin", json={"attended": True}, headers=bea[0])).status_code == 403
    assert (await client.post(f"/posts/{post['id']}/attendees/{bea[1]['id']}/checkin", json={"attended": True}, headers=ana[0])).json()["attended"] is True
    # not rated before it starts; after it, Bea rates; the organisers see the average without names
    assert (await client.post(f"/posts/{post['id']}/rating", json={"rating": 5}, headers=bea[0])).status_code == 409
    async with db_session() as db:
        await db.execute(update(BoardPost).where(BoardPost.id == post["id"]).values(starts_at=datetime.now(timezone.utc) - timedelta(hours=3)))
        await db.commit()
    assert (await client.post(f"/posts/{post['id']}/rating", json={"rating": 4, "note": "Muy bien"}, headers=bea[0])).status_code == 200
    assert (await client.post(f"/posts/{post['id']}/rating", json={"rating": 5}, headers=owner[0])).status_code == 403  # the organiser
    r = (await client.get(f"/posts/{post['id']}/ratings", headers=owner[0])).json()
    assert r["average"] == 4.0 and r["notes"] == ["Muy bien"]
    assert (await client.get(f"/posts/{post['id']}/ratings", headers=bea[0])).status_code == 403
    assert (await client.get(f"/posts/{post['id']}", headers=bea[0])).json()["rating"] is None
    stats = (await client.get(f"/communities/{com['id']}/stats", headers=owner[0])).json()
    assert stats["members"] == 3 and stats["attendance"]["came"] == 1 and stats["rating"]["average"] == 4.0
    assert (await client.get(f"/communities/{com['id']}/stats", headers=bea[0])).status_code == 403


async def test_calendar_links(client, db_session):
    owner, ana = await _people(client, db_session, 2)
    com = await _community(client, owner, ana)
    post = await _post(client, owner[0], com["id"], title="Cena, tapas; y más")
    url = post["calendar_url"]
    text = (await client.get(url)).text
    assert "BEGIN:VEVENT" in text and r"SUMMARY:Cena\, tapas\; y más" in text
    assert (await client.get(url.replace("?s=", "?s=x"))).status_code == 404
    await client.post(f"/posts/{post['id']}/attend", headers=ana[0])
    path = (await client.get("/me/calendar", headers=ana[0])).json()["path"]
    assert f"plan-{post['id']}@meetgo.app" in (await client.get(path)).text
    new = (await client.get("/me/calendar?reset=1", headers=ana[0])).json()["path"]
    assert new != path and (await client.get(path)).status_code == 404


async def test_community_age_span_and_join_questions(client, db_session):
    young = await make_user(client, db_session, "young@example.com", "Joven", dob="2000-01-01")  # 18-30
    mid = await make_user(client, db_session, "mid@example.com", "Medio", dob="1988-01-01")  # 31-60, in the span
    old = await make_user(client, db_session, "old@example.com", "Mayor", dob="1960-01-01")  # outside
    # the span must include its creator
    bad = await client.post("/communities", json={"title": "Treintañeros", "min_age": 30, "max_age": 45}, headers=young[0])
    assert bad.status_code == 400
    com = (await client.post("/communities", json={"title": "Entre 20 y 45", "min_age": 20, "max_age": 45, "access_mode": "request",
                                                   "join_questions": ["¿Por qué quieres entrar?"]}, headers=young[0])).json()
    assert com["min_age"] == 20 and com["join_questions"] == ["¿Por qué quieres entrar?"]
    assert any(c["id"] == com["id"] for c in (await client.get("/communities", headers=mid[0])).json())  # another range, same span
    assert not any(c["id"] == com["id"] for c in (await client.get("/communities", headers=old[0])).json())
    assert (await client.post(f"/communities/{com['id']}/join", headers=old[0])).status_code == 403
    assert (await client.post(f"/communities/{com['id']}/join", headers=mid[0])).status_code == 400  # no answers
    assert (await client.post(f"/communities/{com['id']}/join", json={"answers": ["Me gusta el grupo"]}, headers=mid[0])).json()["status"] == "requested"
    reqs = (await client.get(f"/communities/{com['id']}/requests", headers=young[0])).json()
    assert reqs[0]["answers"] == [{"question": "¿Por qué quieres entrar?", "answer": "Me gusta el grupo"}]
