from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.core.models import Device, User, utcnow
from app.core.schemas import DeviceIn
from app.push.service import public_config

router = APIRouter(tags=["push"])


@router.get("/push/config", response_model=dict)
async def push_config(db: AsyncSession = Depends(get_db)):
    return await public_config(db)


@router.post("/devices", response_model=dict)
async def register_device(payload: DeviceIn, request: Request, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    """Register this browser or phone for notifications; a token moves to whoever signs in last."""
    res = await db.execute(select(Device).where(Device.token == payload.token))
    device = res.scalar_one_or_none()
    if not device:
        device = Device(user_id=user.id, kind=payload.kind, token=payload.token)
        db.add(device)
    device.user_id = user.id
    device.kind = payload.kind
    device.keys = payload.keys or {}
    device.user_agent = (request.headers.get("user-agent") or "")[:255]
    device.last_seen_at = utcnow()
    await db.commit()
    return {"ok": True}


@router.post("/devices/remove", response_model=dict)
async def unregister_device(payload: DeviceIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(Device).where(Device.token == payload.token, Device.user_id == user.id))
    await db.commit()
    return {"ok": True}
