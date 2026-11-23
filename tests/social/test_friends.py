"""Friend requests."""

from sqlalchemy import select, update

from app.core.models import Conversation, Interest, User
from app.accounts.common import normalize_phone as _normalize_phone
from app.core.security import hash_password
from app.messaging.moderation import PHONE_RE, contains_toxicity as _contains_toxicity

from tests.helpers import register, verified_token  # noqa: F401


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
