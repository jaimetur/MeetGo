"""Categories of communities: the list for everyone, and in the administration their editing, the proposals people
make and moving many communities into one category at once."""

from __future__ import annotations

import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.categories import service as cats
from app.core.deps import get_db, require_admin
from app.core.i18n import t
from app.core.models import Category, CategoryProposal, Conversation, ConversationMember, Interest, User, utcnow

router = APIRouter(tags=["categories"])


class CategoryIn(BaseModel):
    names: dict[str, str] = Field(default_factory=dict)  # the name in each language; Spanish is required
    icon: str | None = Field(default=None, max_length=32)
    color: str | None = Field(default=None, max_length=16)
    position: int | None = Field(default=None, ge=0, le=1000)


class AssignIn(BaseModel):
    key: str
    community_ids: list[int] = Field(default_factory=list, max_length=2000)
    interest_ids: list[int] = Field(default_factory=list, max_length=2000)


class ApproveIn(BaseModel):
    names: dict[str, str] | None = None  # a new category with these names…
    key: str | None = None  # …or an existing one


def _names(names: dict[str, str]) -> dict[str, str]:
    clean = {lang: n.strip()[:60] for lang, n in (names or {}).items() if isinstance(n, str) and n.strip() and len(lang) <= 8}
    if not clean.get("es"):
        raise HTTPException(400, t("err_category_name"))
    return clean


def _new_key(name: str) -> str:
    base = unicodedata.normalize("NFD", name.lower()).encode("ascii", "ignore").decode()
    return "cat_" + (re.sub(r"[^a-z0-9]+", "_", base).strip("_")[:36] or "new")


# ---------- everyone ----------

@router.get("/categories", response_model=list[dict])
async def categories(db: AsyncSession = Depends(get_db)):
    """The categories, in order, with their name in the reader's language (the X-Lang header)."""
    return [cats.out(c) for c in await cats.all_categories(db)]


# ---------- administration ----------

