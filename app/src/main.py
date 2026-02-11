from datetime import datetime, date, timedelta
import asyncio
import base64
import json
import os
import secrets
import ssl
import threading
import urllib.parse
import urllib.request
from email.message import EmailMessage
import smtplib
from fastapi import FastAPI, Depends, HTTPException, WebSocket, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, delete, or_, and_, text, update, func
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as redis
try:
    import docker
except Exception:
    docker = None

from .config import settings
from .db import Base, engine, SessionLocal
from .deps import get_db, get_current_user
from .models import (
    User, Interest, UserInterest, Room, RoomRule, RoomMessage, RoomDiscipline, AppSetting,
    DMRequest, DMConversation, DMMessage, DMStatus,
    Follow, FriendRequest, FriendRequestStatus, Friendship, Post
)
from .schemas import (
    RegisterIn, LoginIn, Token, UserOut, MeOut, UserSummary, UpdateProfileIn,
    InterestOut, SetInterestsIn, JoinRoomIn, LeaveRoomIn, RoomOut, RoomRuleOut, RoomRuleUpdateIn, RoomMessageOut,
    DMRequestOut, DMRequestCreateIn, DMRequestResolveIn, DMConversationOut, DMMessageOut,
    FollowOut, FriendRequestOut, FriendRequestCreateIn, FriendRequestResolveIn,
    PostOut, PostCreateIn, ForgotPasswordIn, ResetPasswordIn, AdminLoginIn, AdminUserUpdateIn, AdminUserCreateIn, AdminInterestIn, AdminSmtpTestIn
)
from .security import hash_password, verify_password, create_access_token, decode_token
from .utils import age_range_from_dob, age_from_dob, can_access_age_range, normalize_age_range, age_range_aliases
from .chat import room_ws_loop, hub
from .i18n import t, set_lang, select_lang

app = FastAPI(title="MeetGo Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def i18n_middleware(request: Request, call_next):
    lang_header = request.headers.get("x-lang") or request.headers.get("accept-language") or ""
    set_lang(select_lang(lang_header))
    return await call_next(request)

def _user_out(u: User) -> UserOut:
    try:
        ar = age_range_from_dob(u.dob)
    except Exception:
        ar = u.age_range
    country = u.country or "ES"
    return UserOut(
        id=u.id,
        display_name=u.display_name,
        dob=u.dob,
        age_range=ar,
        country=country,
        province=u.province,
        city=u.city,
        accept_dm=u.accept_dm,
        avatar_url=u.avatar_url,
        bio=u.bio,
    )

def _me_out(u: User) -> MeOut:
    base = _user_out(u)
    return MeOut(
        **base.model_dump(),
        email=u.email,
        dob_change_count=u.dob_change_count or 0,
        email_verified=bool(u.email_verified),
        role=u.role or "user",
        phone=u.phone,
        login_count=u.login_count or 0,
        last_login_at=u.last_login_at,
        last_seen_at=u.last_seen_at,
        total_connected_seconds=u.total_connected_seconds or 0,
        session_active=bool(u.session_active),
        session_started_at=u.session_started_at,
    )

def _user_summary(u: User) -> UserSummary:
    return UserSummary(id=u.id, display_name=u.display_name, avatar_url=u.avatar_url)

def _interest_out(i: Interest) -> InterestOut:
    return InterestOut(id=i.id, slug=i.slug, name=i.name)

def _normalize_phone(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if not digits:
        return ""
    if phone.strip().startswith("+"):
        return f"+{digits}"
    return f"+{digits}"

async def _get_settings(db: AsyncSession) -> AppSetting:
    res = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    st = res.scalar_one_or_none()
    if st:
        return st
    st = AppSetting(id=1, data={})
    db.add(st)
    await db.commit()
    await db.refresh(st)
    return st

async def _send_email(db: AsyncSession, to_email: str, subject: str, body: str):
    st = await _get_settings(db)
    smtp = (st.data or {}).get("smtp") or {}
    mode = smtp.get("mode") or "smtp"
    from_email = smtp.get("from_email") or smtp.get("sender_email") or ""
    if not from_email:
        raise HTTPException(500, t("err_smtp_sender_not_configured"))

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.set_content(body)

    if mode == "gmail_api":
        client_id = smtp.get("gmail_client_id") or ""
        client_secret = smtp.get("gmail_client_secret") or ""
        refresh_token = smtp.get("gmail_refresh_token") or ""
        sender_email = smtp.get("gmail_sender_email") or from_email
        if not (client_id and client_secret and refresh_token and sender_email):
            raise HTTPException(500, t("err_gmail_not_configured"))
        data = urllib.parse.urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode()
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
        with urllib.request.urlopen(req, timeout=10) as resp:
            token_payload = json.loads(resp.read().decode())
        access_token = token_payload.get("access_token")
        if not access_token:
            raise HTTPException(500, t("err_gmail_token_failed"))
        auth_string = f"user={sender_email}\x01auth=Bearer {access_token}\x01\x01"
        b64 = base64.b64encode(auth_string.encode()).decode()
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.docmd("AUTH", "XOAUTH2 " + b64)
            server.send_message(msg)
        return

    host = smtp.get("host") or ""
    port = int(smtp.get("port") or 587)
    username = smtp.get("username") or ""
    password = smtp.get("password") or ""
    encryption = (smtp.get("encryption") or "starttls").lower()
    if not host:
        raise HTTPException(500, t("err_smtp_host_not_configured"))
    if encryption == "ssl":
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=context, timeout=10) as server:
            if username:
                server.login(username, password)
            server.send_message(msg)
        return

    with smtplib.SMTP(host, port, timeout=10) as server:
        server.ehlo()
        if encryption == "starttls":
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if username:
            server.login(username, password)
        server.send_message(msg)

async def _require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, t("err_admin_required"))
    return user

