"""How the API writes dates."""

from sqlalchemy import select, update

from src.models import Conversation, Interest, User
from src.routers.common import normalize_phone as _normalize_phone
from src.security import hash_password
from src.services.moderation import PHONE_RE, contains_toxicity as _contains_toxicity

from tests.helpers import register, verified_token  # noqa: F401


async def test_api_datetimes_are_utc_with_z(client, db_session):
    headers = await verified_token(client, db_session)
    res = await client.post("/posts", json={"content": "Hola"}, headers=headers)
    assert res.json()["created_at"].endswith("Z")
