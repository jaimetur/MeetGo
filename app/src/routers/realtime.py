import asyncio
import json
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..db import SessionLocal
from ..deps import get_current_user
from ..models import ConversationMember, User
from ..services import realtime
from ..services.conversations import user_summary

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
        from ..models import Conversation
        res = await db.execute(select(ConversationMember.user_id).join(
            Conversation, Conversation.id == ConversationMember.conversation_id).where(
            Conversation.kind == "dm", ConversationMember.conversation_id.in_(mine), ConversationMember.user_id != user_id))
        return list(set(res.scalars().all()))


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
                await realtime.publish(await _dm_partners(user_id), {"type": "presence.updated", "user_id": user_id, "online": False})
        except Exception:
            pass
