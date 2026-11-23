"""Regression tests for the security and stability fixes."""

from sqlalchemy import select, update

from src.models import Conversation, Interest, User
from src.routers.common import normalize_phone as _normalize_phone
from src.security import hash_password
from src.services.moderation import PHONE_RE, contains_toxicity as _contains_toxicity


async def register(client, email="ana@example.com", name="Ana", dob="1990-05-01", phone="612345678", **extra):
    payload = {"email": email, "phone": phone, "password": "secret123", "display_name": name,
               "dob": dob, "country": "ES", "province": "Madrid", **extra}
    return await client.post("/auth/register", json=payload)


async def verified_token(client, db_session, email="ana@example.com", **kw):
    res = await register(client, email=email, **kw)
    assert res.status_code == 200, res.text
    async with db_session() as db:
        await db.execute(update(User).where(User.email == email).values(email_verified=True))
        await db.commit()
    res = await client.post("/auth/login", json={"email": email, "password": "secret123"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def test_admin_login_has_no_built_in_credentials(client):
    res = await client.post("/admin/login", json={"username": "admin", "password": "admin"})
    assert res.status_code == 401
    res = await client.post("/admin/login", json={"username": "admin@test.local", "password": "admin-test-password"})
    assert res.status_code == 200


async def test_failed_admin_login_never_promotes_a_regular_account(client, db_session):
    assert (await register(client, email="mallory@example.com", name="admin", phone="611111111")).status_code == 200
    res = await client.post("/admin/login", json={"username": "admin", "password": "admin"})
    assert res.status_code == 401
    async with db_session() as db:
        user = (await db.execute(select(User).where(User.email == "mallory@example.com"))).scalar_one()
    assert user.role == "user"


async def test_login_refuses_accounts_without_a_password(client, db_session):
    async with db_session() as db:
        db.add(User(email="legacy@example.com", phone="+34600000001", display_name="Legacy", dob="1985-01-01",
                    age_range="31_50", province="Madrid", email_verified=True, password_hash=None))
        await db.commit()
    res = await client.post("/auth/login", json={"email": "legacy@example.com", "password": "anything"})
    assert res.status_code == 401
    res = await client.post("/auth/login", json={"email": "legacy@example.com"})
    assert res.status_code == 401


async def test_registration_answers_400_for_bad_birth_dates(client):
    assert (await register(client, dob="2015-01-01")).status_code == 400
    assert (await register(client, dob="1990-02-31")).status_code == 400
    assert (await register(client, dob="hello")).status_code == 400


async def test_crossed_friend_requests_become_one_friendship(client, db_session):
    ana = await verified_token(client, db_session, email="ana@example.com", name="Ana", phone="612000001")
    bea = await verified_token(client, db_session, email="bea@example.com", name="Bea", phone="612000002")
    me_ana = (await client.get("/me", headers=ana)).json()
    me_bea = (await client.get("/me", headers=bea)).json()
    assert (await client.post("/friends/requests", json={"to_user_id": me_bea["id"]}, headers=ana)).status_code == 200
    res = await client.post("/friends/requests", json={"to_user_id": me_ana["id"]}, headers=bea)
    assert res.status_code == 200
    assert res.json()["status"] == "ACCEPTED"
    friends = (await client.get("/friends", headers=ana)).json()
    assert [f["id"] for f in friends] == [me_bea["id"]]


async def test_deleting_a_channel_in_use_is_refused_cleanly(client, db_session):
    admin = await client.post("/admin/login", json={"username": "admin@test.local", "password": "admin-test-password"})
    headers = {"Authorization": f"Bearer {admin.json()['access_token']}"}
    async with db_session() as db:
        interest = (await db.execute(select(Interest).where(Interest.slug == "cine"))).scalar_one()
        db.add(Conversation(kind="channel", province="Madrid", age_range="31_50", interest_id=interest.id,
                            slow_mode_seconds=0, rules_markdown="", policy_json={}))
        await db.commit()
        interest_id = interest.id
    res = await client.delete(f"/admin/interests/{interest_id}", headers=headers)
    assert res.status_code == 409


async def test_api_datetimes_are_utc_with_z(client, db_session):
    headers = await verified_token(client, db_session)
    res = await client.post("/posts", json={"content": "Hola"}, headers=headers)
    assert res.json()["created_at"].endswith("Z")


async def test_debug_logs_endpoint_is_off_by_default(client):
    res = await client.get("/admin/compose-logs")
    assert res.status_code == 404


def test_moderation_matches_whole_words_only():
    assert not _contains_toxicity("Tengo buena reputación")
    assert not _contains_toxicity("La disputa se resolvió")
    assert not _contains_toxicity("el cómputo total")
    assert _contains_toxicity("eres un IMBÉCIL")


def test_phone_filter():
    assert PHONE_RE.search("llámame al 612 34 56 78")
    assert PHONE_RE.search("+44 7911 123456")
    assert not PHONE_RE.search("quedamos el 2026-11-23 10:00")
    assert not PHONE_RE.search("son 11 km y 4 h")


def test_phone_numbers_get_the_country_prefix():
    assert _normalize_phone("612 345 678", "ES") == "+34612345678"
    assert _normalize_phone("+34 612 345 678", "ES") == "+34612345678"
    assert _normalize_phone("0044 7911 123456", "ES") == "+447911123456"
    assert _normalize_phone("912345678", "PT") == "+351912345678"


async def test_existing_admin_password_is_not_reset_on_restart(client, db_session):
    from src.main import startup
    async with db_session() as db:
        await db.execute(update(User).where(User.role == "admin").values(password_hash=hash_password("changed-password")))
        await db.commit()
    await startup()
    res = await client.post("/admin/login", json={"username": "admin@test.local", "password": "changed-password"})
    assert res.status_code == 200
