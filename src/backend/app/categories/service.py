"""Categories of communities: the built-in ones (seeded with their translations), the ones the administration adds,
and the ones people propose when their community fits none ("Other" until the administration decides)."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import _load_lang, supported, t
from app.core.models import Category

OTHER = "ui_cat_other"
# The built-in categories, in the order the lists show them; "Other" always last.
BUILTIN = ("ui_cat_social", "ui_cat_sports", "ui_cat_nature", "ui_cat_culture", "ui_cat_education", "ui_cat_skills",
           "ui_cat_motor", OTHER)


def builtin_names(key: str) -> dict[str, str]:
    """A built-in category's name in every language, from the translations."""
    return {lang: name for lang in sorted(supported()) if (name := _load_lang(lang).get(key))}


async def ensure_categories(db: AsyncSession) -> None:
    """The built-in categories exist (startup); names already edited in the administration are kept."""
    have = set((await db.execute(select(Category.key))).scalars().all())
    for i, key in enumerate(BUILTIN):
        if key not in have:
            db.add(Category(key=key, names=builtin_names(key), position=(999 if key == OTHER else i * 10), builtin=True))
    await db.commit()


async def all_categories(db: AsyncSession) -> list[Category]:
    rows = (await db.execute(select(Category))).scalars().all()
    return sorted(rows, key=lambda c: (c.key == OTHER, c.position, c.label().lower()))


async def check_key(db: AsyncSession, key: str | None) -> str:
    if not key or not await db.get(Category, key):
        raise HTTPException(400, t("err_category_invalid"))
    return key


def out(c: Category, admin: bool = False) -> dict:
    data = {"key": c.key, "name": c.label(), "icon": c.icon, "color": c.color, "builtin": c.builtin}
    if admin:
        data.update({"names": dict(c.names or {}), "position": c.position})
    return data


# ---------- translation of new categories ----------

async def complete_names(names: dict[str, str]) -> dict[str, str]:
    """The category's name in every supported language: the ones given stay, the rest are translated from the Spanish
    one with Claude. Without Claude (no key, an error) the missing ones stay missing (the Spanish one is shown)."""
    import json
    import logging
    from app.core import ai
    from app.core.languages import BUILTIN_NAMES
    missing = sorted(code for code in supported() if not (names.get(code) or "").strip())
    if not missing or not names.get("es"):
        return names
    try:
        await ai.refresh_if_stale()
        if not ai.api_key():
            return names
        schema = {"type": "object", "properties": {c: {"type": "string"} for c in missing}, "required": missing,
                  "additionalProperties": False}
        targets = ", ".join(f"{c} ({BUILTIN_NAMES.get(c, c)})" for c in missing)
        response = await ai.client().messages.create(
            model=ai.model(), max_tokens=1000,
            system="You translate the names of categories of communities in a social app (like «Sports», «Culture»). "
                   "Give a short, natural name as a category label in each language, capitalised as a label is there.",
            output_config={"format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": f"Spanish name: {names['es']}\nTranslate it into: {targets}."}])
        text = next((b.text for b in response.content if b.type == "text"), "")
        done = {c: v.strip()[:60] for c, v in json.loads(text).items() if c in missing and isinstance(v, str) and v.strip()}
        return {**names, **done}
    except Exception:  # the category is made all the same; its names can be completed by hand
        logging.getLogger("meetgo.categories").exception("Translating the category %s failed", names.get("es"))
        return names


# ---------- notices to the administrators ----------

async def pending_count(db: AsyncSession) -> int:
    from sqlalchemy import func
    from app.core.models import CategoryProposal
    return int((await db.execute(select(func.count()).select_from(CategoryProposal).where(CategoryProposal.status == "pending"))).scalar() or 0)


async def tell_admins(db: AsyncSession, proposal_name: str | None = None) -> None:
    """The administrators' apps reload what is waiting for review (a new proposal appears; one reviewed disappears
    for all); a new proposal also reaches their phones. Whoever is not connected sees it the next time they open MeetGo."""
    from app.admin.pending import tell_admins as reload_counts
    from app.core.models import User
    admins = list((await db.execute(select(User).where(User.role == "admin"))).scalars().all())
    await reload_counts(db)
    if proposal_name:
        from app.push.service import push_notice
        push_notice(admins, "admin.category", "email_category_proposal", {"name": proposal_name}, "/app/admin?s=categories")
