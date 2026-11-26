"""Logs of the calls to the API for the administration (section Logs): who, when, what kind of thing, how it went
and from where. Each request is noted in memory and written in batches every few seconds, so a request never waits
for it; they are kept KEEP_DAYS days."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta

from fastapi import Request
from sqlalchemy import delete, insert

from app.core.models import RequestLog, utcnow

logger = logging.getLogger("meetgo.request_log")
KEEP_DAYS = 30
SKIP = ("/health", "/version", "/favicon", "/admin/logs")  # reading the logs is not logged
# The kind of each call, from the start of its path (first match).
KINDS = (
    ("auth", ("/auth",)),
    ("admin", ("/admin",)),
    ("messages", ("/messages", "/conversations", "/realtime", "/dm")),
    ("communities", ("/communities", "/channels", "/categories", "/community-invites", "/interests")),
    ("board", ("/board", "/posts", "/me/plans")),
    ("billing", ("/billing",)),
    ("social", ("/friends", "/people", "/me/blocks", "/blocks")),
    ("account", ("/me", "/avatar", "/devices", "/settings")),
)
_buffer: list[dict] = []
_task: asyncio.Task | None = None


def kind_of(path: str) -> str:
    for kind, starts in KINDS:
        if any(path == s or path.startswith(s + "/") or path.startswith(s + "?") for s in starts):
            return kind
    return "other"


def _ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()[:64]
    return request.client.host[:64] if request.client else None


async def middleware(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path.startswith(SKIP):
        return await call_next(request)
    start = time.monotonic()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        return response
    finally:
        path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        _buffer.append({
            "at": utcnow(), "user_id": getattr(request.state, "user_id", None), "method": request.method[:8],
            "path": path[:300], "status": status, "ms": int((time.monotonic() - start) * 1000),
            "kind": kind_of(request.url.path), "ip": _ip(request), "agent": (request.headers.get("user-agent") or "")[:300] or None,
        })


async def flush() -> int:
    """Writes what is waiting. Returns how many."""
    from app.core.db import SessionLocal
    if not _buffer:
        return 0
    rows = _buffer[:]
    del _buffer[:len(rows)]
    async with SessionLocal() as db:
        await db.execute(insert(RequestLog), rows)
        await db.commit()
    return len(rows)


async def purge() -> None:
    from app.core.db import SessionLocal
    async with SessionLocal() as db:
        await db.execute(delete(RequestLog).where(RequestLog.at < utcnow() - timedelta(days=KEEP_DAYS)))
        await db.commit()


async def _loop() -> None:
    last_purge = 0.0
    while True:
        await asyncio.sleep(3)
        try:
            await flush()
            if time.monotonic() - last_purge > 3600:
                last_purge = time.monotonic()
                await purge()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Writing the request logs failed")


def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())
