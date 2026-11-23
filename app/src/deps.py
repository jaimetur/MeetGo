from datetime import datetime
from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .security import decode_token
from .i18n import get_lang, t
from .models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session

async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = int(decode_token(token))
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(401, t("err_user_not_found"))
    if user.is_banned:
        raise HTTPException(403, t("err_user_banned"))
    if user.banned_until and user.banned_until > datetime.utcnow():
        raise HTTPException(403, t("err_user_banned"))
    now = datetime.utcnow()
    # Record activity at most once a minute instead of writing on every request; also the language emails use.
    # Only requests from the web app say the language (X-Lang); calls from the Android shell do not.
    lang = get_lang() if request.headers.get("x-lang") else user.lang
    if not user.last_seen_at or (now - user.last_seen_at).total_seconds() > 60 or user.lang != lang:
        user.last_seen_at = now
        user.lang = lang
        db.add(user)
        await db.commit()
    return user


async def require_write_access(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Writing needs an active plan or free access; without one the account is read-only."""
    from .services.billing import has_write_access
    if not await has_write_access(db, user):
        raise HTTPException(402, t("err_subscription_required"))
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, t("err_admin_required"))
    return user
