import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.core.i18n import select_lang, set_lang
from app.mail import notify_email
from app.core.migrate import run_migrations
from app.core.redis_conn import close_redis
from app.admin import routes as admin
from app.auth import routes as auth
from app.billing import routes as billing
from app.board import routes as board
from app.communities import routes as communities
from app.conversations import routes as conversations
from app.push import routes as devices
from app.accounts import avatar, routes as me
from app.messaging import routes as messages
from app.public import routes as public
from app.realtime import routes as realtime
from app.social import routes as social
from app.push.service import ensure_vapid_keys
from app.realtime.service import gateway
from app.core.seed import seed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("meetgo")

app = FastAPI(title="MeetGo API", version="0.2.0")

# Bearer tokens travel in headers, so cookies are never needed cross-origin.
_cors_origins = settings.cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=None if _cors_origins else r"https?://(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def i18n_middleware(request: Request, call_next):
    set_lang(select_lang(request.headers.get("x-lang") or request.headers.get("accept-language") or ""))
    return await call_next(request)


for module in (public, auth, me, avatar, conversations, messages, realtime, devices, social, billing, admin, communities, board):
    app.include_router(module.router)


async def startup():
    settings.validate_for_runtime()
    await run_migrations(engine)
    async with SessionLocal() as db:
        await seed(db)
        await ensure_vapid_keys(db)


@app.on_event("startup")
async def on_startup():
    await startup()
    await gateway.start()
    notify_email.start()


@app.on_event("shutdown")
async def on_shutdown():
    await notify_email.stop()
    await gateway.stop()
    await close_redis()
