"""The WebSocket delivers new messages and typing to the other members."""

from starlette.testclient import TestClient

from app.core import redis_conn
from app.main import app


def _user(tc, email, name):
    from tests.helpers import _phone
    _phone[0] += 1
    assert tc.post("/auth/register", json={"email": email, "phone": str(_phone[0]), "password": "secret123", "display_name": name, "first_name": name, "last_name": "Prueba",
                                           "dob": "1990-01-01", "province": "Madrid"}).status_code == 200
    return email


def test_message_and_typing_reach_the_other_member():
    redis_conn._client = None  # the test client runs the app in its own event loop
    with TestClient(app) as tc:
        _user(tc, "ana@example.com", "Ana")
        _user(tc, "bea@example.com", "Bea")
        tc.portal.call(_verify_all)
        ana = {"Authorization": "Bearer " + tc.post("/auth/login", json={"email": "ana@example.com", "password": "secret123"}).json()["access_token"]}
        bea = {"Authorization": "Bearer " + tc.post("/auth/login", json={"email": "bea@example.com", "password": "secret123"}).json()["access_token"]}
        for h in (ana, bea):
            tc.post("/me/interests", json={"interest_slugs": ["cine"]}, headers=h)
        conv_id = tc.get("/conversations", headers=ana).json()[0]["id"]

        assert tc.post("/realtime/ticket", headers=ana).status_code == 200
        ticket = tc.post("/realtime/ticket", headers=bea).json()["ticket"]
        with tc.websocket_connect(f"/ws?ticket={ticket}") as ws:
            assert ws.receive_json()["type"] == "hello"
            tc.post(f"/conversations/{conv_id}/messages", json={"body": "¡Hola!"}, headers=ana)
            event = ws.receive_json()
            assert event["type"] == "message.created" and event["message"]["body"] == "¡Hola!"
            assert event["message"]["sender"]["display_name"] == "Ana"
        # A ticket works once.
        try:
            with tc.websocket_connect(f"/ws?ticket={ticket}") as ws:
                ws.receive_json()
            reused = True
        except Exception:
            reused = False
        assert not reused
    redis_conn._client = None


async def _verify_all():
    from sqlalchemy import update
    from app.core.db import SessionLocal
    from app.core.models import User
    async with SessionLocal() as db:
        await db.execute(update(User).values(email_verified=True))
        await db.commit()
