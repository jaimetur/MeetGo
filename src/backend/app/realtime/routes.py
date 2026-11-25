import asyncio
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.deps import get_current_user
from app.core.models import ConversationMember, User
from app.realtime import service as realtime
from app.conversations.service import user_summary

router = APIRouter(tags=["realtime"])
logger = logging.getLogger("meetgo.ws")
HEARTBEAT = 30


@router.post("/realtime/ticket", response_model=dict)
async def ticket(user: User = Depends(get_current_user)):
    """A one-use pass to open the WebSocket, so the long-lived token never travels in a URL."""
    return {"ticket": await realtime.create_ticket(user.id)}


async def _dm_partners(user_id: int) -> list[int]:
    async with SessionLocal() as db:
        mine = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_id)
        from app.core.models import Conversation
        res = await db.execute(select(ConversationMember.user_id).join(
            Conversation, Conversation.id == ConversationMember.conversation_id).where(
            Conversation.kind == "dm", ConversationMember.conversation_id.in_(mine), ConversationMember.user_id != user_id))
        return list(set(res.scalars().all()))



MAX_SESSION = 12 * 3600  # a session whose end was lost (the server restarted) counts at most this


async def _session_started(user_id: int) -> None:
    """The app is open again (the first of the person's connections): the time connected counts from now."""
    async with SessionLocal() as db:
        u = await db.get(User, user_id)
        if u:
            u.session_active, u.session_started_at = True, datetime.utcnow()
            await db.commit()

@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket, ticket: str = ""):
    user_id = await realtime.consume_ticket(ticket)
    if not user_id:
        await ws.close(code=1008)
        return
    async with SessionLocal() as db:
        user = await db.get(User, user_id)
        me = user_summary(user) if user and not user.is_banned else None
    if not me:
        await ws.close(code=1008)
        return

    await ws.accept()
    realtime.gateway.add(user_id, ws)
    came_online = await realtime.presence_connect(user_id)
    if came_online:
        await _session_started(user_id)
        await realtime.publish(await _dm_partners(user_id), {"type": "presence.updated", "user_id": user_id, "online": True})
    await ws.send_text(json.dumps({"type": "hello", "user_id": user_id}))

    async def heartbeat():
        while True:
            await asyncio.sleep(HEARTBEAT)
            await realtime.presence_refresh(user_id)
            await ws.send_text('{"type":"ping"}')

    beat = asyncio.create_task(heartbeat())
    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            if data.get("type") == "typing":
                conv_id = int(data.get("conversation_id") or 0)
                members = await realtime.member_ids(conv_id) if conv_id else []
                if user_id in members and await realtime.typing_allowed(conv_id, user_id):
                    await realtime.publish([m for m in members if m != user_id], {
                        "type": "typing", "conversation_id": conv_id,
                        "thread_root_id": data.get("thread_root_id"), "user": me})
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error for user %s", user_id)
    finally:
        beat.cancel()
        realtime.gateway.remove(user_id, ws)
        try:
            if await realtime.presence_disconnect(user_id):
                # "last seen" is when the last connection closed
                async with SessionLocal() as db:
                    u = await db.get(User, user_id)
                    if u:
                        now = datetime.utcnow()
                        u.last_seen_at = now
                        # time connected: from the first connection to the last one closing (a lost one counts
                        # at most MAX_SESSION)
                        if u.session_started_at:
                            spent = (now - u.session_started_at).total_seconds()
                            u.total_connected_seconds = (u.total_connected_seconds or 0) + int(max(0, min(spent, MAX_SESSION)))
                        u.session_active, u.session_started_at = False, None
                        await db.commit()
                await realtime.publish(await _dm_partners(user_id), {"type": "presence.updated", "user_id": user_id, "online": False})
        except Exception:
            pass
