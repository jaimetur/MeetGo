"""What waits for the administrators, per section of the administration: open reports (Moderation), proposed
categories (Categories) and interests whose communities should be split or joined (Communities). The app shows each
count on its tab, in the overview and in a notice when an administrator opens MeetGo; anything reviewed by one
administrator disappears for all."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Report, User


async def pending_counts(db: AsyncSession) -> dict:
    from app.admin.routes import admin_interests
    from app.categories.service import pending_count
    reports = int((await db.execute(select(func.count()).select_from(Report).where(Report.status == "open"))).scalar() or 0)
    suggestions = sum(1 for i in await admin_interests(db=db, admin=None) if i.get("suggest") and i.get("active", True))
    counts = {"moderation": reports, "categories": await pending_count(db), "communities": suggestions}
    return {**counts, "total": sum(counts.values())}


async def tell_admins(db: AsyncSession) -> None:
    """The administrators' apps reload the counts (a new thing appears, one reviewed disappears)."""
    from app.realtime.service import publish
    ids = (await db.execute(select(User.id).where(User.role == "admin"))).scalars().all()
    await publish(list(ids), {"type": "admin.pending"})
