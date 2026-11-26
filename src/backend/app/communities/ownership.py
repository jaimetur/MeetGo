"""Who runs a community made by people, and the emails when that changes.

- When its owner stops fitting it (their age leaves its age span, or they move out of its zone), they keep running it for
  `GRACE_DAYS` days and get an email: they can hand it over (Settings → Team) or widen the ages again.
- After that, MeetGo hands it over (`hand_over_ownership`: the oldest co-administrator, or else the oldest member) and
  the old owner stays away, as any member who no longer fits.
- Every change of owner or co-administrator emails the people concerned: the old and the new owner; the person named
  or removed as co-administrator. These go out whenever mail is configured (not a choice in Your account → Alerts).
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Conversation, ConversationMember, User, utcnow
from app.realtime import service as realtime

GRACE_DAYS = 30


def deadline(conv: Conversation):
    return conv.owner_out_since + timedelta(days=GRACE_DAYS) if conv.owner_out_since else None


async def _mail(db: AsyncSession, user: User | None, key: str, conv: Conversation, params: dict | None = None) -> None:
    from app.mail import notify_email
    if user:
        await notify_email.account_email(db, user, key, {"community": conv.title or "", **(params or {})}, f"/app/c/{conv.id}")


async def owner_changed(db: AsyncSession, conv: Conversation, old: User | None, new: User | None, automatic: bool = False) -> None:
    """Email the new owner and the old one."""
    names = {"old": old.shown_name if old else "", "new": new.shown_name if new else ""}
    await _mail(db, new, "email_owner_new", conv, names)
    await _mail(db, old, "email_owner_auto_old" if automatic else "email_owner_old", conv, names)


async def coadmin_changed(db: AsyncSession, conv: Conversation, user: User | None, added: bool) -> None:
    await _mail(db, user, "email_coadmin_added" if added else "email_coadmin_removed", conv)


def step_down(conv: Conversation, member: ConversationMember, user: User) -> None:
    """The old owner after a hand-over: co-administrator if they still fit, else a member away (as anyone who no
    longer fits)."""
    from app.communities.service import in_zone
    if in_zone(user, conv):
        member.role = "admin"
    else:
        member.role, member.away = "member", True
    conv.owner_out_since = None


async def grace_once(db: AsyncSession) -> int:
    """Owners of communities made by people who no longer fit them: start the 30 days (and tell them), or hand the
    community over once they are up. Returns how many were handed over."""
    from app.communities.service import hand_over_ownership, in_zone
    rows = (await db.execute(select(ConversationMember, Conversation, User).join(
        Conversation, Conversation.id == ConversationMember.conversation_id).join(
        User, User.id == ConversationMember.user_id).where(
        ConversationMember.role == "owner", ConversationMember.banned.is_(False), Conversation.kind == "channel",
        Conversation.interest_id.is_(None)))).all()
    now, handed = utcnow(), 0
    for member, conv, user in rows:
        if in_zone(user, conv):
            if conv.owner_out_since:  # fits again (the ages were widened, or back in the zone)
                conv.owner_out_since = None
                await db.commit()
            continue
        if member.away:  # the owner keeps running it during the grace days
            member.away = False
        if conv.owner_out_since is None:
            conv.owner_out_since = now
            await db.commit()
            await _mail(db, user, "email_owner_grace", conv, {"date": deadline(conv).strftime("%d/%m/%Y"), "days": GRACE_DAYS})
            continue
        if now < deadline(conv):
            await db.commit()
            continue
        nxt = await hand_over_ownership(db, conv, user.id)
        if not nxt:  # nobody else in it: it stays with them
            await db.commit()
            continue
        step_down(conv, member, user)
        await db.commit()
        await owner_changed(db, conv, user, await db.get(User, nxt.user_id), automatic=True)
        await realtime.publish([user.id, nxt.user_id], {"type": "conversation.changed", "conversation_id": conv.id})
        handed += 1
    return handed