@router.get("/admin/categories", response_model=dict)
async def admin_categories(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Every category with its names and how many communities it has; the pending proposals; and every community
    (interest ones and people's) with its category, to move them in bulk."""
    custom = (await db.execute(select(Conversation).where(Conversation.kind == "channel", Conversation.interest_id.is_(None),
                                                          Conversation.created_by_id.is_not(None)))).scalars().all()
    members = dict((await db.execute(select(ConversationMember.conversation_id, func.count()).where(
        ConversationMember.conversation_id.in_([c.id for c in custom] or [0])).group_by(ConversationMember.conversation_id))).all())
    interests = (await db.execute(select(Interest).order_by(Interest.name))).scalars().all()
    proposals = (await db.execute(select(CategoryProposal, User, Conversation).outerjoin(User, User.id == CategoryProposal.user_id)
                                  .outerjoin(Conversation, Conversation.id == CategoryProposal.conversation_id)
                                  .where(CategoryProposal.status == "pending").order_by(CategoryProposal.created_at))).all()
    counts: dict[str, int] = {}
    for c in custom:
        counts[c.category_key or cats.OTHER] = counts.get(c.category_key or cats.OTHER, 0) + 1
    for i in interests:
        if i.category:
            counts[i.category] = counts.get(i.category, 0) + 1
    return {
        "categories": [{**cats.out(c, admin=True), "count": counts.get(c.key, 0)} for c in await cats.all_categories(db)],
        "proposals": [{"id": p.id, "name": p.name, "created_at": p.created_at.isoformat(),
                       "user": {"id": u.id, "name": u.shown_name} if u else None,
                       "community": {"id": c.id, "title": c.title} if c else None} for p, u, c in proposals],
        # None: not chosen yet (the app works it out from the name, as it shows it)
        "communities": [{"id": c.id, "title": c.title or "", "kind": "custom", "category": c.category_key,
                         "province": c.scope_label or c.province, "members": int(members.get(c.id, 0)),
                         "created_at": c.created_at.isoformat() if c.created_at else None} for c in custom],
        "interests": [{"id": i.id, "title": i.label(), "kind": "interest", "category": i.category, "slug": i.slug} for i in interests],
    }


@router.get("/admin/categories/pending", response_model=dict)
async def pending(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """What waits for an administrator's review (the app shows a notice while there is something)."""
    return {"categories": await cats.pending_count(db)}


@router.post("/admin/categories/translate", response_model=dict)
async def translate(payload: CategoryIn, admin: User = Depends(require_admin)):
    """The names proposed for the languages still empty (from the Spanish one), to review before saving."""
    return {"names": await cats.complete_names(_names(payload.names))}


@router.post("/admin/categories", response_model=dict)
async def create_category(payload: CategoryIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    names = await cats.complete_names(_names(payload.names))
    key = _new_key(names["es"])
    if await db.get(Category, key):
        raise HTTPException(409, t("err_category_exists"))
    c = Category(key=key, names=names, icon=payload.icon or None, color=payload.color or None,
                 position=payload.position if payload.position is not None else 500, builtin=False, created_at=utcnow())
    db.add(c)
    await db.commit()
    return cats.out(c, admin=True)


@router.patch("/admin/categories/{key}", response_model=dict)
async def update_category(key: str, payload: CategoryIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    c = await db.get(Category, key)
    if not c:
        raise HTTPException(404, t("err_category_invalid"))
    if payload.names:
        c.names = _names(payload.names)
    if payload.icon is not None:
        c.icon = payload.icon or None
    if payload.color is not None:
        c.color = payload.color or None
    if payload.position is not None:
        c.position = payload.position
    await db.commit()
    return cats.out(c, admin=True)


@router.delete("/admin/categories/{key}", response_model=dict)
async def delete_category(key: str, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Its communities go to "Other"; the built-in ones stay (they can be renamed)."""
    c = await db.get(Category, key)
    if not c:
        raise HTTPException(404, t("err_category_invalid"))
    if c.builtin:
        raise HTTPException(400, t("err_category_builtin"))
    await db.execute(update(Conversation).where(Conversation.category_key == key).values(category_key=cats.OTHER))
    await db.execute(update(Interest).where(Interest.category == key).values(category=None))
    await db.delete(c)
    await db.commit()
    return {"ok": True}


@router.post("/admin/categories/assign", response_model=dict)
async def assign(payload: AssignIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Moves many communities (people's) and interests (all their zones) into one category at once."""
    key = await cats.check_key(db, payload.key)
    n = 0
    if payload.community_ids:
        n += (await db.execute(update(Conversation).where(Conversation.id.in_(payload.community_ids), Conversation.kind == "channel",
                                                          Conversation.interest_id.is_(None)).values(category_key=key))).rowcount or 0
    if payload.interest_ids:
        n += (await db.execute(update(Interest).where(Interest.id.in_(payload.interest_ids)).values(category=key))).rowcount or 0
    await db.commit()
    return {"ok": True, "changed": n}


@router.post("/admin/categories/proposals/{proposal_id}/approve", response_model=dict)
async def approve(proposal_id: int, payload: ApproveIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Creates the proposed category (with the names the administrator gives) or uses an existing one, and moves the
    community that asked for it there."""
    p = await db.get(CategoryProposal, proposal_id)
    if not p or p.status != "pending":
        raise HTTPException(404, t("err_category_invalid"))
    if payload.key:
        key = await cats.check_key(db, payload.key)
    else:
        names = _names(payload.names or {"es": p.name})
        key = _new_key(names["es"])
        if not await db.get(Category, key):
            names = await cats.complete_names(names)  # the languages left empty, translated
            db.add(Category(key=key, names=names, position=500, builtin=False, created_at=utcnow()))
    p.status, p.category_key = "approved", key
    if p.conversation_id:
        conv = await db.get(Conversation, p.conversation_id)
        if conv and conv.category_key in (None, cats.OTHER):
            conv.category_key = key
    await db.commit()
    await cats.tell_admins(db)  # reviewed: the notice goes away for the other administrators
    return {"ok": True, "key": key}


@router.post("/admin/categories/proposals/{proposal_id}/reject", response_model=dict)
async def reject(proposal_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    p = await db.get(CategoryProposal, proposal_id)
    if not p or p.status != "pending":
        raise HTTPException(404, t("err_category_invalid"))
    p.status = "rejected"
    await db.commit()
    await cats.tell_admins(db)
    return {"ok": True}
