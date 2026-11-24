"""Administration endpoints."""

from sqlalchemy import select, update

from app.core.models import Conversation, Interest, User
from app.accounts.common import normalize_phone as _normalize_phone
from app.core.security import hash_password
from app.messaging.moderation import PHONE_RE, contains_toxicity as _contains_toxicity

from tests.helpers import register, verified_token  # noqa: F401


async def test_deleting_a_channel_in_use_is_refused_cleanly(client, db_session):
    admin = await client.post("/admin/login", json={"username": "admin@test.local", "password": "admin-test-password"})
    headers = {"Authorization": f"Bearer {admin.json()['access_token']}"}
    async with db_session() as db:
        interest = (await db.execute(select(Interest).where(Interest.slug == "cine"))).scalar_one()
        db.add(Conversation(kind="channel", province="Madrid", age_range="31_60", interest_id=interest.id,
                            slow_mode_seconds=0, rules_markdown="", policy_json={}))
        await db.commit()
        interest_id = interest.id
    res = await client.delete(f"/admin/interests/{interest_id}", headers=headers)
    assert res.status_code == 409


async def test_debug_logs_endpoint_is_off_by_default(client):
    res = await client.get("/admin/compose-logs")
    assert res.status_code == 404
