"""Database migrations (Alembic), run at startup before the app serves requests."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
# Any constant shared by every process: only one of them migrates at a time.
_LOCK_ID = 727_001


def alembic_config(connection=None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def _upgrade(connection, target: str) -> None:
    connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": _LOCK_ID})
    command.upgrade(alembic_config(connection), target)


async def run_migrations(engine: AsyncEngine, target: str = "head") -> None:
    async with engine.begin() as conn:
        await conn.run_sync(_upgrade, target)