@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Ensure enum has both legacy and new values.
        await conn.execute(text("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agerange') THEN
                CREATE TYPE agerange AS ENUM ('18_30');
            END IF;
        END $$;
        """))
        await conn.execute(text("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agerange') THEN
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS '18_30';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS '31_50';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS '51_plus';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS '31_55';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS '55_plus';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS 'R18_30';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS 'R31_50';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS 'R51_PLUS';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS 'R31_55';
                ALTER TYPE agerange ADD VALUE IF NOT EXISTS 'R55_PLUS';
            END IF;
        END $$;
        """))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(2)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS dob_change_count INTEGER DEFAULT 0"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) DEFAULT 'user'"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(128)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_sent_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(128)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_temp BOOLEAN DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_changed_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_started_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS session_active BOOLEAN DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS total_connected_seconds INTEGER DEFAULT 0"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMP"))

    # Seed interests
    async with SessionLocal() as db:
        # Seed settings
        st = await _get_settings(db)
        if not st.data:
            st.data = {
                "app_base_url": "http://localhost:5173",
                "smtp": {
                    "mode": "smtp",
                    "host": "",
                    "port": 587,
                    "encryption": "starttls",
                    "username": "",
                    "password": "",
                    "from_email": "",
                    "gmail_client_id": "",
                    "gmail_client_secret": "",
                    "gmail_refresh_token": "",
                    "gmail_sender_email": "",
                },
                "languages": [
                    {"code": "es", "name": "Espanol"},
                    {"code": "en", "name": "English"},
                ],
                "age_ranges": [
                    {"key": "18_30", "label": "18-30", "min": 18, "max": 30},
                    {"key": "31_50", "label": "31-50", "min": 31, "max": 50},
                    {"key": "51_plus", "label": "51+", "min": 51, "max": None},
                ],
                "countries": [
                    {"code": "ES", "name": "Espana"},
                    {"code": "PT", "name": "Portugal"},
                    {"code": "FR", "name": "Francia"},
                    {"code": "IT", "name": "Italia"},
                    {"code": "DE", "name": "Alemania"},
                    {"code": "GB", "name": "Reino Unido"},
                    {"code": "US", "name": "Estados Unidos"},
                    {"code": "MX", "name": "Mexico"},
                    {"code": "AR", "name": "Argentina"},
                    {"code": "CO", "name": "Colombia"},
                ],
                "calling_codes": [
                    {"cc": "+34", "name": "Espana"},
                    {"cc": "+351", "name": "Portugal"},
                    {"cc": "+33", "name": "Francia"},
                    {"cc": "+39", "name": "Italia"},
                    {"cc": "+49", "name": "Alemania"},
                    {"cc": "+44", "name": "Reino Unido"},
                    {"cc": "+1", "name": "Estados Unidos"},
                    {"cc": "+52", "name": "Mexico"},
                    {"cc": "+54", "name": "Argentina"},
                    {"cc": "+57", "name": "Colombia"},
                ],
                "provinces_by_country": {
                    "ES": [
                        {"value": "Alava", "name": "Alava"},
                        {"value": "Albacete", "name": "Albacete"},
                        {"value": "Alicante", "name": "Alicante"},
                        {"value": "Almeria", "name": "Almeria"},
                        {"value": "Asturias", "name": "Asturias"},
                        {"value": "Avila", "name": "Avila"},
                        {"value": "Badajoz", "name": "Badajoz"},
                        {"value": "Barcelona", "name": "Barcelona"},
                        {"value": "Burgos", "name": "Burgos"},
                        {"value": "Caceres", "name": "Caceres"},
                        {"value": "Cadiz", "name": "Cadiz"},
                        {"value": "Cantabria", "name": "Cantabria"},
                        {"value": "Castellon", "name": "Castellon"},
                        {"value": "Ciudad Real", "name": "Ciudad Real"},
                        {"value": "Cordoba", "name": "Cordoba"},
                        {"value": "Cuenca", "name": "Cuenca"},
                        {"value": "Girona", "name": "Girona"},
                        {"value": "Granada", "name": "Granada"},
                        {"value": "Guadalajara", "name": "Guadalajara"},
                        {"value": "Gipuzkoa", "name": "Gipuzkoa"},
                        {"value": "Huelva", "name": "Huelva"},
                        {"value": "Huesca", "name": "Huesca"},
                        {"value": "Illes Balears", "name": "Illes Balears"},
                        {"value": "Jaen", "name": "Jaen"},
                        {"value": "A Coruna", "name": "A Coruna"},
                        {"value": "La Rioja", "name": "La Rioja"},
                        {"value": "Las Palmas", "name": "Las Palmas"},
                        {"value": "Leon", "name": "Leon"},
                        {"value": "Lleida", "name": "Lleida"},
                        {"value": "Lugo", "name": "Lugo"},
                        {"value": "Madrid", "name": "Madrid"},
                        {"value": "Malaga", "name": "Malaga"},
                        {"value": "Murcia", "name": "Murcia"},
                        {"value": "Navarra", "name": "Navarra"},
                        {"value": "Ourense", "name": "Ourense"},
                        {"value": "Palencia", "name": "Palencia"},
                        {"value": "Pontevedra", "name": "Pontevedra"},
                        {"value": "Salamanca", "name": "Salamanca"},
                        {"value": "Santa Cruz de Tenerife", "name": "Santa Cruz de Tenerife"},
                        {"value": "Segovia", "name": "Segovia"},
                        {"value": "Sevilla", "name": "Sevilla"},
                        {"value": "Soria", "name": "Soria"},
                        {"value": "Tarragona", "name": "Tarragona"},
                        {"value": "Teruel", "name": "Teruel"},
                        {"value": "Toledo", "name": "Toledo"},
                        {"value": "Valencia", "name": "Valencia"},
                        {"value": "Valladolid", "name": "Valladolid"},
                        {"value": "Bizkaia", "name": "Bizkaia"},
                        {"value": "Zamora", "name": "Zamora"},
                        {"value": "Zaragoza", "name": "Zaragoza"},
                    ],
                    "PT": [
                        {"value": "Lisboa", "name": "Lisboa"},
                        {"value": "Porto", "name": "Porto"},
                        {"value": "Braga", "name": "Braga"},
                        {"value": "Setubal", "name": "Setubal"},
                        {"value": "Aveiro", "name": "Aveiro"},
                    ],
                    "FR": [
                        {"value": "Ile-de-France", "name": "Ile-de-France"},
                        {"value": "Occitanie", "name": "Occitanie"},
                        {"value": "Nouvelle-Aquitaine", "name": "Nouvelle-Aquitaine"},
                        {"value": "Auvergne-Rhone-Alpes", "name": "Auvergne-Rhone-Alpes"},
                    ],
                    "IT": [
                        {"value": "Lazio", "name": "Lazio"},
                        {"value": "Lombardia", "name": "Lombardia"},
                        {"value": "Campania", "name": "Campania"},
                        {"value": "Sicilia", "name": "Sicilia"},
                    ],
                },
                "cities_by_country": {},
            }
            db.add(st)
            await db.commit()

        defaults = [
            ("cafe", "Quedar para un cafe"),
            ("senderismo", "Senderismo"),
            ("cine", "Cine"),
            ("deporte", "Deporte"),
            ("networking", "Networking"),
            ("ciclismo", "Ciclismo"),
            ("mtb", "MTB"),
            ("motos", "Motos"),
            ("coches", "Coches"),
            ("playa", "Playa"),
            ("viajes", "Viajes"),
            ("lectura", "Lectura"),
            ("picnics", "Picnics"),
            ("cerveza", "Quedar para una Cerveza"),
            ("copas", "Quedar para unas Copas"),
            ("deportes", "Deportes (general)"),
            ("deportes_aire_libre", "Deportes al aire libre"),
            ("deportes_acuaticos", "Deportes acuaticos"),
            ("futbol", "Futbol"),
            ("futbol_sala", "Futbol sala"),
            ("tenis", "Tenis"),
            ("padel", "Padel"),
            ("fitness", "Fitness"),
            ("crossfit", "CrossFit"),
        ]
        for slug, name in defaults:
            res = await db.execute(select(Interest).where(Interest.slug == slug))
            if not res.scalar_one_or_none():
                db.add(Interest(slug=slug, name=name))
        await db.commit()

        res = await db.execute(
            select(User).where(or_(User.email == "admin@local", User.phone == "000000000"))
        )
        admin_user = res.scalar_one_or_none()
        if not admin_user:
            admin_user = User(
                email="admin@local",
                phone="000000000",
                password_hash=hash_password("admin"),
                display_name="admin",
                dob="1980-01-01",
                age_range=age_range_from_dob("1980-01-01"),
                country="ES",
                province="Madrid",
                city=None,
                accept_dm=False,
                avatar_url=None,
                bio="",
                role="admin",
                email_verified=True,
            )
            db.add(admin_user)
            await db.commit()
        else:
            changed = False
            if admin_user.role != "admin":
                admin_user.role = "admin"
                changed = True
            if admin_user.phone != "000000000":
                admin_user.phone = "000000000"
                changed = True
            if admin_user.email != "admin@local":
                admin_user.email = "admin@local"
                changed = True
            if not admin_user.email_verified:
                admin_user.email_verified = True
                changed = True
            if changed:
                db.add(admin_user)
                await db.commit()

