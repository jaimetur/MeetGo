import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db
from ..i18n import t
from ..models import User
from ..schemas import AdminLoginIn, ForgotPasswordIn, LoginIn, RegisterIn, ResetPasswordIn, Token, UserOut
from ..security import create_access_token, hash_password, verify_password
from ..services.app_settings import app_base_url
from ..services.billing import billing_config, redeem_code
from ..services.email import send_email_background
from .common import normalize_phone, parse_dob, user_out

router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=UserOut)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not payload.email or not payload.phone:
        raise HTTPException(400, t("err_email_phone_required"))
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(400, t("err_password_too_short"))
    email = payload.email.strip().lower()
    if "@" not in email or len(email) > 255:
        raise HTTPException(400, t("err_invalid_email"))
    ar = parse_dob(payload.dob)
    display_name = (payload.display_name or "").strip()
    if not display_name or len(display_name) > 64:
        raise HTTPException(400, t("err_display_name"))

    if (await db.execute(select(User.id).where(func.lower(User.email) == email))).first():
        raise HTTPException(409, t("err_email_already_used"))
    phone_norm = normalize_phone(payload.phone, payload.country)
    if not phone_norm:
        raise HTTPException(400, t("err_invalid_phone"))
    if (await db.execute(select(User.id).where(User.phone == phone_norm))).first():
        raise HTTPException(409, t("err_phone_already_used"))

    billing = await billing_config(db)
    token = secrets.token_urlsafe(32)
    u = User(
        email=email, phone=phone_norm, password_hash=hash_password(payload.password), display_name=display_name,
        dob=payload.dob, age_range=ar, country=payload.country or "ES", province=payload.province.strip(),
        city=(payload.city.strip() if payload.city else None), accept_dm=bool(payload.accept_dm),
        avatar_url=payload.avatar_url, bio=payload.bio, email_verified=False,
        email_verification_token=token, email_verification_sent_at=datetime.utcnow(),
        access_required=billing["enabled"],
    )
    db.add(u)
    await db.flush()
    if payload.promo_code and payload.promo_code.strip():
        # The code is part of the sign-up: without a free place, no account is created.
        await redeem_code(db, u, payload.promo_code)
    await db.commit()
    await db.refresh(u)
    link = f"{await app_base_url(db)}/app/?verify_token={token}"
    await send_email_background(db, u.email, t("email_verify_subject"), t("email_verify_body", {"link": link}))
    return user_out(u)


@router.post("/auth/login", response_model=Token)
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)):
    if not payload.email:
        raise HTTPException(400, t("err_email_required"))
    res = await db.execute(select(User).where(User.email == payload.email.strip().lower()))
    u = res.scalar_one_or_none()
    if not u or not payload.password or not u.password_hash or not verify_password(payload.password, u.password_hash):
        raise HTTPException(401, t("err_invalid_credentials"))
    if u.is_banned or (u.banned_until and u.banned_until > datetime.utcnow()):
        raise HTTPException(403, t("err_user_banned"))
    if not u.email_verified:
        raise HTTPException(403, t("err_email_not_verified"))
    now = datetime.utcnow()
    u.login_count = (u.login_count or 0) + 1
    u.last_login_at = now
    u.last_seen_at = now
    if not u.session_active:
        u.session_active = True
        u.session_started_at = now
    await db.commit()
    return Token(access_token=create_access_token(str(u.id)), password_temp=bool(u.password_temp))


@router.post("/auth/logout", response_model=dict)
async def logout(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    if user.session_active and user.session_started_at:
        user.total_connected_seconds = (user.total_connected_seconds or 0) + int((now - user.session_started_at).total_seconds())
    user.session_active = False
    user.session_started_at = None
    user.last_seen_at = now
    await db.commit()
    return {"ok": True}


@router.get("/auth/verify-email", response_model=dict)
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email_verification_token == token))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(404, t("err_invalid_token"))
    user.email_verified = True
    user.email_verification_token = None
    await db.commit()
    return {"ok": True}


@router.post("/auth/forgot-password", response_model=dict)
async def forgot_password(payload: ForgotPasswordIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email == payload.email.strip().lower()))
    user = res.scalar_one_or_none()
    if not user:
        return {"ok": True}
    token = secrets.token_urlsafe(32)
    user.reset_token = token
    user.reset_expires_at = datetime.utcnow() + timedelta(hours=2)
    await db.commit()
    link = f"{await app_base_url(db)}/app/?reset_token={token}"
    await send_email_background(db, user.email, t("email_reset_subject"), t("email_reset_body", {"link": link}))
    return {"ok": True}


@router.post("/auth/reset-password", response_model=dict)
async def reset_password(payload: ResetPasswordIn, db: AsyncSession = Depends(get_db)):
    if len(payload.new_password) < 6:
        raise HTTPException(400, t("err_password_too_short"))
    res = await db.execute(select(User).where(User.reset_token == payload.token))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(404, t("err_invalid_token"))
    if user.reset_expires_at and user.reset_expires_at < datetime.utcnow():
        raise HTTPException(410, t("err_token_expired"))
    user.password_hash = hash_password(payload.new_password)
    user.reset_token = None
    user.reset_expires_at = None
    user.password_temp = False
    await db.commit()
    return {"ok": True}


@router.post("/admin/login", response_model=Token)
async def admin_login(payload: AdminLoginIn, db: AsyncSession = Depends(get_db)):
    username = (payload.username or "").strip()
    res = await db.execute(select(User).where(
        User.role == "admin", or_(func.lower(User.email) == username.lower(), User.display_name == username)))
    user = next((u for u in res.scalars().all()
                 if u.password_hash and verify_password(payload.password, u.password_hash)), None)
    if not user:
        raise HTTPException(401, t("err_invalid_credentials"))
    now = datetime.utcnow()
    user.login_count = (user.login_count or 0) + 1
    user.last_login_at = now
    user.last_seen_at = now
    if not user.session_active:
        user.session_active = True
        user.session_started_at = now
    await db.commit()
    return Token(access_token=create_access_token(str(user.id)), password_temp=bool(user.password_temp))
