"""Settings → Age ranges: the administration moves the limits of the three ranges on a bar (app/core/age_bounds.py).

Saving moves whoever changes range: in each interest community of their old range they were in, they join its twin of
the new range (created if missing) and the old one stays as away (kept, with its history), as when someone changes
zone. A range left with 0 years has nobody; its communities sleep until it has years again, and then the people who
come back find them as they were."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import age_bounds
from app.core.app_settings import set_section
from app.core.deps import get_db, require_admin
from app.core.i18n import t
from app.core.models import Conversation, ConversationMember, User
from app.core.utils import age_from_dob

router = APIRouter(prefix="/admin", tags=["admin"])


class BoundsIn(BaseModel):
    young: int
    middle: int


def _key(age: int, b: dict) -> str:
    return "18_30" if age <= b["young"] else "31_60" if age <= b["middle"] else "61_plus"


async def _people(db: AsyncSession) -> list[tuple[User, int]]:
    out = []
    for u in (await db.execute(select(User).where(User.bot_role.is_(None)))).scalars().all():
        try:
            out.append((u, age_from_dob(u.dob)))
        except Exception:
            continue
    return out


def _summary(people: list[tuple[User, int]], old: dict, new: dict) -> dict:
    counts = {k: 0 for k in ("18_30", "31_60", "61_plus")}
    moving = 0
    for _, age in people:
        if age < age_bounds.MIN_AGE:
            continue
        k = _key(age, new)
        counts[k] += 1
        moving += k != _key(age, old)
    return {"ranges": [{**r, "people": counts[r["key"]]} for r in age_bounds.ranges(new)], "moving": moving, **new}


@router.get("/age-ranges", response_model=dict)
async def get_ranges(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    b = age_bounds.bounds()
    return {**_summary(await _people(db), b, b), "min_age": age_bounds.MIN_AGE, "max_age": age_bounds.MAX_AGE}


@router.post("/age-ranges/preview", response_model=dict)
async def preview(payload: BoundsIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """How many people each range would have, and how many would change range."""
    new = age_bounds.clean(payload.young, payload.middle)
    return _summary(await _people(db), age_bounds.bounds(), new)


@router.put("/age-ranges", response_model=dict)
async def save(payload: BoundsIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    from app.communities.service import ensure_interest_channels
    from app.conversations.service import join, move_channels_to_zone
    from app.core.seed import update_age_ranges
    from app.realtime.service import publish
    if payload.young > payload.middle:
        raise HTTPException(400, t("err_age_span"))
    old = age_bounds.bounds()
    new = age_bounds.clean(payload.young, payload.middle)
    people = await _people(db)
    summary = _summary(people, old, new)
    if new == old:
        return summary
    await set_section(db, age_bounds.SECTION, new)
    await db.commit()
    await update_age_ranges(db)  # loads the new limits and rewrites everyone's stored range
    moved = []
    for user, age in people:
        if age < age_bounds.MIN_AGE:
            continue
        before, after = _key(age, old), _key(age, new)
        if before == after:
            continue
        await ensure_interest_channels(db, user)  # the communities of the new range in their zone
        rows = (await db.execute(select(ConversationMember, Conversation).join(
            Conversation, Conversation.id == ConversationMember.conversation_id).where(
            ConversationMember.user_id == user.id, Conversation.kind == "channel", Conversation.interest_id.is_not(None),
            Conversation.age_range == before, Conversation.min_age.is_(None), Conversation.max_age.is_(None),
            ConversationMember.away.is_(False), ConversationMember.banned.is_(False),
            ConversationMember.expelled_message_id.is_(None)))).all()
        for member, conv in rows:
            twin = (await db.execute(select(Conversation).where(
                Conversation.kind == "channel", Conversation.interest_id == conv.interest_id, Conversation.province == conv.province,
                Conversation.age_range == after, Conversation.min_age.is_(None), Conversation.max_age.is_(None)))).scalars().first()
            if twin:
                await join(db, twin, user.id, notify=member.notify)
        await move_channels_to_zone(db, user, user.province, before)  # the old range's communities: away; the new one's: back
        moved.append(user.id)
    await db.commit()
    if moved:
        await publish(moved, {"type": "conversation.changed"})
    return {**summary, "moved": len(moved)}
