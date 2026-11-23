"""First-run data: administration settings, channel interests and the first administrator."""

import logging
import secrets

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..models import Interest, User
from ..security import hash_password
from ..utils import age_range_from_dob
from .app_settings import get_settings_row

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
    await ensure_admin(db)


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
