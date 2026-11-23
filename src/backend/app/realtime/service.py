"""Real-time events: one WebSocket per signed-in tab or app, fanned out through Redis.

Any process publishes {"to": [user ids], "event": {...}} on one Redis channel; every
process delivers it to the sockets of those users that it holds. Presence is a
per-user connection counter in Redis with a short expiry, refreshed while connected.
"""

import asyncio
import json
import logging
import secrets
import time

from fastapi import WebSocket
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.models import ConversationMember
from app.core.redis_conn import get_redis

logger = logging.getLogger("meetgo.realtime")
CHANNEL = "mg:rt"
PRESENCE_TTL = 90
TICKET_TTL = 60


class Gateway:
    def __init__(self) -> None:
        self.sockets: dict[int, set[WebSocket]] = {}
        self._task: asyncio.Task | None = None

    def add(self, user_id: int, ws: WebSocket) -> None:
        self.sockets.setdefault(user_id, set()).add(ws)

    def remove(self, user_id: int, ws: WebSocket) -> None:
        conns = self.sockets.get(user_id)
        if conns:
            conns.discard(ws)
            if not conns:
                self.sockets.pop(user_id, None)

    async def deliver_local(self, to: list[int], event: dict) -> None:
        text = json.dumps(event, default=str)
        targets = [(uid, ws) for uid in set(to) for ws in list(self.sockets.get(uid, ()))]
        if not targets:
            return

        async def send(ws: WebSocket):
            # A slow client must not delay everybody else.
            await asyncio.wait_for(ws.send_text(text), timeout=5)

        results = await asyncio.gather(*(send(ws) for _, ws in targets), return_exceptions=True)
        for (uid, ws), result in zip(targets, results):
            if isinstance(result, Exception):
                self.remove(uid, ws)

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _listen(self) -> None:
        delay = 1.0
        while True:
            try:
                pubsub = get_redis().pubsub()
                await pubsub.subscribe(CHANNEL)
                delay = 1.0
                async for item in pubsub.listen():
                    if item.get("type") != "message":
                        continue
                    try:
                        data = json.loads(item["data"])
                        await self.deliver_local(data.get("to") or [], data.get("event") or {})
                    except Exception:
                        logger.exception("Could not deliver a real-time event")
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("Real-time listener lost Redis; retrying in %.0f s", delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)


gateway = Gateway()


async def publish(to, event: dict) -> None:
    ids = sorted({int(u) for u in to if u})
    if not ids:
        return
    try:
        await get_redis().publish(CHANNEL, json.dumps({"to": ids, "event": event}, default=str))
    except Exception:
        # Redis down: still reach the sockets this process holds.
        logger.warning("Redis publish failed; delivering locally only")
        await gateway.deliver_local(ids, event)


# ---------- tickets ----------

async def create_ticket(user_id: int) -> str:
    ticket = secrets.token_urlsafe(24)
    await get_redis().set(f"ws:ticket:{ticket}", str(user_id), ex=TICKET_TTL)
    return ticket


async def consume_ticket(ticket: str) -> int | None:
    if not ticket:
        return None
    value = await get_redis().getdel(f"ws:ticket:{ticket}")
    return int(value) if value else None


# ---------- presence ----------

async def presence_connect(user_id: int) -> bool:
    """Count one more connection; True when the user just came online."""
    r = get_redis()
    count = await r.incr(f"presence:{user_id}")
    await r.expire(f"presence:{user_id}", PRESENCE_TTL)
    return count == 1


async def presence_refresh(user_id: int) -> None:
    await get_redis().expire(f"presence:{user_id}", PRESENCE_TTL)


async def presence_disconnect(user_id: int) -> bool:
    """Count one connection less; True when the user just went offline."""
    r = get_redis()
    count = await r.decr(f"presence:{user_id}")
    if count <= 0:
        await r.delete(f"presence:{user_id}")
        return True
    return False


async def online_ids(user_ids) -> set[int]:
    ids = [int(u) for u in user_ids]
    if not ids:
        return set()
    values = await get_redis().mget([f"presence:{u}" for u in ids])
    return {u for u, v in zip(ids, values) if v and int(v) > 0}


# ---------- conversation members (cached briefly for typing events) ----------

_members_cache: dict[int, tuple[float, list[int]]] = {}
MEMBERS_TTL = 30.0


async def member_ids(conversation_id: int) -> list[int]:
    hit = _members_cache.get(conversation_id)
    if hit and time.monotonic() - hit[0] < MEMBERS_TTL:
        return hit[1]
    async with SessionLocal() as db:
        res = await db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id, ConversationMember.banned.is_(False),
                ConversationMember.away.is_(False),
            )
        )
        ids = list(res.scalars().all())
    _members_cache[conversation_id] = (time.monotonic(), ids)
    return ids


def invalidate_members(conversation_id: int) -> None:
    _members_cache.pop(conversation_id, None)


async def typing_allowed(conversation_id: int, user_id: int) -> bool:
    """At most one typing event every 3 seconds per person and conversation."""
    return bool(await get_redis().set(f"typing:{conversation_id}:{user_id}", "1", nx=True, ex=3))
