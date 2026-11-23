import asyncio
import json
import os
import secrets
import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_db, require_admin
from app.core.i18n import t
from app.core.models import (
    AccessGrant, BoardPost, Conversation, DMRequest, Follow, FriendRequest, Friendship, Interest, Message, Post, PromoCode, Report,
    StripeSubscription, PlaySubscription, User, UserInterest, utcnow,
)
from app.core.schemas import (
    AdminAccessIn, AdminInterestIn, AdminSmtpTestIn, AdminUserCreateIn, AdminUserUpdateIn, InterestOut, MeOut, PromoCodeIn,
    ReportResolveIn,
)
from app.core.security import decode_token, hash_password
from app.billing import service as billing
from app.core.app_settings import get_section, get_settings_row, set_section
from app.billing.service import normalise_code, promo_out
from app.conversations.service import messages_out, user_summary
from app.core.crypto import encrypt
from app.mail.email import send_email
from app.core.app_settings import app_base_url
from app.messaging.service import delete_message
from app.board.service import delete_post_data
from app.accounts.common import me_out, normalize_phone, parse_dob

try:
    import docker
except Exception:  # pragma: no cover
    docker = None

router = APIRouter(prefix="/admin", tags=["admin"])
# Sections holding secrets: edited only through their own endpoints, never returned in full.
PROTECTED_SECTIONS = {"stripe", "play", "fcm", "webpush", "billing"}


