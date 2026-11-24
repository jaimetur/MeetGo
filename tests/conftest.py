"""Test setup: a disposable PostgreSQL and Redis (see tests/README.md)."""

import asyncio
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="meetgo-test-data-")
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://postgres:test@127.0.0.1:55432/meetgo_test")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:56379/15")
os.environ["MEETGO_ENV"] = "test"
os.environ["DB_NULL_POOL"] = "1"
os.environ["ADMIN_EMAIL"] = "admin@test.local"
os.environ["ADMIN_PASSWORD"] = "admin-test-password"

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core import redis_conn  # noqa: E402
from app.core.db import SessionLocal, engine  # noqa: E402
from app.main import app, startup  # noqa: E402


@pytest.fixture(autouse=True)
async def fresh_database():
    """Every test starts from an empty schema and the normal startup seeding."""
    redis_conn._client = None
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await redis_conn.get_redis().flushdb()
    await startup()
    yield
    # Background work a test started (push notifications, the moderation bot) finishes before the next test drops
    # the schema; an unfinished query would otherwise keep its lock and block it.
    from app.messaging.service import _tasks
    if _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)
    await redis_conn.close_redis()


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def db_session():
    return SessionLocal
