import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as redis

from .config import settings
from .models import RoomRule, RoomDiscipline, RoomMessage

URL_RE = re.compile(r"""(?ix)\b(https?://|www\.)\S+""")
PHONE_RE = re.compile(r"""(?x)\b(?:\+?34\s*)?(?:6|7|8|9)\d{2}(?:\s*\d{3}){2}\b""")
TOXIC_WORDS = set([w.strip().lower() for w in settings.DEFAULT_TOXIC_WORDS.split(",") if w.strip()])

@dataclass
class ModAction:
    delete_message: bool = False
    reason: Optional[str] = None
    add_strike: bool = False
    mute_minutes: int = 0
    ban: bool = False

def _caps_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    caps = sum(1 for c in letters if c.isupper())
    return caps / max(1, len(letters))

def _contains_toxicity(s: str) -> bool:
    low = s.lower()
    return any(w in low for w in TOXIC_WORDS)

async def get_room_policy(db: AsyncSession, room_id: int) -> dict:
    res = await db.execute(select(RoomRule).where(RoomRule.room_id == room_id))
    rule = res.scalar_one_or_none()
    if rule and isinstance(rule.policy_json, dict) and rule.policy_json:
        return rule.policy_json
    return {
        "max_messages_per_minute": settings.DEFAULT_MAX_MSGS_PER_MIN,
        "block_links": settings.DEFAULT_BLOCK_LINKS,
        "block_phone_numbers": settings.DEFAULT_BLOCK_PHONE_NUMBERS,
        "caps_ratio_threshold": settings.DEFAULT_CAPS_RATIO_THRESHOLD,
        "strike_policy": {"warn": 1, "mute": 2, "ban": 4, "decay_days": 30},
        "mute_durations_minutes": [10, 60, 24 * 60],
    }

async def can_post(redis_client: redis.Redis, user_id: int, room_id: int, max_per_min: int) -> bool:
    key = f"rl:room:{room_id}:user:{user_id}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, 60)
    return count <= max_per_min

async def decide_action(db: AsyncSession, redis_client: redis.Redis, msg: RoomMessage) -> ModAction:
    policy = await get_room_policy(db, msg.room_id)
    max_per_min = int(policy.get("max_messages_per_minute", settings.DEFAULT_MAX_MSGS_PER_MIN))
    ok = await can_post(redis_client, msg.user_id, msg.room_id, max_per_min)
    if not ok:
        return ModAction(delete_message=True, reason="FLOOD", add_strike=True, mute_minutes=10)

    text = msg.content or ""
    if policy.get("block_links", True) and URL_RE.search(text):
        return ModAction(delete_message=True, reason="LINKS_NOT_ALLOWED", add_strike=True)

    if policy.get("block_phone_numbers", True) and PHONE_RE.search(text):
        return ModAction(delete_message=True, reason="PHONE_NOT_ALLOWED", add_strike=True, mute_minutes=10)

    caps_thr = float(policy.get("caps_ratio_threshold", settings.DEFAULT_CAPS_RATIO_THRESHOLD))
    if _caps_ratio(text) >= caps_thr and len(text) >= 12:
        return ModAction(delete_message=True, reason="CAPS_SPAM", add_strike=True)

    if _contains_toxicity(text):
        return ModAction(delete_message=True, reason="TOXICITY", add_strike=True, mute_minutes=60)

    return ModAction()

async def apply_action(db: AsyncSession, msg: RoomMessage, action: ModAction) -> None:
    if action.delete_message:
        msg.is_deleted = True
        msg.moderation_reason = action.reason or "MODERATED"

    if action.add_strike:
        res = await db.execute(select(RoomDiscipline).where(
            RoomDiscipline.room_id == msg.room_id,
            RoomDiscipline.user_id == msg.user_id,
        ))
        disc = res.scalar_one_or_none()
        if not disc:
            disc = RoomDiscipline(room_id=msg.room_id, user_id=msg.user_id, strikes=0)
            db.add(disc)
            await db.flush()
        disc.strikes = (disc.strikes or 0) + 1
        disc.last_strike_at = datetime.utcnow()
        disc.updated_at = datetime.utcnow()

        policy = await get_room_policy(db, msg.room_id)
        sp = policy.get("strike_policy", {"warn": 1, "mute": 2, "ban": 4})
        mute_durations = policy.get("mute_durations_minutes", [10, 60, 1440])

        if disc.strikes >= int(sp.get("ban", 4)) or action.ban:
            disc.is_banned = True
        elif disc.strikes >= int(sp.get("mute", 2)) or action.mute_minutes > 0:
            idx = min(max(disc.strikes - int(sp.get("mute", 2)), 0), len(mute_durations) - 1)
            mins = int(action.mute_minutes) if action.mute_minutes else int(mute_durations[idx])
            disc.muted_until = datetime.utcnow() + timedelta(minutes=mins)

    await db.flush()