@router.get("/settings", response_model=dict)
async def get_settings(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    data = (await get_settings_row(db)).data or {}
    return {k: v for k, v in data.items() if k not in PROTECTED_SECTIONS}


@router.put("/settings", response_model=dict)
async def put_settings(payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    st = await get_settings_row(db)
    data = {k: v for k, v in (st.data or {}).items() if k in PROTECTED_SECTIONS}
    data.update({k: v for k, v in (payload or {}).items() if k not in PROTECTED_SECTIONS})
    st.data = data
    await db.commit()
    return {k: v for k, v in data.items() if k not in PROTECTED_SECTIONS}


@router.post("/smtp/test", response_model=dict)
async def smtp_test(payload: AdminSmtpTestIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    to_email = (payload.to_email or "").strip()
    if not to_email:
        raise HTTPException(400, t("err_missing_to_email"))
    await send_email(db, to_email, t("email_smtp_test_subject"), t("email_smtp_test_body"))
    return {"ok": True}


# ---------- users ----------

async def _plans(db: AsyncSession, ids: list[int]) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for g in (await db.execute(select(AccessGrant).where(AccessGrant.user_id.in_(ids)))).scalars().all():
        out[g.user_id] = {"kind": "gift", "source": g.source, "until": g.until.isoformat() if g.until else None}
    for s in (await db.execute(select(StripeSubscription).where(StripeSubscription.user_id.in_(ids)))).scalars().all():
        out.setdefault(s.user_id, {"kind": "web", "plan": s.plan, "status": s.status,
                                   "until": s.period_end.isoformat() if s.period_end else None})
    for p in (await db.execute(select(PlaySubscription).where(PlaySubscription.user_id.in_(ids)))).scalars().all():
        out.setdefault(p.user_id, {"kind": "play", "plan": p.base_plan, "status": p.state,
                                   "until": p.expiry.isoformat() if p.expiry else None})
    return out


@router.get("/users", response_model=list[dict])
async def list_users(q: str | None = None, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    query = select(User)
    if q:
        like = f"%{q}%"
        query = query.where(or_(User.display_name.ilike(like), User.email.ilike(like), User.phone.ilike(like)))
    users = (await db.execute(query.order_by(User.id.desc()).limit(500))).scalars().all()
    plans = await _plans(db, [u.id for u in users])
    return [{**me_out(u).model_dump(mode="json"), "access_required": u.access_required,
             "plan": plans.get(u.id) or ({"kind": "free"} if not u.access_required else {"kind": "none"}),
             "is_banned": u.is_banned} for u in users]


@router.post("/users", response_model=MeOut)
async def create_user(payload: AdminUserCreateIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    email = payload.email.strip().lower()
    if (await db.execute(select(User.id).where(User.email == email))).first():
        raise HTTPException(409, t("err_email_already_used"))
    phone_norm = normalize_phone(payload.phone, payload.country)
    if not phone_norm:
        raise HTTPException(400, t("err_invalid_phone"))
    if (await db.execute(select(User.id).where(User.phone == phone_norm))).first():
        raise HTTPException(409, t("err_phone_already_used"))
    if len(payload.password) < 6:
        raise HTTPException(400, t("err_password_too_short"))
    u = User(email=email, phone=phone_norm, password_hash=hash_password(payload.password),
             display_name=payload.display_name.strip(), dob=payload.dob, age_range=parse_dob(payload.dob),
             country=payload.country or "ES", province=payload.province.strip(),
             city=(payload.city.strip() if payload.city else None), accept_dm=False, bio="",
             role=payload.role or "user", email_verified=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return me_out(u)


@router.patch("/users/{user_id}", response_model=MeOut)
async def update_user(user_id: int, payload: AdminUserUpdateIn, db: AsyncSession = Depends(get_db),
                      admin: User = Depends(require_admin)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    if payload.display_name is not None:
        target.display_name = payload.display_name.strip()
    if payload.email is not None:
        email = payload.email.strip().lower() or None
        if email != target.email:
            if email and (await db.execute(select(User.id).where(User.email == email))).first():
                raise HTTPException(409, t("err_email_already_used"))
            target.email = email
    if payload.phone is not None:
        phone_norm = normalize_phone(payload.phone, payload.country or target.country)
        if not phone_norm:
            raise HTTPException(400, t("err_invalid_phone"))
        if phone_norm != target.phone:
            if (await db.execute(select(User.id).where(User.phone == phone_norm))).first():
                raise HTTPException(409, t("err_phone_already_used"))
            target.phone = phone_norm
    if payload.password is not None:
        if len(payload.password) < 6:
            raise HTTPException(400, t("err_password_too_short"))
        target.password_hash = hash_password(payload.password)
    if payload.dob is not None:
        target.age_range = parse_dob(payload.dob)
        target.dob = payload.dob
    for field in ("country", "province", "city", "role", "email_verified", "is_banned"):
        value = getattr(payload, field)
        if value is not None:
            setattr(target, field, value)
    if payload.banned_until is not None:
        target.banned_until = payload.banned_until.replace(tzinfo=None)
    await db.commit()
    await db.refresh(target)
    return me_out(target)


@router.put("/users/{user_id}/access", response_model=dict)
async def set_access(user_id: int, payload: AdminAccessIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Free access: "lifetime", until a date (YYYY-MM-DD) or "none"."""
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    await billing.admin_set_free_access(db, target, payload.free_until)
    await db.commit()
    return await billing.access_status(db, target)


@router.post("/users/{user_id}/resend-verification", response_model=dict)
async def resend_verification(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404, t("err_user_not_found"))
    if not target.email:
        raise HTTPException(400, t("err_user_no_email"))
    token = secrets.token_urlsafe(32)
    target.email_verification_token = token
    target.email_verification_sent_at = datetime.utcnow()
    await db.commit()
    link = f"{await app_base_url(db)}/app/?verify_token={token}"
    await send_email(db, target.email, t("email_verify_subject"), t("email_verify_body", {"link": link}))
    return {"ok": True}


async def _table_exists(db: AsyncSession, name: str) -> bool:
    return bool((await db.execute(text("SELECT to_regclass(:n)"), {"n": f"public.{name}"})).scalar())


@router.delete("/users/{user_id}", response_model=dict)
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if admin.id == user_id:
        raise HTTPException(400, t("err_cannot_delete_self"))
    # Tables from version 0.1 that are kept after the migration and have no cascading keys.
    if await _table_exists(db, "dm_messages"):
        await db.execute(text("""DELETE FROM dm_messages WHERE user_id = :u OR conversation_id IN
                                 (SELECT id FROM dm_conversations WHERE user1_id = :u OR user2_id = :u)"""), {"u": user_id})
        await db.execute(text("DELETE FROM dm_conversations WHERE user1_id = :u OR user2_id = :u"), {"u": user_id})
    if await _table_exists(db, "room_messages"):
        await db.execute(text("DELETE FROM room_messages WHERE user_id = :u"), {"u": user_id})
        await db.execute(text("DELETE FROM room_discipline WHERE user_id = :u"), {"u": user_id})
        await db.execute(text("UPDATE room_rules SET updated_by_user_id = NULL WHERE updated_by_user_id = :u"), {"u": user_id})
    await db.execute(delete(DMRequest).where(or_(DMRequest.from_user_id == user_id, DMRequest.to_user_id == user_id)))
    await db.execute(delete(FriendRequest).where(or_(FriendRequest.from_user_id == user_id, FriendRequest.to_user_id == user_id)))
    await db.execute(delete(Friendship).where(or_(Friendship.user_id == user_id, Friendship.friend_id == user_id)))
    await db.execute(delete(Follow).where(or_(Follow.follower_id == user_id, Follow.following_id == user_id)))
    await db.execute(delete(Post).where(Post.user_id == user_id))
    await db.execute(delete(UserInterest).where(UserInterest.user_id == user_id))
    await db.execute(update(Conversation).where(Conversation.created_by_id == user_id).values(created_by_id=None))
    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
    return {"ok": True}


# ---------- channels (interests) ----------

@router.post("/interests", response_model=InterestOut)
async def create_interest(payload: AdminInterestIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    if (await db.execute(select(Interest.id).where(Interest.slug == payload.slug))).first():
        raise HTTPException(409, t("err_interest_exists"))
    it = Interest(slug=payload.slug, name=payload.name)
    db.add(it)
    await db.commit()
    await db.refresh(it)
    return InterestOut(id=it.id, slug=it.slug, name=it.name)


@router.patch("/interests/{interest_id}", response_model=InterestOut)
async def update_interest(interest_id: int, payload: AdminInterestIn, db: AsyncSession = Depends(get_db),
                          admin: User = Depends(require_admin)):
    it = await db.get(Interest, interest_id)
    if not it:
        raise HTTPException(404, t("err_interest_not_found"))
    it.slug, it.name = payload.slug, payload.name
    await db.commit()
    return InterestOut(id=it.id, slug=it.slug, name=it.name)


@router.delete("/interests/{interest_id}", response_model=dict)
async def delete_interest(interest_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    in_use = (await db.execute(select(func.count()).select_from(Conversation).where(Conversation.interest_id == interest_id))).scalar_one()
    if in_use or (await _table_exists(db, "rooms") and (await db.execute(
            text("SELECT count(*) FROM rooms WHERE interest_id = :i"), {"i": interest_id})).scalar_one()):
        raise HTTPException(409, t("err_interest_in_use"))
    await db.execute(delete(UserInterest).where(UserInterest.interest_id == interest_id))
    await db.execute(delete(Interest).where(Interest.id == interest_id))
    await db.commit()
    return {"ok": True}


# ---------- moderation ----------

@router.get("/reports", response_model=list[dict])
async def list_reports(status: str = "open", db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    rows = (await db.execute(select(Report).where(Report.status == status).order_by(Report.id.desc()).limit(200))).scalars().all()
    msgs = {m.id: m for m in (await db.execute(select(Message).where(Message.id.in_([r.message_id for r in rows if r.message_id])))).scalars().all()}
    posts = {p.id: p for p in (await db.execute(select(BoardPost).where(BoardPost.id.in_([r.post_id for r in rows if r.post_id])))).scalars().all()}
    user_ids = {r.reporter_id for r in rows} | {p.author_id for p in posts.values() if p.author_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()}
    out = []
    for r in rows:
        item = {"id": r.id, "kind": "post" if r.post_id else "message", "reason": r.reason, "details": r.details,
                "status": r.status, "created_at": r.created_at.isoformat(), "reporter": user_summary(users.get(r.reporter_id)),
                "message": None, "post": None}
        if r.post_id:
            p = posts.get(r.post_id)
            if p:
                item["post"] = {"id": p.id, "community_id": p.conversation_id, "kind": p.kind, "title": p.title,
                                "body": p.body, "author": user_summary(users.get(p.author_id)),
                                "created_at": p.created_at.isoformat(), "deleted": bool(p.deleted_at)}
                # The same shape as a message, so the moderation queue shows it as it is.
                item["message"] = {"id": p.id, "conversation_id": p.conversation_id, "sender": item["post"]["author"],
                                   "body": f"{p.title}\n\n{p.body or ''}".strip(), "created_at": item["post"]["created_at"],
                                   "deleted": bool(p.deleted_at), "original_body": p.body if p.deleted_at else None,
                                   "attachments": []}
        else:
            m = msgs.get(r.message_id)
            shown = (await messages_out(db, [m], admin.id))[0] if m else None
            if shown and m.deleted_at:
                shown["original_body"] = m.body  # moderators see what was removed
            item["message"] = shown
        out.append(item)
    return out


@router.post("/reports/{report_id}/resolve", response_model=dict)
async def resolve_report(report_id: int, payload: ReportResolveIn, db: AsyncSession = Depends(get_db),
                         admin: User = Depends(require_admin)):
    report = await db.get(Report, report_id)
    if not report:
        raise HTTPException(404, t("err_request_not_found"))
    if report.post_id:
        post = await db.get(BoardPost, report.post_id)
        if payload.delete_message and post and not post.deleted_at:
            await delete_post_data(db, post)
        same = Report.post_id == report.post_id
    else:
        if payload.delete_message:
            msg = await db.get(Message, report.message_id)
            if msg:
                await delete_message(db, msg, admin, None)
        same = Report.message_id == report.message_id
    await db.execute(update(Report).where(same, Report.status == "open").values(
        status=payload.status, resolved_by_id=admin.id, resolved_at=utcnow()))
    await db.commit()
    return {"ok": True}


# ---------- subscriptions ----------

@router.get("/billing", response_model=dict)
async def get_billing(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    stripe = await get_section(db, "stripe")
    play = await get_section(db, "play")
    fcm = await get_section(db, "fcm")
    base = settings.PUBLIC_API_BASE.rstrip("/")
    counts = {
        "gift": (await db.execute(select(func.count()).select_from(AccessGrant))).scalar_one(),
        "web": (await db.execute(select(func.count()).select_from(StripeSubscription).where(
            StripeSubscription.status.in_(billing.STRIPE_ACTIVE)))).scalar_one(),
        "play": (await db.execute(select(func.count()).select_from(PlaySubscription))).scalar_one(),
    }
    return {
        **await billing.billing_config(db),
        "stripe": {"configured": bool(stripe.get("secret_enc")), "webhook_configured": bool(stripe.get("webhook_enc")),
                   "prices": stripe.get("prices") or {}, "webhook_url": f"{base}/billing/stripe/webhook"},
        "play": {"package": play.get("package") or "app.meetgo.android", "product": play.get("product") or "meetgo",
                 "configured": bool(play.get("service_account_enc")), "store_url": play.get("store_url") or ""},
        "fcm": {"configured": bool(fcm.get("service_account_enc")), "project_id": fcm.get("project_id")},
        "counts": counts,
    }


@router.put("/billing", response_model=dict)
async def put_billing(payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Turns subscriptions on or off and stores Stripe, Google Play and Firebase credentials."""
    cfg = await get_section(db, "billing")
    if "enabled" in payload:
        cfg["enabled"] = bool(payload["enabled"])
    if "trial_days" in payload:
        cfg["trial_days"] = max(0, min(int(payload["trial_days"] or 0), 90))
    await set_section(db, "billing", cfg)

    stripe_in = payload.get("stripe") or {}
    if stripe_in:
        stripe = await get_section(db, "stripe")
        if stripe_in.get("secret"):
            secret = stripe_in["secret"].strip()
            stripe["prices"] = await billing.stripe_ensure_prices(secret)
            stripe["secret_enc"] = encrypt(secret)
        if stripe_in.get("webhook"):
            stripe["webhook_enc"] = encrypt(stripe_in["webhook"].strip())
        await set_section(db, "stripe", stripe)

    play_in = payload.get("play") or {}
    if play_in:
        play = await get_section(db, "play")
        for key in ("package", "product", "store_url"):
            if key in play_in:
                play[key] = (play_in[key] or "").strip()
        if play_in.get("service_account"):
            sa = json.loads(play_in["service_account"])
            if not sa.get("client_email") or not sa.get("private_key"):
                raise HTTPException(400, t("err_service_account"))
            play["service_account_enc"] = encrypt(json.dumps(sa))
        await set_section(db, "play", play)

    fcm_in = payload.get("fcm") or {}
    if fcm_in.get("service_account"):
        sa = json.loads(fcm_in["service_account"])
        if not sa.get("project_id") or not sa.get("private_key"):
            raise HTTPException(400, t("err_service_account"))
        await set_section(db, "fcm", {"service_account_enc": encrypt(json.dumps(sa)), "project_id": sa["project_id"]})
    return await get_billing(db, admin)


@router.get("/promo-codes", response_model=list[dict])
async def list_codes(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    res = await db.execute(select(PromoCode).order_by(PromoCode.created_at))
    return [promo_out(p) for p in res.scalars().all()]


@router.put("/promo-codes", response_model=dict)
async def put_code(payload: PromoCodeIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    code = normalise_code(payload.code)
    p = await db.get(PromoCode, code)
    if p and payload.max_uses is not None and payload.max_uses < p.used:
        raise HTTPException(409, t("err_promo_below_used"))
    if not p:
        p = PromoCode(code=code, used=0)
        db.add(p)
    p.aliases = [normalise_code(a) for a in payload.aliases if a.strip()]
    p.duration, p.max_uses, p.public, p.expires_on = payload.duration, payload.max_uses, payload.public, payload.expires_on
    await db.commit()
    return promo_out(p)


@router.delete("/promo-codes/{code}", response_model=dict)
async def delete_code(code: str, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    await db.execute(delete(PromoCode).where(PromoCode.code == normalise_code(code)))
    await db.commit()
    return {"ok": True}


# ---------- container logs (needs the Docker socket and DEBUG_COMPOSE_LOGS) ----------

@router.get("/compose-logs")
async def compose_logs(token: str = "", db: AsyncSession = Depends(get_db)):
    if not settings.DEBUG_COMPOSE_LOGS:
        raise HTTPException(404, t("err_debug_disabled"))
    # EventSource cannot send headers, so the administrator token comes as a query parameter.
    try:
        admin = await db.get(User, int(decode_token(token)))
    except Exception:
        raise HTTPException(401, t("err_invalid_token"))
    if not admin or admin.role != "admin":
        raise HTTPException(403, t("err_admin_required"))
    if docker is None:
        raise HTTPException(500, t("err_docker_sdk_missing"))
    try:
        client = docker.from_env()
        project = os.getenv("COMPOSE_PROJECT_NAME")
        label = f"com.docker.compose.project={project}" if project else "com.docker.compose.project"
        containers = client.containers.list(filters={"label": label})
    except Exception as e:
        raise HTTPException(500, t("err_docker_unavailable", {"error": e}))
    if not containers:
        raise HTTPException(404, t("err_no_compose_containers"))

    queue: asyncio.Queue[dict] = asyncio.Queue()
    stop_event = threading.Event()
    loop = asyncio.get_running_loop()

    def pump(container, service: str):
        try:
            for raw in container.logs(stream=True, follow=True, timestamps=True, tail=200):
                if stop_event.is_set():
                    break
                line = raw.decode("utf-8", errors="replace").rstrip("\n")
                loop.call_soon_threadsafe(queue.put_nowait, {"ts": datetime.utcnow().isoformat() + "Z", "service": service, "line": line})
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, {"ts": datetime.utcnow().isoformat() + "Z", "service": service,
                                                         "line": t("log_error_line", {"error": e})})

    workers = []
    for c in containers:
        worker = threading.Thread(target=pump, args=(c, c.labels.get("com.docker.compose.service", c.name)), daemon=True)
        worker.start()
        workers.append(worker)

    async def stream():
        try:
            while True:
                yield f"data: {json.dumps(await queue.get())}\n\n"
        finally:
            stop_event.set()

    return StreamingResponse(stream(), media_type="text/event-stream")
