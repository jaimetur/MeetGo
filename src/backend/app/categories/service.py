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