# ---------------- Auth ----------------
@app.post("/auth/register", response_model=UserOut)
async def register(payload: RegisterIn, db: AsyncSession = Depends(get_db)):
    if not payload.email or not payload.phone:
        raise HTTPException(400, t("err_email_phone_required"))
    if not payload.password or len(payload.password) < 6:
        raise HTTPException(400, t("err_password_too_short"))
    email = payload.email.strip().lower()
    ar = age_range_from_dob(payload.dob)

    res = await db.execute(select(User).where(func.lower(User.email) == email))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_email_already_used"))
    phone_norm = _normalize_phone(payload.phone)
    if not phone_norm:
        raise HTTPException(400, t("err_invalid_phone"))
    res = await db.execute(select(User).where(User.phone == phone_norm))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_phone_already_used"))

    u = User(
        email=email,
        phone=phone_norm,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        dob=payload.dob,
        age_range=ar,
        country=payload.country or "ES",
        province=payload.province.strip(),
        city=(payload.city.strip() if payload.city else None),
        accept_dm=bool(payload.accept_dm),
        avatar_url=payload.avatar_url,
        bio=payload.bio,
        email_verified=False,
    )
    token = secrets.token_urlsafe(32)
    u.email_verification_token = token
    u.email_verification_sent_at = datetime.utcnow()
    db.add(u)
    await db.commit()
    await db.refresh(u)
    try:
        st = await _get_settings(db)
        base = (st.data or {}).get("app_base_url") or "http://localhost:5173"
        link = f"{base}/?verify_token={token}"
        await _send_email(
            db,
            u.email,
            t("email_verify_subject"),
            t("email_verify_body", {"link": link}),
        )
    except Exception:
        # avoid blocking registration on email send errors
        pass
    return _user_out(u)

def _can_access_room(user: User, room: Room) -> bool:
    if room.province != user.province:
        return False
    try:
        user_age = age_from_dob(user.dob)
        user_range = age_range_from_dob(user.dob)
    except Exception:
        return False
    return can_access_age_range(user_age, user_range, room.age_range)

@app.post("/auth/login", response_model=Token)
async def login(payload: LoginIn, db: AsyncSession = Depends(get_db)):
    if not payload.email:
        raise HTTPException(400, t("err_email_required"))
    email = payload.email.strip().lower()
    res = await db.execute(select(User).where(User.email == email))
    u = res.scalar_one_or_none()
    if not u:
        raise HTTPException(401, t("err_invalid_credentials"))
    if u.is_banned:
        raise HTTPException(403, t("err_user_banned"))
    if u.banned_until and u.banned_until > datetime.utcnow():
        raise HTTPException(403, t("err_user_banned"))
    if u.password_hash and payload.password:
        if not verify_password(payload.password, u.password_hash):
            raise HTTPException(401, t("err_invalid_credentials"))
    elif u.password_hash and not payload.password:
        raise HTTPException(401, t("err_password_required"))
    if not u.email_verified:
        raise HTTPException(403, t("err_email_not_verified"))
    u.login_count = (u.login_count or 0) + 1
    u.last_login_at = datetime.utcnow()
    u.last_seen_at = datetime.utcnow()
    if not u.session_active:
        u.session_active = True
        u.session_started_at = datetime.utcnow()
    db.add(u)
    await db.commit()
    return Token(access_token=create_access_token(str(u.id)), password_temp=bool(u.password_temp))

@app.post("/auth/logout", response_model=dict)
async def logout(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    now = datetime.utcnow()
    if user.session_active and user.session_started_at:
        delta = now - user.session_started_at
        user.total_connected_seconds = (user.total_connected_seconds or 0) + int(delta.total_seconds())
    user.session_active = False
    user.session_started_at = None
    user.last_seen_at = now
    db.add(user)
    await db.commit()
    return {"ok": True}

@app.get("/auth/verify-email", response_model=dict)
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email_verification_token == token))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(404, t("err_invalid_token"))
    user.email_verified = True
    user.email_verification_token = None
    db.add(user)
    await db.commit()
    return {"ok": True}

@app.post("/auth/forgot-password", response_model=dict)
async def forgot_password(payload: ForgotPasswordIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.email == payload.email))
    user = res.scalar_one_or_none()
    if not user:
        return {"ok": True}
    token = secrets.token_urlsafe(32)
    user.reset_token = token
    user.reset_expires_at = datetime.utcnow() + timedelta(hours=2)
    db.add(user)
    await db.commit()
    try:
        st = await _get_settings(db)
        base = (st.data or {}).get("app_base_url") or "http://localhost:5173"
        link = f"{base}/?reset_token={token}"
        await _send_email(
            db,
            user.email,
            t("email_reset_subject"),
            t("email_reset_body", {"link": link}),
        )
    except Exception:
        pass
    return {"ok": True}

