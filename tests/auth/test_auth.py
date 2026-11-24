"""Sign-in, sign-up and the administrator account."""

from sqlalchemy import select, update

from app.core.models import Conversation, Interest, User
from app.accounts.common import normalize_phone as _normalize_phone
from app.core.security import hash_password
from app.messaging.moderation import PHONE_RE, contains_toxicity as _contains_toxicity

from tests.helpers import register, verified_token  # noqa: F401


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
                    age_range="31_60", province="Madrid", email_verified=True, password_hash=None))
        await db.commit()
    res = await client.post("/auth/login", json={"email": "legacy@example.com", "password": "anything"})
    assert res.status_code == 401
    res = await client.post("/auth/login", json={"email": "legacy@example.com"})
    assert res.status_code == 401


async def test_registration_answers_400_for_bad_birth_dates(client):
    assert (await register(client, dob="2015-01-01")).status_code == 400
    assert (await register(client, dob="1990-02-31")).status_code == 400
    assert (await register(client, dob="hello")).status_code == 400


def test_phone_numbers_get_the_country_prefix():
    assert _normalize_phone("612 345 678", "ES") == "+34612345678"
    assert _normalize_phone("+34 612 345 678", "ES") == "+34612345678"
    assert _normalize_phone("0044 7911 123456", "ES") == "+447911123456"
    assert _normalize_phone("912345678", "PT") == "+351912345678"


async def test_existing_admin_password_is_not_reset_on_restart(client, db_session):
    from app.main import startup
    async with db_session() as db:
        await db.execute(update(User).where(User.role == "admin").values(password_hash=hash_password("changed-password")))
        await db.commit()
    await startup()
    res = await client.post("/admin/login", json={"username": "admin@test.local", "password": "changed-password"})
    assert res.status_code == 200
