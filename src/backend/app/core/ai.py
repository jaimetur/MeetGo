"""Claude for MeetGo (the moderation bot and the translation of new languages).

The API key is pasted in the administration (stored encrypted, like the payment keys) or, failing that, comes from
ANTHROPIC_API_KEY. The key in use is kept in memory and read again from the database every minute, so a key saved in
the administration takes effect without restarting.
"""

import time

import anthropic
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt, encrypt

SECTION = "anthropic"
MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5")

_state = {"key": "", "model": "", "source": "", "read_at": 0.0}
_client: anthropic.AsyncAnthropic | None = None
_client_key = ""


def _apply(section: dict) -> None:
    stored = decrypt(section.get("api_key") or "")
    _state["key"] = stored or settings.ANTHROPIC_API_KEY
    _state["source"] = "panel" if stored else ("env" if settings.ANTHROPIC_API_KEY else "")
    _state["model"] = section.get("model") or settings.MODERATION_MODEL
    _state["read_at"] = time.monotonic()


async def refresh(db: AsyncSession) -> None:
    from app.core.app_settings import get_section
    _apply(await get_section(db, SECTION))


async def refresh_if_stale() -> None:
    if time.monotonic() - _state["read_at"] < 60:
        return
    from app.core.db import SessionLocal
    async with SessionLocal() as db:
        await refresh(db)


def api_key() -> str:
    return _state["key"] if _state["read_at"] else settings.ANTHROPIC_API_KEY


def model() -> str:
    return _state["model"] or settings.MODERATION_MODEL


def source() -> str:
    """"panel" (pasted in the administration), "env" (ANTHROPIC_API_KEY) or "" (none)."""
    if not _state["read_at"]:
        return "env" if settings.ANTHROPIC_API_KEY else ""
    return _state["source"]


def client() -> anthropic.AsyncAnthropic:
    global _client, _client_key
    key = api_key()
    if _client is None or _client_key != key:
        _client, _client_key = anthropic.AsyncAnthropic(api_key=key), key
    return _client


async def save(db: AsyncSession, key: str | None, model_name: str | None, clear: bool = False) -> None:
    """Stores a new key (encrypted) and/or the model; `clear` forgets the stored key (ANTHROPIC_API_KEY applies again)."""
    from app.core.app_settings import get_section, set_section
    section = await get_section(db, SECTION)
    if clear:
        section.pop("api_key", None)
    elif key:
        section["api_key"] = encrypt(key.strip())
    if model_name:
        section["model"] = model_name
    await set_section(db, SECTION, section)
    _apply(section)


def hint() -> str:
    """The end of the key in use (sk-ant-…abcd), never the key itself."""
    key = api_key()
    return f"{key[:7]}…{key[-4:]}" if len(key) > 12 else ""
