from datetime import datetime
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .security import decode_token
from .models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = int(decode_token(token))
    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(401, "User not found")
    if user.is_banned:
        raise HTTPException(403, "User banned")
    if user.banned_until and user.banned_until > datetime.utcnow():
        raise HTTPException(403, "User banned")
    user.last_seen_at = datetime.utcnow()
    db.add(user)
    await db.commit()
    return user