@app.post("/auth/reset-password", response_model=dict)
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
    db.add(user)
    await db.commit()
    return {"ok": True}

@app.get("/me", response_model=MeOut)
async def me(user: User = Depends(get_current_user)):
    return _me_out(user)

@app.get("/settings/public", response_model=dict)
async def public_settings(db: AsyncSession = Depends(get_db)):
    st = await _get_settings(db)
    data = st.data or {}
    return {
        "languages": data.get("languages") or [],
        "age_ranges": data.get("age_ranges") or [],
        "countries": data.get("countries") or [],
        "calling_codes": data.get("calling_codes") or [],
        "provinces_by_country": data.get("provinces_by_country") or {},
        "cities_by_country": data.get("cities_by_country") or {},
    }

@app.post("/admin/login", response_model=Token)
async def admin_login(payload: AdminLoginIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(or_(User.display_name == payload.username, User.email == payload.username)))
    user = res.scalar_one_or_none()
    if not user and payload.username == "admin" and payload.password == "admin":
        res = await db.execute(
            select(User).where(or_(User.email == "admin@local", User.phone == "000000000"))
        )
        user = res.scalar_one_or_none()
        if not user:
            user = User(
                email="admin@local",
                phone="000000000",
                password_hash=hash_password("admin"),
                display_name="admin",
                dob="1980-01-01",
                age_range=age_range_from_dob("1980-01-01"),
                country="ES",
                province="Madrid",
                city=None,
                accept_dm=False,
                avatar_url=None,
                bio="",
                role="admin",
                email_verified=True,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        else:
            if user.role != "admin":
                user.role = "admin"
            if user.email != "admin@local":
                user.email = "admin@local"
            if user.phone != "000000000":
                user.phone = "000000000"
            if not user.email_verified:
                user.email_verified = True
            db.add(user)
            await db.commit()
    if not user:
        raise HTTPException(401, t("err_invalid_credentials"))
    if user.role != "admin":
        if payload.username == "admin" and payload.password == "admin":
            user.role = "admin"
            user.email_verified = True
            db.add(user)
            await db.commit()
        else:
            raise HTTPException(401, t("err_invalid_credentials"))
    if not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, t("err_invalid_credentials"))
    user.login_count = (user.login_count or 0) + 1
    user.last_login_at = datetime.utcnow()
    user.last_seen_at = datetime.utcnow()
    if not user.session_active:
        user.session_active = True
        user.session_started_at = datetime.utcnow()
    db.add(user)
    await db.commit()
    return Token(access_token=create_access_token(str(user.id)), password_temp=bool(user.password_temp))

