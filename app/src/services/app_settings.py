"""The single app_settings row (administration settings) and its defaults."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AppSetting


async def get_settings_row(db: AsyncSession) -> AppSetting:
    res = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    st = res.scalar_one_or_none()
    if st:
        return st
    st = AppSetting(id=1, data={})
    db.add(st)
    await db.commit()
    await db.refresh(st)
    return st


async def get_section(db: AsyncSession, key: str) -> dict:
    st = await get_settings_row(db)
    value = (st.data or {}).get(key)
    return dict(value) if isinstance(value, dict) else {}


async def set_section(db: AsyncSession, key: str, value: dict) -> None:
    st = await get_settings_row(db)
    data = dict(st.data or {})
    data[key] = value
    st.data = data  # reassign so SQLAlchemy sees the JSON change
    db.add(st)
    await db.commit()


async def app_base_url(db: AsyncSession) -> str:
    st = await get_settings_row(db)
    return ((st.data or {}).get("app_base_url") or "http://localhost:5173").rstrip("/")
