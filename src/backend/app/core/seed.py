"""First-run data: administration settings, channel interests and the first administrator."""

import logging
import secrets

from sqlalchemy import text, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.models import Interest, User
from app.core.security import hash_password
from app.core.utils import age_range_from_dob
from app.core.app_settings import get_settings_row

logger = logging.getLogger("meetgo")

DEFAULT_SETTINGS = {
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
    # Automatic notification emails (mentions, unread messages, requests, reports, moderation, plan reminders).
    "email_notifications": {"enabled": True, "delay_minutes": 15, "cooldown_hours": 3},
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

DEFAULT_INTERESTS = [
    ("tomar_algo", "Tomar algo"),
    ("senderismo", "Senderismo"),
    ("cine", "Cine"),
    ("deporte", "Deportes"),
    ("networking", "Networking"),
    ("ciclismo", "Ciclismo"),
    ("mtb", "MTB"),
    ("motos", "Motos"),
    ("coches", "Coches"),
    ("playa", "Playa"),
    ("viajes", "Viajes"),
    ("lectura", "Lectura"),
    ("picnics", "Picnics"),
    ("deportes_aire_libre", "Deportes al aire libre"),
    ("deportes_acuaticos", "Deportes acuaticos"),
    ("futbol", "Futbol"),
    ("futbol_sala", "Futbol sala"),
    ("tenis", "Tenis"),
    ("padel", "Padel"),
    ("fitness", "Fitness"),
    ("crossfit", "CrossFit"),
    ("conciertos", "Conciertos"),
    ("musica_80", "Música de los 80"),
    ("musica_rock", "Música Rock"),
    ("musica_flamenca", "Música Flamenca"),
    ("salir_de_fiesta", "Salir de Fiesta"),
    ("hacer_amigos", "Hacer Amigos"),
    ("aprender_ingles", "Aprender Inglés"),
    ("aprender_aleman", "Aprender Alemán"),
    ("aprender_frances", "Aprender Francés"),
]

# Interests whose name changed: (old name, new name). Only a name still as it was is changed (not one an administrator
# renamed); the communities show the interest's name, so they follow.
RENAMED_INTERESTS = {"tomar_algo": ("Quedar para tomar algo", "Tomar algo"), "deporte": ("Deporte", "Deportes")}


async def seed(db: AsyncSession) -> None:
    st = await get_settings_row(db)
    if not st.data:
        st.data = DEFAULT_SETTINGS
        await db.commit()
    existing = set((await db.execute(select(Interest.slug))).scalars().all())
    for slug, name in DEFAULT_INTERESTS:
        if slug not in existing:
            db.add(Interest(slug=slug, name=name))
    await db.commit()
    await merge_interests(db, MERGED_INTERESTS, "tomar_algo")
    await merge_interests(db, MERGED_SPORTS, "deporte")
    for slug, (old, new) in RENAMED_INTERESTS.items():
        await db.execute(update(Interest).where(Interest.slug == slug, Interest.name == old).values(name=new))
    await db.commit()
    await ensure_admin(db)
    await ensure_bots(db)


# Interests that became one: a coffee, a beer and drinks are now "Tomar algo".
MERGED_INTERESTS = ("cafe", "cerveza", "copas")
# "Deporte" and "Deportes (general)" were the same: one community, "Deportes".
MERGED_SPORTS = ("deportes",)


async def merge_interests(db: AsyncSession, old_slugs: tuple[str, ...], new_slug: str) -> None:
    """Moves everything of the old interests into the new one, zone by zone: the community (the first old one becomes
    the new one; the others' members, messages, posts and join requests move into it and they go), and the people
    who had chosen any of them. Nothing to do once the old interests are gone."""
    old = dict((await db.execute(select(Interest.slug, Interest.id).where(Interest.slug.in_(old_slugs)))).all())
    new_id = (await db.execute(select(Interest.id).where(Interest.slug == new_slug))).scalar_one_or_none()
    if not old or not new_id:
        return
    old_ids = [old[s] for s in old_slugs if s in old]
    zones = (await db.execute(text(
        "SELECT DISTINCT province, age_range FROM conversations WHERE kind = 'channel' AND interest_id = ANY(:ids)"),
        {"ids": old_ids})).all()
    for province, age in zones:
        rows = (await db.execute(text(
            "SELECT id, interest_id FROM conversations WHERE kind = 'channel' AND province = :p AND age_range = :a "
            "AND interest_id = ANY(:ids)"), {"p": province, "a": age, "ids": old_ids + [new_id]})).all()
        by_interest = {i: c for c, i in rows}
        target = by_interest.get(new_id) or next(by_interest[i] for i in old_ids if i in by_interest)
        others = [c for c, _ in rows if c != target]
        if others:
            params = {"t": target, "o": others}
            await db.execute(text("""
                INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_message_id, notify,
                    muted_until, pinned, hidden, strikes, last_strike_at, silenced_until, banned, ban_until,
                    email_notified_message_id, away)
                SELECT DISTINCT ON (user_id) :t, user_id, role, joined_at, 0, notify, muted_until, pinned, hidden, strikes,
                    last_strike_at, silenced_until, banned, ban_until, 0, away
                FROM conversation_members WHERE conversation_id = ANY(:o) ORDER BY user_id, joined_at
                ON CONFLICT DO NOTHING"""), params)
            for table in ("messages", "board_posts", "community_requests"):
                await db.execute(text(f"UPDATE {table} SET conversation_id = :t WHERE conversation_id = ANY(:o)"), params)
            # who moved in has read everything up to now (no flood of "unread" or digest emails)
            await db.execute(text("""
                UPDATE conversation_members SET
                    last_read_message_id = (SELECT coalesce(max(id), 0) FROM messages WHERE conversation_id = :t),
                    email_notified_message_id = (SELECT coalesce(max(id), 0) FROM messages WHERE conversation_id = :t)
                WHERE conversation_id = :t AND last_read_message_id = 0"""), {"t": target})
            await db.execute(text("DELETE FROM conversations WHERE id = ANY(:o)"), {"o": others})
        await db.execute(text("""
            UPDATE conversations SET interest_id = :n, last_message_id = (SELECT max(id) FROM messages WHERE conversation_id = :t),
                last_message_at = (SELECT max(created_at) FROM messages WHERE conversation_id = :t) WHERE id = :t"""),
            {"n": new_id, "t": target})
    await db.execute(text("""
        INSERT INTO user_interests (user_id, interest_id, created_at)
        SELECT DISTINCT ON (user_id) user_id, :n, created_at FROM user_interests WHERE interest_id = ANY(:ids)
        ORDER BY user_id, created_at ON CONFLICT DO NOTHING"""), {"n": new_id, "ids": old_ids})
    await db.execute(text("DELETE FROM user_interests WHERE interest_id = ANY(:ids)"), {"ids": old_ids})
    # The rooms of version 0.1 (kept untouched, unused) still name the old interests: they keep their values,
    # without the link that would stop the old interests from going.
    if (await db.execute(text("SELECT to_regclass('rooms') IS NOT NULL"))).scalar():
        await db.execute(text("ALTER TABLE rooms DROP CONSTRAINT IF EXISTS rooms_interest_id_fkey"))
    await db.execute(text("DELETE FROM interests WHERE id = ANY(:ids)"), {"ids": old_ids})
    await db.commit()
    logger.info("Merged the interests %s into %s", ", ".join(old), new_slug)


BOTS = {"admin": "bot-admin", "moderator": "bot-moderator"}


async def ensure_bots(db: AsyncSession) -> None:
    """The bot accounts exist and are members of every community (new ones get them from a database trigger)."""
    have = set((await db.execute(select(User.bot_role).where(User.bot_role.is_not(None)))).scalars().all())
    for role, name in BOTS.items():
        if role not in have:
            db.add(User(email=None, phone=None, password_hash=None, display_name=name, dob="1990-01-01",
                        age_range=age_range_from_dob("1990-01-01"), country="ES", province="MeetGo", accept_dm=False,
                        bio="", role="user", email_verified=True, bot_role=role))
    await db.commit()
    await db.execute(text("""
        INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_message_id, notify,
                                          pinned, hidden, strikes, banned, email_notified_message_id, away)
        SELECT c.id, u.id, u.bot_role, now(), 0, 'none', false, false, 0, false, 0, false
        FROM conversations c CROSS JOIN users u
        WHERE c.kind = 'channel' AND u.bot_role IS NOT NULL
        ON CONFLICT DO NOTHING"""))
    await db.commit()


async def ensure_admin(db: AsyncSession) -> None:
    """Create the first administrator only when there is none; never touch existing accounts."""
    if (await db.execute(select(User.id).where(User.role == "admin").limit(1))).first():
        return
    email = settings.ADMIN_EMAIL.strip().lower()
    if (await db.execute(select(User.id).where(func.lower(User.email) == email))).first():
        logger.warning("No administrator exists and %s belongs to a regular account; set ADMIN_EMAIL.", email)
        return
    password = settings.ADMIN_PASSWORD
    generated = not password
    if generated:
        password = secrets.token_urlsafe(18)
    db.add(User(
        email=email, phone=None, password_hash=hash_password(password), display_name="admin", dob="1980-01-01",
        age_range=age_range_from_dob("1980-01-01"), country="ES", province="Madrid", accept_dm=False, bio="",
        role="admin", email_verified=True, password_temp=generated,
    ))
    await db.commit()
    if generated:
        logger.warning("Created administrator %s with temporary password: %s", email, password)
