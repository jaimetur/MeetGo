from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db
from ..models import User
from ..schemas import CheckoutIn, CompleteIn, PlayLinkIn, RedeemIn
from ..services import billing

router = APIRouter(tags=["billing"])


@router.get("/billing/plans", response_model=dict)
async def plans(db: AsyncSession = Depends(get_db)):
    cfg = await billing.billing_config(db)
    stripe = await billing.stripe_config(db)
    play = await billing.play_config(db)
    return {
        "enabled": cfg["enabled"],
        "trial_days": cfg["trial_days"],
        "currency": "EUR",
        "plans": [{"id": plan, "amount": spec["amount"], "interval": spec["interval"]} for plan, spec in billing.PLANS.items()],
        "stripe": bool(stripe["secret"] and stripe["prices"]),
        "play": {"enabled": bool(play["service_account"]), "product": play["product"], "store_url": play["store_url"]},
    }


@router.get("/billing/promos", response_model=dict)
async def promos(db: AsyncSession = Depends(get_db)):
    """Public campaigns for the landing page, with the places left. While subscriptions are off the app is free:
    no campaigns, and the landing page hides prices."""
    enabled = (await billing.billing_config(db))["enabled"]
    return {"subscriptions": enabled, "promos": await billing.public_promos(db) if enabled else []}


@router.get("/billing/status", response_model=dict)
async def status(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return await billing.access_status(db, user, refresh=True)


@router.post("/billing/redeem", response_model=dict)
async def redeem(payload: RedeemIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await billing.redeem_code(db, user, payload.code)
    await db.commit()
    return await billing.access_status(db, user)


@router.post("/billing/stripe/checkout", response_model=dict)
async def checkout(payload: CheckoutIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return {"url": await billing.stripe_checkout(db, user, payload.plan)}


@router.post("/billing/stripe/complete", response_model=dict)
async def complete(payload: CompleteIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await billing.stripe_complete(db, user, payload.session_id)
    return await billing.access_status(db, user)


@router.post("/billing/stripe/portal", response_model=dict)
async def portal(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return {"url": await billing.stripe_portal(db, user)}


@router.post("/billing/stripe/cancel", response_model=dict)
async def cancel(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await billing.stripe_set_cancel(db, user, True)
    return await billing.access_status(db, user)


@router.post("/billing/stripe/resume", response_model=dict)
async def resume(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await billing.stripe_set_cancel(db, user, False)
    return await billing.access_status(db, user)


@router.post("/billing/stripe/change", response_model=dict)
async def change(payload: CheckoutIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await billing.stripe_change_plan(db, user, payload.plan)
    return await billing.access_status(db, user)


@router.post("/billing/stripe/webhook", response_model=dict)
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    await billing.stripe_webhook(db, await request.body(), request.headers.get("stripe-signature", ""))
    return {"ok": True}


@router.post("/billing/play/link", response_model=dict)
async def play_link(payload: PlayLinkIn, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await billing.play_link(db, user, payload.token, payload.product)
    return await billing.access_status(db, user)
