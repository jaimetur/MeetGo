"""Geographic zones of the interest communities. Each interest chooses how wide its communities are (Administration):
one per country, per region (an autonomous community, a state… a group of provinces) or per province. A channel's
`province` column holds its zone key ("country:ES", "region:<group>" or the province itself) and `scope_provinces`
the provinces it covers, so listing and access work as for the communities people make with a wider scope.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

LEVELS = ("country", "region", "province")
DEFAULT_LEVEL = "country"
SPLIT_AT = 500  # members of one community from which the administration is told to split it further


async def geo_data(db: AsyncSession) -> dict:
    from app.core.app_settings import get_settings_row
    return (await get_settings_row(db)).data or {}


def country_of(data: dict, province: str, fallback: str = "ES") -> str:
    for code, provinces in (data.get("provinces_by_country") or {}).items():
        if any(p.get("value") == province for p in provinces or []):
            return code
    return fallback


def zone_of(data: dict, province: str, level: str | None) -> dict:
    """The zone of `level` that contains `province`: its key, kind, value, name and provinces. Without the region or
    the country in the settings, the province itself."""
    level = level if level in LEVELS else DEFAULT_LEVEL
    country = country_of(data, province)
    provinces = (data.get("provinces_by_country") or {}).get(country, [])
    name_of = {p.get("value"): p.get("name") or p.get("value") for p in provinces}
    own = {"key": province, "kind": "province", "value": province, "label": name_of.get(province, province), "provinces": [province]}
    if level == "region":
        group = next((g for g in (data.get("region_groups") or {}).get(country, []) if province in (g.get("regions") or [])), None)
        if group:
            return {"key": f"region:{group.get('value')}"[:64], "kind": "region", "value": group.get("value"),
                    "label": group.get("name") or group.get("value"), "provinces": list(group.get("regions") or [])}
    if level == "country" and provinces:
        cname = next((c.get("name") for c in data.get("countries") or [] if c.get("code") == country), country)
        return {"key": f"country:{country}", "kind": "country", "value": country, "label": cname, "provinces": list(name_of)}
    return own


# The language of a country (the official or main one among MeetGo's); regions with their own come next
COUNTRY_LANG = {
    "ES": "es", "MX": "es", "AR": "es", "CO": "es", "CL": "es", "PE": "es", "UY": "es", "VE": "es", "EC": "es",
    "GB": "en", "US": "en", "IE": "en", "CA": "en", "AU": "en", "NZ": "en", "FR": "fr", "BE": "fr", "LU": "fr",
    "DE": "de", "AT": "de", "CH": "de", "IT": "it", "PT": "pt", "BR": "pt", "NL": "nl", "JP": "ja", "CN": "zh",
    "TW": "zh", "AD": "ca",
}
CATALAN = ("catalu", "catalo", "illes balears", "islas baleares", "balears")


def zone_language(data: dict, zone: dict) -> str:
    """The language a zone's community is held in by default: its country's, or Catalan in the Catalan-speaking
    regions (a region or province of Catalonia or the Balearic Islands)."""
    country = country_of(data, zone["provinces"][0]) if zone.get("provinces") else "ES"
    if zone.get("kind") in ("region", "province") and country == "ES":
        for g in (data.get("region_groups") or {}).get("ES", []):
            name = f"{g.get('value', '')} {g.get('name', '')}".lower()
            if any(c in name for c in CATALAN) and set(zone["provinces"]) <= set(g.get("regions") or []):
                return "ca"
    return COUNTRY_LANG.get(country, "es")


def default_language(data: dict, conv) -> str:
    """The language of a community's zone (its scope: a province, a region or a whole country)."""
    provinces = list(conv.scope_provinces or []) or ([conv.province] if conv.province else [])
    if not provinces:
        return "es"
    return zone_language(data, {"kind": conv.scope_kind or "province", "provinces": provinces})


async def fill_languages(db: AsyncSession) -> None:
    """Communities made before they had an official language get their zone's. Commits."""
    from sqlalchemy import select
    from app.core.models import Conversation
    convs = (await db.execute(select(Conversation).where(Conversation.kind == "channel", Conversation.language.is_(None)))).scalars().all()
    if convs:
        data = await geo_data(db)
        for c in convs:
            c.language = default_language(data, c)
        await db.commit()


def scope_values(zone: dict) -> dict:
    """The columns of a channel for its zone."""
    return {"province": zone["key"], "scope_kind": zone["kind"], "scope_value": zone["value"], "scope_label": zone["label"],
            "scope_provinces": zone["provinces"]}
