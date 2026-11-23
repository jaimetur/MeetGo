"""Automatic moderation for channels: flood, links, phone numbers, shouting and insults."""

import re
import unicodedata
from dataclasses import dataclass
from datetime import timedelta

import redis.asyncio as redis

from ..config import settings
from ..models import Conversation, ConversationMember, utcnow

URL_RE = re.compile(r"""(?ix)\b(https?://|www\.)\S+""")
# Spanish 9-digit numbers (optionally with a prefix) and any number written with an international
# prefix (+ or 00), allowing spaces, dots or dashes between digits.
PHONE_RE = re.compile(
    r"""(?x)
    (?<![\w+])(?:(?:\+|00)\d{1,3}[\s.\-]?)?[6-9](?:[\s.\-]?\d){8}(?!\w)
    | (?<![\w+])(?:\+|00)\d(?:[\s.\-]?\d){7,13}(?!\w)
    """
)
TOXIC_WORDS = {w.strip().lower() for w in settings.DEFAULT_TOXIC_WORDS.split(",") if w.strip()}

DEFAULT_POLICY = {
    "max_messages_per_minute": settings.DEFAULT_MAX_MSGS_PER_MIN,
    "block_links": settings.DEFAULT_BLOCK_LINKS,
    "block_phone_numbers": settings.DEFAULT_BLOCK_PHONE_NUMBERS,
    "caps_ratio_threshold": settings.DEFAULT_CAPS_RATIO_THRESHOLD,
    "strike_policy": {"warn": 1, "mute": 2, "ban": 4, "decay_days": 30},
    "mute_durations_minutes": [10, 60, 24 * 60],
}


def _fold(s: str) -> str:
    """Lower-case and strip accents so "imbécil" matches "imbecil"."""
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def _toxic_re(words: set[str]) -> re.Pattern[str] | None:
    folded = sorted({_fold(w) for w in words if w})
    if not folded:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in folded) + r")\b")


_TOXIC_RE = _toxic_re(TOXIC_WORDS)


@dataclass
class ModAction:
    delete_message: bool = False
    reason: str | None = None
    add_strike: bool = False
    mute_minutes: int = 0
    ban: bool = False


def _caps_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    if not letters:
        return 0.0
    return sum(1 for c in letters if c.isupper()) / len(letters)


def contains_toxicity(s: str) -> bool:
    """Match whole words only: "reputación" or "disputa" must not count as insults."""
    return bool(_TOXIC_RE and _TOXIC_RE.search(_fold(s)))


def policy_for(conv: Conversation) -> dict:
    policy = dict(DEFAULT_POLICY)
    if isinstance(conv.policy_json, dict):
        policy.update({k: v for k, v in conv.policy_json.items() if v is not None})
    return policy


async def _within_rate(redis_client: redis.Redis, user_id: int, conversation_id: int, max_per_min: int) -> bool:
    key = f"rl:conv:{conversation_id}:user:{user_id}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, 60)
    return count <= max_per_min


async def decide_action(redis_client: redis.Redis, conv: Conversation, user_id: int, text: str) -> ModAction:
    policy = policy_for(conv)
    max_per_min = int(policy.get("max_messages_per_minute") or settings.DEFAULT_MAX_MSGS_PER_MIN)
    if not await _within_rate(redis_client, user_id, conv.id, max_per_min):
        return ModAction(delete_message=True, reason="FLOOD", add_strike=True, mute_minutes=10)
    if policy.get("block_links", True) and URL_RE.search(text):
        return ModAction(delete_message=True, reason="LINKS_NOT_ALLOWED", add_strike=True)
    if policy.get("block_phone_numbers", True) and PHONE_RE.search(text):
        return ModAction(delete_message=True, reason="PHONE_NOT_ALLOWED", add_strike=True, mute_minutes=10)
    caps_thr = float(policy.get("caps_ratio_threshold") or settings.DEFAULT_CAPS_RATIO_THRESHOLD)
    if len(text) >= 12 and _caps_ratio(text) >= caps_thr:
        return ModAction(delete_message=True, reason="CAPS_SPAM", add_strike=True)
    if contains_toxicity(text):
        return ModAction(delete_message=True, reason="TOXICITY", add_strike=True, mute_minutes=60)
    return ModAction()


def apply_strike(conv: Conversation, member: ConversationMember, action: ModAction) -> None:
    """Add a strike and silence or ban the member according to the channel policy."""
    if not action.add_strike:
        return
    policy = policy_for(conv)
    sp = policy.get("strike_policy") or {}
    durations = policy.get("mute_durations_minutes") or [10, 60, 1440]
    now = utcnow()
    decay_days = int(sp.get("decay_days", 30))
    if member.last_strike_at and now - member.last_strike_at > timedelta(days=decay_days):
        member.strikes = 0
    member.strikes = (member.strikes or 0) + 1
    member.last_strike_at = now
    if member.strikes >= int(sp.get("ban", 4)) or action.ban:
        member.banned = True
    elif member.strikes >= int(sp.get("mute", 2)) or action.mute_minutes > 0:
        idx = min(max(member.strikes - int(sp.get("mute", 2)), 0), len(durations) - 1)
        minutes = int(action.mute_minutes) if action.mute_minutes else int(durations[idx])
        member.silenced_until = now + timedelta(minutes=minutes)