@app.get("/admin/settings", response_model=dict)
async def admin_get_settings(db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    st = await _get_settings(db)
    return st.data or {}

@app.put("/admin/settings", response_model=dict)
async def admin_put_settings(payload: dict, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    st = await _get_settings(db)
    st.data = payload or {}
    db.add(st)
    await db.commit()
    return st.data

@app.post("/admin/smtp/test", response_model=dict)
async def admin_smtp_test(payload: AdminSmtpTestIn, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    to_email = (payload.to_email or "").strip()
    if not to_email:
        raise HTTPException(400, t("err_missing_to_email"))
    await _send_email(
        db,
        to_email,
        t("email_smtp_test_subject"),
        t("email_smtp_test_body"),
    )
    return {"ok": True}

@app.get("/admin/users", response_model=list[MeOut])
async def admin_list_users(q: str | None = None, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    query = select(User)
    if q:
        like = f"%{q}%"
        query = query.where(or_(User.display_name.ilike(like), User.email.ilike(like), User.phone.ilike(like)))
    res = await db.execute(query.order_by(User.id.desc()).limit(200))
    return [_me_out(u) for u in res.scalars().all()]

@app.post("/admin/users", response_model=MeOut)
async def admin_create_user(payload: AdminUserCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    email = payload.email.strip().lower()
    res = await db.execute(select(User).where(User.email == email))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_email_already_used"))
    phone_norm = _normalize_phone(payload.phone)
    if not phone_norm:
        raise HTTPException(400, t("err_invalid_phone"))
    res = await db.execute(select(User).where(User.phone == phone_norm))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_phone_already_used"))
    ar = age_range_from_dob(payload.dob)
    new_user = User(
        email=email,
        phone=phone_norm,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
        dob=payload.dob,
        age_range=ar,
        country=payload.country or "ES",
        province=payload.province.strip(),
        city=(payload.city.strip() if payload.city else None),
        accept_dm=False,
        avatar_url=None,
        bio="",
        role=payload.role or "user",
        email_verified=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return _me_out(new_user)

@app.patch("/admin/users/{user_id}", response_model=MeOut)
async def admin_update_user(user_id: int, payload: AdminUserUpdateIn, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    res = await db.execute(select(User).where(User.id == user_id))
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    if payload.display_name is not None:
        target.display_name = payload.display_name.strip()
    if payload.email is not None:
        email = payload.email.strip().lower() or None
        if email != target.email:
            if email:
                res = await db.execute(select(User).where(User.email == email))
                if res.scalar_one_or_none():
                    raise HTTPException(409, t("err_email_already_used"))
            target.email = email
    if payload.phone is not None:
        phone_norm = _normalize_phone(payload.phone)
        if not phone_norm:
            raise HTTPException(400, t("err_invalid_phone"))
        if phone_norm != target.phone:
            res = await db.execute(select(User).where(User.phone == phone_norm))
            if res.scalar_one_or_none():
                raise HTTPException(409, t("err_phone_already_used"))
            target.phone = phone_norm
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(400, t("err_password_too_short"))
        target.password_hash = hash_password(payload.password)
    if payload.dob is not None:
        target.dob = payload.dob
        target.age_range = age_range_from_dob(payload.dob)
    if payload.country is not None:
        target.country = payload.country
    if payload.province is not None:
        target.province = payload.province
    if payload.city is not None:
        target.city = payload.city
    if payload.role is not None:
        target.role = payload.role
    if payload.email_verified is not None:
        target.email_verified = payload.email_verified
    if payload.is_banned is not None:
        target.is_banned = payload.is_banned
    if payload.banned_until is not None:
        target.banned_until = payload.banned_until
    db.add(target)
    await db.commit()
    await db.refresh(target)
    return _me_out(target)

@app.post("/admin/users/{user_id}/resend-verification", response_model=dict)
async def admin_resend_verification(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    res = await db.execute(select(User).where(User.id == user_id))
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    if not target.email:
        raise HTTPException(400, t("err_user_no_email"))
    token = secrets.token_urlsafe(32)
    target.email_verification_token = token
    target.email_verification_sent_at = datetime.utcnow()
    db.add(target)
    await db.commit()
    st = await _get_settings(db)
    base = (st.data or {}).get("app_base_url") or "http://localhost:5173"
    link = f"{base}/?verify_token={token}"
    await _send_email(
        db,
        target.email,
        t("email_verify_subject"),
        t("email_verify_body", {"link": link}),
    )
    return {"ok": True}

@app.delete("/admin/users/{user_id}", response_model=dict)
async def admin_delete_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    if user.id == user_id:
        raise HTTPException(400, t("err_cannot_delete_self"))
    conv_ids = select(DMConversation.id).where(or_(DMConversation.user1_id == user_id, DMConversation.user2_id == user_id))
    await db.execute(delete(DMMessage).where(or_(DMMessage.user_id == user_id, DMMessage.conversation_id.in_(conv_ids))))
    await db.execute(delete(DMConversation).where(or_(DMConversation.user1_id == user_id, DMConversation.user2_id == user_id)))
    await db.execute(delete(DMRequest).where(or_(DMRequest.from_user_id == user_id, DMRequest.to_user_id == user_id)))
    await db.execute(delete(FriendRequest).where(or_(FriendRequest.from_user_id == user_id, FriendRequest.to_user_id == user_id)))
    await db.execute(delete(Friendship).where(or_(Friendship.user_id == user_id, Friendship.friend_id == user_id)))
    await db.execute(delete(Follow).where(or_(Follow.follower_id == user_id, Follow.following_id == user_id)))
    await db.execute(delete(Post).where(Post.user_id == user_id))
    await db.execute(delete(RoomMessage).where(RoomMessage.user_id == user_id))
    await db.execute(delete(RoomDiscipline).where(RoomDiscipline.user_id == user_id))
    await db.execute(delete(UserInterest).where(UserInterest.user_id == user_id))
    await db.execute(update(RoomRule).where(RoomRule.updated_by_user_id == user_id).values(updated_by_user_id=None))
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
    return {"ok": True}

@app.post("/admin/interests", response_model=InterestOut)
async def admin_create_interest(payload: AdminInterestIn, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    res = await db.execute(select(Interest).where(Interest.slug == payload.slug))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_interest_exists"))
    it = Interest(slug=payload.slug, name=payload.name)
    db.add(it)
    await db.commit()
    await db.refresh(it)
    return _interest_out(it)

@app.patch("/admin/interests/{interest_id}", response_model=InterestOut)
async def admin_update_interest(interest_id: int, payload: AdminInterestIn, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    res = await db.execute(select(Interest).where(Interest.id == interest_id))
    it = res.scalar_one_or_none()
    if not it:
        raise HTTPException(404, t("err_interest_not_found"))
    it.slug = payload.slug
    it.name = payload.name
    db.add(it)
    await db.commit()
    await db.refresh(it)
    return _interest_out(it)

@app.delete("/admin/interests/{interest_id}", response_model=dict)
async def admin_delete_interest(interest_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(_require_admin)):
    await db.execute(delete(Interest).where(Interest.id == interest_id))
    await db.commit()
    return {"ok": True}
@app.patch("/me/profile", response_model=MeOut)
async def update_profile(payload: UpdateProfileIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    left_rooms = False
    old_age_range = age_range_from_dob(user.dob)
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.email is not None:
        email = payload.email.strip().lower() or None
        if not email:
            raise HTTPException(400, t("err_email_required"))
        if email != user.email:
            if email:
                res = await db.execute(select(User).where(User.email == email))
                if res.scalar_one_or_none():
                    raise HTTPException(409, t("err_email_already_used"))
            user.email = email
            user.email_verified = False
            token = secrets.token_urlsafe(32)
            user.email_verification_token = token
            user.email_verification_sent_at = datetime.utcnow()
            try:
                st = await _get_settings(db)
                base = (st.data or {}).get("app_base_url") or "http://localhost:5173"
                link = f"{base}/?verify_token={token}"
                await _send_email(
                    db,
                    user.email,
                    t("email_verify_subject"),
                    t("email_verify_body", {"link": link}),
                )
            except Exception:
                pass
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(400, t("err_password_too_short"))
        user.password_hash = hash_password(payload.password)
        user.password_temp = False
    if payload.dob is not None and payload.dob != user.dob:
        if (user.dob_change_count or 0) >= 1:
            raise HTTPException(409, t("err_dob_change_used"))
        try:
            new_age_range = age_range_from_dob(payload.dob)
        except Exception:
            raise HTTPException(400, t("err_invalid_dob"))
        if new_age_range != old_age_range:
            left_rooms = True
        user.dob = payload.dob
        user.age_range = new_age_range
        user.dob_change_count = (user.dob_change_count or 0) + 1
    if payload.country is not None:
        user.country = payload.country or None
    if payload.province is not None:
        province = payload.province.strip()
        if province and province != user.province:
            left_rooms = True
            user.province = province
        elif not province:
            raise HTTPException(400, t("err_province_required"))
    if payload.phone is not None:
        phone_norm = _normalize_phone(payload.phone)
        if not phone_norm:
            raise HTTPException(400, t("err_invalid_phone"))
        if phone_norm != user.phone:
            if user.phone_changed_at and (datetime.utcnow() - user.phone_changed_at) < timedelta(days=30):
                raise HTTPException(409, t("err_phone_change_limited"))
            res = await db.execute(select(User).where(User.phone == phone_norm))
            if res.scalar_one_or_none():
                raise HTTPException(409, t("err_phone_already_used"))
            user.phone = phone_norm
            user.phone_changed_at = datetime.utcnow()
    if payload.city is not None:
        user.city = payload.city.strip() if payload.city else None
    if payload.accept_dm is not None:
        user.accept_dm = bool(payload.accept_dm)
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url
    if payload.bio is not None:
        user.bio = payload.bio
    if left_rooms:
        await db.execute(delete(UserInterest).where(UserInterest.user_id == user.id))
    user.last_active_at = datetime.utcnow()
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _me_out(user)

# Public profile
@app.get("/users/{user_id}", response_model=UserOut)
async def get_user(user_id: int, db: AsyncSession = Depends(get_db), me_user: User = Depends(get_current_user)):
    res = await db.execute(select(User).where(User.id == user_id))
    u = res.scalar_one_or_none()
    if not u:
        raise HTTPException(404, t("err_user_not_found"))
    # Optional privacy: restrict to same province
    if u.province != me_user.province:
        raise HTTPException(403, t("err_forbidden_diff_province"))
    return _user_out(u)

# ---------------- Interests ----------------
@app.get("/interests", response_model=list[InterestOut])
async def list_interests(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(Interest).order_by(Interest.name))
    return [_interest_out(i) for i in res.scalars().all()]

@app.post("/me/interests", response_model=dict)
async def set_my_interests(payload: SetInterestsIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(UserInterest).where(UserInterest.user_id == user.id))
    if payload.interest_slugs:
        res = await db.execute(select(Interest).where(Interest.slug.in_(payload.interest_slugs)))
        interests = res.scalars().all()
        for it in interests:
            db.add(UserInterest(user_id=user.id, interest_id=it.id))
    await db.commit()
    return {"ok": True}

# ---------------- Rooms ----------------
async def _get_or_create_room(db: AsyncSession, province: str, age_range, interest_id: int) -> Room:
    aliases = age_range_aliases(age_range)
    res = await db.execute(select(Room).where(Room.province == province, Room.age_range.in_(aliases), Room.interest_id == interest_id))
    room = res.scalar_one_or_none()
    if room:
        return room
    room = Room(province=province, age_range=age_range, interest_id=interest_id)
    db.add(room)
    await db.flush()

    default_rules = (
        "- Respeto. Cero acoso.\n"
        "- No spam ni autopromo.\n"
        "- No compartas teléfono en la sala; usa privado si procede.\n"
        "- Si incumples, el bot puede borrar, silenciar o banear.\n"
    )
    default_policy = {
        "max_messages_per_minute": settings.DEFAULT_MAX_MSGS_PER_MIN,
        "block_links": True,
        "block_phone_numbers": True,
        "caps_ratio_threshold": settings.DEFAULT_CAPS_RATIO_THRESHOLD,
        "strike_policy": {"warn": 1, "mute": 2, "ban": 4, "decay_days": 30},
        "mute_durations_minutes": [10, 60, 1440],
    }
    db.add(RoomRule(room_id=room.id, rules_markdown=default_rules, policy_json=default_policy))
    await db.commit()
    await db.refresh(room)
    return room

@app.get("/rooms/my", response_model=list[RoomOut])
async def my_rooms(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ar = age_range_from_dob(user.dob)
    res = await db.execute(select(UserInterest.interest_id).where(UserInterest.user_id == user.id))
    interest_ids = list(res.scalars().all())
    if not interest_ids:
        return []
    res = await db.execute(select(Interest).where(Interest.id.in_(interest_ids)))
    interests = res.scalars().all()

    rooms = []
    for it in interests:
        room = await _get_or_create_room(db, user.province, ar, it.id)
        rooms.append(RoomOut(id=room.id, province=room.province, age_range=normalize_age_range(room.age_range), interest=_interest_out(it)))
    return rooms

@app.post("/rooms/join", response_model=RoomOut)
async def join_room(payload: JoinRoomIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    ar = age_range_from_dob(user.dob)
    res = await db.execute(select(Interest).where(Interest.slug == payload.interest_slug))
    interest = res.scalar_one_or_none()
    if not interest:
        raise HTTPException(404, t("err_interest_not_found"))

    res = await db.execute(select(UserInterest).where(UserInterest.user_id == user.id, UserInterest.interest_id == interest.id))
    if not res.scalar_one_or_none():
        db.add(UserInterest(user_id=user.id, interest_id=interest.id))
        await db.commit()

    room = await _get_or_create_room(db, user.province, ar, interest.id)
    return RoomOut(id=room.id, province=room.province, age_range=normalize_age_range(room.age_range), interest=_interest_out(interest))

@app.post("/rooms/leave", response_model=dict)
async def leave_room(payload: LeaveRoomIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Room).where(Room.id == payload.room_id))
    room = res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, t("err_room_not_found"))
    if not _can_access_room(user, room):
        raise HTTPException(403, t("err_forbidden"))

    await db.execute(delete(UserInterest).where(UserInterest.user_id == user.id, UserInterest.interest_id == room.interest_id))
    await db.commit()
    return {"ok": True}

@app.get("/rooms/{room_id}/rules", response_model=RoomRuleOut)
async def get_room_rules(room_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Room).where(Room.id == room_id))
    room = res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, t("err_room_not_found"))
    if not _can_access_room(user, room):
        raise HTTPException(403, t("err_forbidden"))
    res = await db.execute(select(RoomRule).where(RoomRule.room_id == room_id))
    rule = res.scalar_one_or_none()
    if not rule:
        raise HTTPException(404, t("err_rules_not_found"))
    return RoomRuleOut(room_id=rule.room_id, rules_markdown=rule.rules_markdown, policy_json=rule.policy_json or {})

@app.get("/rooms/{room_id}/messages", response_model=list[RoomMessageOut])
async def list_room_messages(room_id: int, limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Room).where(Room.id == room_id))
    room = res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, t("err_room_not_found"))
    if not _can_access_room(user, room):
        raise HTTPException(403, t("err_forbidden"))

    res = await db.execute(select(RoomMessage).where(RoomMessage.room_id == room_id).order_by(RoomMessage.id.desc()).limit(limit))
    msgs = list(reversed(res.scalars().all()))

    # Fetch user summaries in one shot
    user_ids = sorted({m.user_id for m in msgs})
    users_map = {}
    if user_ids:
        resu = await db.execute(select(User).where(User.id.in_(user_ids)))
        for u in resu.scalars().all():
            users_map[u.id] = _user_summary(u)

    out = []
    for m in msgs:
        out.append(RoomMessageOut(
            id=m.id,
            room_id=m.room_id,
            user_id=m.user_id,
            user=users_map.get(m.user_id) or UserSummary(id=m.user_id, display_name=t("unknown_user"), avatar_url=None),
            content="" if m.is_deleted else m.content,
            created_at=m.created_at,
            is_deleted=m.is_deleted,
            moderation_reason=m.moderation_reason,
        ))
    return out

@app.get("/rooms/online")
async def rooms_online(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    snapshots = hub.all_snapshots()
    room_ids = [s["room_id"] for s in snapshots]
    if not room_ids:
        return []
    res = await db.execute(select(Room).where(Room.id.in_(room_ids)))
    rooms = res.scalars().all()
    allowed = {r.id for r in rooms if _can_access_room(user, r)}
    return [s for s in snapshots if s["room_id"] in allowed]

@app.get("/rooms/{room_id}/online")
async def room_online(room_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Room).where(Room.id == room_id))
    room = res.scalar_one_or_none()
    if not room:
        raise HTTPException(404, t("err_room_not_found"))
    if not _can_access_room(user, room):
        raise HTTPException(403, t("err_forbidden"))
    return hub.room_snapshot(room_id)

@app.websocket("/ws/rooms/{room_id}")
async def room_ws(room_id: int, websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008); return

    redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    async with AsyncSession(engine) as db:
        try:
            user_id = int(decode_token(token))
        except Exception:
            await websocket.close(code=1008); return

        # access control
        res = await db.execute(select(Room).where(Room.id == room_id))
        room = res.scalar_one_or_none()
        if not room:
            await websocket.close(code=1008); return
        res = await db.execute(select(User).where(User.id == user_id))
        u = res.scalar_one_or_none()
        if not u or not _can_access_room(u, room):
            await websocket.close(code=1008); return

        await room_ws_loop(websocket, room_id, user_id, db, redis_client)

# ---------------- DMs (requests + messages) ----------------
async def _dm_daily_key(user_id: int) -> str:
    today = date.today().isoformat()
    return f"dm_opened:{user_id}:{today}"

@app.post("/dm/requests", response_model=DMRequestOut)
async def create_dm_request(payload: DMRequestCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.to_user_id == user.id:
        raise HTTPException(400, t("err_cannot_dm_self"))

    res = await db.execute(select(User).where(User.id == payload.to_user_id))
    other = res.scalar_one_or_none()
    if not other:
        raise HTTPException(404, t("err_user_not_found"))
    if not other.accept_dm:
        raise HTTPException(403, t("err_user_no_dm"))

    redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    key = await _dm_daily_key(user.id)
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, 60 * 60 * 26)
    if count > 10:
        raise HTTPException(429, t("err_dm_daily_limit"))

    res = await db.execute(select(DMRequest).where(DMRequest.from_user_id == user.id, DMRequest.to_user_id == other.id, DMRequest.status == DMStatus.PENDING))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_dm_request_pending"))

    req = DMRequest(from_user_id=user.id, to_user_id=other.id, status=DMStatus.PENDING)
    db.add(req)
    await db.commit()
    await db.refresh(req)
    return DMRequestOut(id=req.id, from_user_id=req.from_user_id, to_user_id=req.to_user_id, status=req.status, created_at=req.created_at)

@app.get("/dm/requests/incoming", response_model=list[DMRequestOut])
async def list_incoming(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMRequest).where(DMRequest.to_user_id == user.id, DMRequest.status == DMStatus.PENDING).order_by(DMRequest.id.desc()))
    return [DMRequestOut(id=r.id, from_user_id=r.from_user_id, to_user_id=r.to_user_id, status=r.status, created_at=r.created_at) for r in res.scalars().all()]

@app.post("/dm/requests/{request_id}/resolve", response_model=dict)
async def resolve_request(request_id: int, payload: DMRequestResolveIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMRequest).where(DMRequest.id == request_id))
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(404, t("err_request_not_found"))
    if req.to_user_id != user.id:
        raise HTTPException(403, t("err_forbidden"))
    if req.status != DMStatus.PENDING:
        raise HTTPException(409, t("err_already_resolved"))

    req.status = DMStatus.ACCEPTED if payload.accept else DMStatus.REJECTED
    req.resolved_at = datetime.utcnow()

    conv_id = None
    if req.status == DMStatus.ACCEPTED:
        u1, u2 = sorted([req.from_user_id, req.to_user_id])
        res = await db.execute(select(DMConversation).where(DMConversation.user1_id == u1, DMConversation.user2_id == u2))
        conv = res.scalar_one_or_none()
        if not conv:
            conv = DMConversation(user1_id=u1, user2_id=u2)
            db.add(conv); await db.flush()
        conv_id = conv.id

    await db.commit()
    return {"ok": True, "conversation_id": conv_id}

@app.get("/dm/conversations", response_model=list[DMConversationOut])
async def list_conversations(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMConversation).where(or_(DMConversation.user1_id == user.id, DMConversation.user2_id == user.id)).order_by(DMConversation.id.desc()))
    return [DMConversationOut(id=c.id, user1_id=c.user1_id, user2_id=c.user2_id) for c in res.scalars().all()]

@app.get("/dm/conversations/{conv_id}/messages", response_model=list[DMMessageOut])
async def list_dm_messages(conv_id: int, limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMConversation).where(DMConversation.id == conv_id))
    conv = res.scalar_one_or_none()
    if not conv or (conv.user1_id != user.id and conv.user2_id != user.id):
        raise HTTPException(404, t("err_conversation_not_found"))
    res = await db.execute(select(DMMessage).where(DMMessage.conversation_id == conv_id).order_by(DMMessage.id.desc()).limit(limit))
    msgs = list(reversed(res.scalars().all()))
    return [DMMessageOut(id=m.id, conversation_id=m.conversation_id, user_id=m.user_id, content=m.content, created_at=m.created_at) for m in msgs]

@app.post("/dm/conversations/{conv_id}/messages", response_model=DMMessageOut)
async def send_dm_message(conv_id: int, content: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DMConversation).where(DMConversation.id == conv_id))
    conv = res.scalar_one_or_none()
    if not conv or (conv.user1_id != user.id and conv.user2_id != user.id):
        raise HTTPException(404, t("err_conversation_not_found"))
    msg = DMMessage(conversation_id=conv_id, user_id=user.id, content=content.strip())
    db.add(msg); await db.commit(); await db.refresh(msg)
    return DMMessageOut(id=msg.id, conversation_id=msg.conversation_id, user_id=msg.user_id, content=msg.content, created_at=msg.created_at)

# ---------------- Social: follow ----------------
@app.post("/follow/{user_id}", response_model=FollowOut)
async def follow_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if user_id == user.id:
        raise HTTPException(400, t("err_cannot_follow_self"))
    res = await db.execute(select(User).where(User.id == user_id))
    other = res.scalar_one_or_none()
    if not other or other.province != user.province:
        raise HTTPException(404, t("err_user_not_found"))
    res = await db.execute(select(Follow).where(Follow.follower_id == user.id, Follow.following_id == user_id))
    if res.scalar_one_or_none():
        return FollowOut(follower_id=user.id, following_id=user_id)
    db.add(Follow(follower_id=user.id, following_id=user_id))
    await db.commit()
    return FollowOut(follower_id=user.id, following_id=user_id)

@app.delete("/follow/{user_id}", response_model=dict)
async def unfollow_user(user_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await db.execute(delete(Follow).where(Follow.follower_id == user.id, Follow.following_id == user_id))
    await db.commit()
    return {"ok": True}

# ---------------- Social: friend requests ----------------
@app.post("/friends/requests", response_model=FriendRequestOut)
async def create_friend_request(payload: FriendRequestCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    if payload.to_user_id == user.id:
        raise HTTPException(400, t("err_cannot_friend_self"))
    res = await db.execute(select(User).where(User.id == payload.to_user_id))
    other = res.scalar_one_or_none()
    if not other or other.province != user.province:
        raise HTTPException(404, t("err_user_not_found"))

    # Already friends?
    res = await db.execute(select(Friendship).where(Friendship.user_id == user.id, Friendship.friend_id == other.id))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_already_friends"))

    res = await db.execute(select(FriendRequest).where(FriendRequest.from_user_id == user.id, FriendRequest.to_user_id == other.id, FriendRequest.status == FriendRequestStatus.PENDING))
    if res.scalar_one_or_none():
        raise HTTPException(409, t("err_request_pending"))

    fr = FriendRequest(from_user_id=user.id, to_user_id=other.id, status=FriendRequestStatus.PENDING)
    db.add(fr); await db.commit(); await db.refresh(fr)
    return FriendRequestOut(id=fr.id, from_user_id=fr.from_user_id, to_user_id=fr.to_user_id, status=fr.status, created_at=fr.created_at)

@app.get("/friends/requests/incoming", response_model=list[FriendRequestOut])
async def incoming_friend_requests(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(FriendRequest).where(FriendRequest.to_user_id == user.id, FriendRequest.status == FriendRequestStatus.PENDING).order_by(FriendRequest.id.desc()))
    return [FriendRequestOut(id=r.id, from_user_id=r.from_user_id, to_user_id=r.to_user_id, status=r.status, created_at=r.created_at) for r in res.scalars().all()]

@app.post("/friends/requests/{request_id}/resolve", response_model=dict)
async def resolve_friend_request(request_id: int, payload: FriendRequestResolveIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(FriendRequest).where(FriendRequest.id == request_id))
    req = res.scalar_one_or_none()
    if not req:
        raise HTTPException(404, t("err_request_not_found"))
    if req.to_user_id != user.id:
        raise HTTPException(403, t("err_forbidden"))
    if req.status != FriendRequestStatus.PENDING:
        raise HTTPException(409, t("err_already_resolved"))

    req.status = FriendRequestStatus.ACCEPTED if payload.accept else FriendRequestStatus.REJECTED
    req.resolved_at = datetime.utcnow()
    if req.status == FriendRequestStatus.ACCEPTED:
        a, b = req.from_user_id, req.to_user_id
        # store both directions
        db.add(Friendship(user_id=a, friend_id=b))
        db.add(Friendship(user_id=b, friend_id=a))
    await db.commit()
    return {"ok": True}

@app.get("/friends", response_model=list[UserSummary])
async def list_friends(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(Friendship.friend_id).where(Friendship.user_id == user.id))
    ids = list(res.scalars().all())
    if not ids:
        return []
    res = await db.execute(select(User).where(User.id.in_(ids)))
    return [_user_summary(u) for u in res.scalars().all()]

# ---------------- Feed posts ----------------
@app.post("/posts", response_model=PostOut)
async def create_post(payload: PostCreateIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    p = Post(user_id=user.id, content=payload.content.strip())
    db.add(p); await db.commit(); await db.refresh(p)
    return PostOut(id=p.id, user_id=p.user_id, user=_user_summary(user), content=p.content, created_at=p.created_at)

@app.get("/feed", response_model=list[PostOut])
async def get_feed(limit: int = 50, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    # feed = your posts + posts from people you follow (same province enforced by follow)
    res = await db.execute(select(Follow.following_id).where(Follow.follower_id == user.id))
    following_ids = list(res.scalars().all())
    ids = set(following_ids + [user.id])
    res = await db.execute(select(Post).where(Post.user_id.in_(ids)).order_by(Post.id.desc()).limit(limit))
    posts = list(reversed(res.scalars().all()))
    # user summaries
    uids = sorted({p.user_id for p in posts})
    umap = {}
    if uids:
        resu = await db.execute(select(User).where(User.id.in_(uids)))
        for u in resu.scalars().all():
            umap[u.id] = _user_summary(u)
    return [PostOut(id=p.id, user_id=p.user_id, user=umap.get(p.user_id) or UserSummary(id=p.user_id, display_name=t("unknown_user"), avatar_url=None), content=p.content, created_at=p.created_at) for p in posts]

# ---------------- Debug: docker compose logs ----------------
def _compose_containers(client):
    project = os.getenv("COMPOSE_PROJECT_NAME")
    if project:
        return client.containers.list(filters={"label": f"com.docker.compose.project={project}"})
    return client.containers.list(filters={"label": "com.docker.compose.project"})

@app.get("/debug/compose-logs")
async def compose_logs():
    if os.getenv("DEBUG_COMPOSE_LOGS") != "1":
        raise HTTPException(404, t("err_debug_disabled"))
    if docker is None:
        raise HTTPException(500, t("err_docker_sdk_missing"))

    try:
        client = docker.from_env()
        containers = _compose_containers(client)
    except Exception as e:
        raise HTTPException(500, t("err_docker_unavailable", {"error": e}))

    if not containers:
        raise HTTPException(404, t("err_no_compose_containers"))

    queue: asyncio.Queue[dict] = asyncio.Queue()
    stop_event = threading.Event()
    loop = asyncio.get_running_loop()

    def _pump(container, service: str):
        try:
            for raw in container.logs(stream=True, follow=True, timestamps=True, tail=200):
                if stop_event.is_set():
                    break
                try:
                    line = raw.decode("utf-8", errors="replace").rstrip("\n")
                except Exception:
                    line = str(raw)
                payload = {"ts": datetime.utcnow().isoformat() + "Z", "service": service, "line": line}
                loop.call_soon_threadsafe(queue.put_nowait, payload)
        except Exception as e:
            payload = {"ts": datetime.utcnow().isoformat() + "Z", "service": service, "line": t("log_error_line", {"error": e})}
            loop.call_soon_threadsafe(queue.put_nowait, payload)

    threads = []
    for c in containers:
        service = c.labels.get("com.docker.compose.service", c.name)
        t = threading.Thread(target=_pump, args=(c, service), daemon=True)
        t.start()
        threads.append(t)

    async def event_stream():
        try:
            while True:
                item = await queue.get()
                yield f"data: {json.dumps(item)}\n\n"
        except asyncio.CancelledError:
            raise
        finally:
            stop_event.set()
            for t in threads:
                t.join(timeout=0.2)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
