import json
from datetime import datetime
from typing import Dict, Set

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as redis

from .models import RoomDiscipline, RoomMessage, User
from .moderation import decide_action, apply_action

class RoomHub:
    def __init__(self):
        self.rooms: Dict[int, Set[WebSocket]] = {}

    async def connect(self, room_id: int, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(room_id, set()).add(ws)

    def disconnect(self, room_id: int, ws: WebSocket):
        if room_id in self.rooms and ws in self.rooms[room_id]:
            self.rooms[room_id].remove(ws)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast(self, room_id: int, payload: dict):
        dead = []
        for ws in self.rooms.get(room_id, set()):
            try:
                await ws.send_text(json.dumps(payload, default=str))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(room_id, ws)

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
        return {"id": user_id, "display_name": "Unknown", "avatar_url": None}
    return {"id": u.id, "display_name": u.display_name, "avatar_url": u.avatar_url}

async def room_ws_loop(ws: WebSocket, room_id: int, user_id: int, db: AsyncSession, redis_client: redis.Redis):
    await hub.connect(room_id, ws)
    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)
            content = (data.get("content") or "").strip()
            if not content:
                continue

            muted, banned, info = await is_muted_or_banned(db, room_id, user_id)
            if banned:
                await ws.send_text(json.dumps({"type": "error", "code": "BANNED", "detail": info}))
                continue
            if muted:
                await ws.send_text(json.dumps({"type": "error", "code": "MUTED", "detail": info}))
                continue

            msg = RoomMessage(room_id=room_id, user_id=user_id, content=content)
            db.add(msg)
            await db.flush()

            action = await decide_action(db, redis_client, msg)
            await apply_action(db, msg, action)
            await db.commit()

            await hub.broadcast(room_id, {
                "type": "room_message",
                "message": {
                    "id": msg.id,
                    "room_id": msg.room_id,
                    "user_id": msg.user_id,
                    "user": await _user_summary(db, msg.user_id),
                    "content": "" if msg.is_deleted else msg.content,
                    "created_at": msg.created_at,
                    "is_deleted": msg.is_deleted,
                    "moderation_reason": msg.moderation_reason,
                }
            })
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(room_id, ws)
