import asyncio
import json
import logging
from datetime import datetime
from typing import Callable, Dict, Set

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as redis

from .config import settings
from .models import RoomDiscipline, RoomMessage, User
from .i18n import t
from .moderation import decide_action, apply_action
from .schemas import utc_iso

class RoomHub:
    def __init__(self):
        self.rooms: Dict[int, Set[WebSocket]] = {}
        self.room_user_counts: Dict[int, Dict[int, int]] = {}
        self.room_users: Dict[int, Dict[int, dict]] = {}
        self.ws_users: Dict[WebSocket, int] = {}

    async def connect(self, room_id: int, ws: WebSocket, user_id: int, user_summary: dict):
        await ws.accept()
        self.rooms.setdefault(room_id, set()).add(ws)
        self.ws_users[ws] = user_id
        counts = self.room_user_counts.setdefault(room_id, {})
        counts[user_id] = counts.get(user_id, 0) + 1
        users = self.room_users.setdefault(room_id, {})
        users[user_id] = user_summary

    def disconnect(self, room_id: int, ws: WebSocket, user_id: int | None = None):
        if room_id in self.rooms and ws in self.rooms[room_id]:
            self.rooms[room_id].remove(ws)
            if not self.rooms[room_id]:
                del self.rooms[room_id]
        if user_id is None:
            user_id = self.ws_users.pop(ws, None)
        else:
            self.ws_users.pop(ws, None)
        counts = self.room_user_counts.get(room_id)
        if counts and user_id in counts:
            counts[user_id] -= 1
            if counts[user_id] <= 0:
                del counts[user_id]
                users = self.room_users.get(room_id)
                if users and user_id in users:
                    del users[user_id]
        if counts is not None and not counts:
            self.room_user_counts.pop(room_id, None)
            self.room_users.pop(room_id, None)

    async def broadcast(self, room_id: int, payload: dict):
        text = json.dumps(payload, default=str)
        sockets = list(self.rooms.get(room_id, set()))

        async def send(ws: WebSocket):
            # A slow client must not delay everybody else in the room.
            await asyncio.wait_for(ws.send_text(text), timeout=5)

        results = await asyncio.gather(*(send(ws) for ws in sockets), return_exceptions=True)
        for ws, result in zip(sockets, results):
            if isinstance(result, Exception):
                self.disconnect(room_id, ws, None)

    def room_snapshot(self, room_id: int) -> dict:
        users = list((self.room_users.get(room_id) or {}).values())
        return {"room_id": room_id, "count": len(users), "users": users}

    def all_snapshots(self) -> list[dict]:
        return [self.room_snapshot(room_id) for room_id in self.room_users.keys()]

logger = logging.getLogger("meetgo.chat")
hub = RoomHub()

async def is_muted_or_banned(db: AsyncSession, room_id: int, user_id: int) -> tuple[bool, bool, str | None]:
    res = await db.execute(select(RoomDiscipline).where(RoomDiscipline.room_id == room_id, RoomDiscipline.user_id == user_id))
    disc = res.scalar_one_or_none()
    if not disc:
        return False, False, None
    if disc.is_banned:
        return False, True, "BANNED"
    if disc.muted_until and disc.muted_until > datetime.utcnow():
        return True, False, disc.muted_until.isoformat()
    return False, False, None

async def _user_summary(db: AsyncSession, user_id: int) -> dict:
    res = await db.execute(select(User).where(User.id == user_id))
    u = res.scalar_one_or_none()
    if not u:
        return {"id": user_id, "display_name": t("unknown_user"), "avatar_url": None}
    return {"id": u.id, "display_name": u.display_name, "avatar_url": u.avatar_url}

async def room_ws_loop(ws: WebSocket, room_id: int, user_id: int, session_factory: Callable[[], AsyncSession], redis_client: redis.Redis):
    # Each database operation uses its own short session, so an idle socket holds no connection.
    async with session_factory() as db:
        user_summary = await _user_summary(db, user_id)
    await hub.connect(room_id, ws, user_id, user_summary)
    await hub.broadcast(room_id, {"type": "room_presence", "presence": hub.room_snapshot(room_id)})
    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            content = (data.get("content") or "").strip() if isinstance(data, dict) else ""
            if not content:
                continue
            if len(content) > settings.MAX_MESSAGE_CHARS:
                await ws.send_text(json.dumps({"type": "error", "code": "TOO_LONG", "detail": settings.MAX_MESSAGE_CHARS}))
                continue

            async with session_factory() as db:
                muted, banned, info = await is_muted_or_banned(db, room_id, user_id)
                if banned or muted:
                    await db.rollback()
                    code = "BANNED" if banned else "MUTED"
                    await ws.send_text(json.dumps({"type": "error", "code": code, "detail": info}))
                    continue

                msg = RoomMessage(room_id=room_id, user_id=user_id, content=content)
                db.add(msg)
                await db.flush()

                action = await decide_action(db, redis_client, msg)
                await apply_action(db, msg, action)
                payload_msg = {
                    "id": msg.id,
                    "room_id": msg.room_id,
                    "user_id": msg.user_id,
                    "user": user_summary,
                    "content": "" if msg.is_deleted else msg.content,
                    "created_at": utc_iso(msg.created_at),
                    "is_deleted": msg.is_deleted,
                    "moderation_reason": msg.moderation_reason,
                }
                await db.commit()

            await hub.broadcast(room_id, {
                "type": "room_message",
                "message": payload_msg,
            })
    except WebSocketDisconnect:
        logger.info("WS disconnect room=%s user=%s", room_id, user_id)
    except Exception:
        logger.exception("WS error room=%s user=%s", room_id, user_id)
    finally:
        hub.disconnect(room_id, ws, user_id)
        await hub.broadcast(room_id, {"type": "room_presence", "presence": hub.room_snapshot(room_id)})
