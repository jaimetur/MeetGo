from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool
from app.core.config import settings

# Tests run each case in its own event loop, so they must not reuse pooled connections.
_engine_kwargs = {"poolclass": NullPool} if settings.DB_NULL_POOL else {"pool_pre_ping": True, "pool_size": 10, "max_overflow": 20}
engine = create_async_engine(settings.DATABASE_URL, **_engine_kwargs)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

class Base(DeclarativeBase):
    pass
