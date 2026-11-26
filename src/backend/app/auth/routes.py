import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.core.i18n import get_lang, t
from app.core.models import User
from app.core.redis_conn import get_redis
from app.core.schemas import AdminLoginIn, ForgotPasswordIn, LoginIn, RegisterIn, ResetPasswordIn, Token, UserOut
from app.core.security import create_access_token, hash_password, verify_password
from app.billing.service import billing_config, redeem_code
from app.mail.notify_email import account_email
from app.accounts.common import clean_alias, clean_person_name, normalize_phone, parse_dob, user_out, valid_email

router = APIRouter(tags=["auth"])


@router.post("/auth/register", response_model=UserOut)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not payload.email or not payload.phone:
        raise HTTPException(400, t("err_email_phone_required"))
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(400, t("err_password_too_short"))
    email = payload.email.strip().lower()
    if not valid_email(email):
        raise HTTPException(400, t("err_invalid_email"))
    ar = parse_dob(payload.dob)
    first_name = clean_person_name(payload.first_name, 64, "err_first_name")
    last_name = clean_person_name(payload.last_name, 96, "err_last_name")
    display_name = await clean_alias(db, payload.display_name)

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
        first_name=first_name, last_name=last_name,
        dob=payload.dob, age_range=ar, country=payload.country or "ES", province=payload.province.strip(),
        city=(payload.city.strip() if payload.city else None), accept_dm=bool(payload.accept_dm),
        avatar_url=payload.avatar_url, bio=payload.bio, email_verified=False,
        email_verification_token=token, email_verification_sent_at=datetime.utcnow(),
        access_required=billing["enabled"], lang=get_lang(),
    )
    db.add(u)
    await db.flush()
    if payload.promo_code and payload.promo_code.strip():
        # The code is part of the sign-up: without a free place, no account is created.
        await redeem_code(db, u, payload.promo_code)
    await db.commit()
    await db.refresh(u)
    await account_email(db, u, "email_verify", None, f"/app/?verify_token={token}")
    return user_out(u)


@router.post("/auth/resend-verification", response_model=dict)
async def resend_verification(payload: ForgotPasswordIn, db: AsyncSession = Depends(get_db)):
    """A new verification email, at most every 2 minutes per address. The answer never says whether the account exists."""
    email = (payload.email or "").strip().lower()
    if not valid_email(email) or not await get_redis().set(f"mail:verify:{email}", "1", nx=True, ex=120):
        return {"ok": True}
    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    if user and not user.email_verified:
        user.email_verification_token = user.email_verification_token or secrets.token_urlsafe(32)
        user.email_verification_sent_at = datetime.utcnow()
        await db.commit()
        await account_email(db, user, "email_verify", None, f"/app/?verify_token={user.email_verification_token}")
    return {"ok": True}


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
    u.lang = get_lang()
    u.login_count = (u.login_count or 0) + 1
    u.last_login_at = now
    u.last_seen_at = now
    if not u.session_active:
        u.session_active = True
        u.session_started_at = now
    await db.commit()
    return Token(access_token=create_access_token(str(u.id)), password_temp=bool(u.password_temp))


@router.post("/auth/refresh", response_model=Token)
async def refresh(user: User = Depends(get_current_user)):
    """A new token for the one in use: the app asks each time it opens, so a device stays signed in for as long as it
    is used (until signing out on it)."""
    return Token(access_token=create_access_token(str(user.id)), password_temp=bool(user.password_temp))


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
    await account_email(db, user, "email_reset", None, f"/app/?reset_token={token}")
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
    await account_email(db, user, "email_password_changed", None, "/app/")
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
