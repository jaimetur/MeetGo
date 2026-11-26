"""«Hits» for stories: the songs of the moment, from Deezer's public API: each country's chart (Deezer Charts) and a
search, as clips of 30 seconds that Deezer serves itself (MeetGo keeps no song). A clip's address expires, so a story
keeps the song's id and its address is asked for again when it plays (GET /music/deezer/<id>/play, a redirect).
The administration can turn it off (Administration → Music)."""

from __future__ import annotations

import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, require_admin
from app.core.i18n import t
from app.core.models import User
from app.core.redis_conn import get_redis

router = APIRouter(tags=["music"])
logger = logging.getLogger("meetgo.deezer")
API = "https://api.deezer.com"
SECTION = "music"
PREVIEW_SECONDS = 30
# Deezer Charts' «Top <country>» playlists; elsewhere, the world's chart
CHARTS = {"ES": 1116190041, "MX": 1111142361, "AR": 1279119721, "CO": 1116188451, "FR": 1109890291, "IT": 1116187241,
          "DE": 1111143121, "PT": 1362519755, "BR": 1111141961, "US": 1313621735, "NL": 1266971851, "BE": 1266968331,
          "CL": 1279119121, "PE": 1362518525}


WORLD = 3155776842  # Deezer Charts' «Top Worldwide»
GENRES = {"pop": 132, "latin": 197, "reggaeton": 122, "rap": 116, "dance": 113, "rock": 152, "rnb": 165, "electro": 106,
          "salsa": 67, "cumbia": 71, "kids": 95}
# Deezer Best Of's «Top Hits <year>», joined by decade
YEARS = {1971: 10780135542, 1972: 10778757682, 1973: 10775127922, 1974: 10764131542, 1975: 10761516262, 1976: 10757717782,
         1977: 10749728262, 1978: 10745975822, 1979: 10743157762, 1980: 10727755642, 1981: 10704004302, 1982: 10702272842,
         1983: 10701318182, 1984: 10699860242, 1985: 10698676702, 1986: 10685554042, 1987: 10684010922, 1988: 10678781122,
         1989: 10133312182, 1991: 9920509622, 1992: 9920680402, 1993: 9920803062, 1994: 9927915042, 1995: 9931111742,
         1996: 9941287122, 1997: 10385482422, 1998: 10423994242, 1999: 10660130722, 2000: 11837091441, 2001: 11837090081,
         2002: 11837088801, 2003: 11837087601, 2004: 11837085661, 2005: 11837082861, 2006: 11837078821, 2007: 11837077721,
         2008: 4091244662, 2009: 5361722742, 2010: 5339620562, 2011: 5313710582, 2012: 5311155022, 2013: 5310925582,
         2014: 5310662982, 2015: 5310238702, 2016: 5310088722, 2017: 3453772742, 2018: 5132762464, 2019: 1283499335,
         2020: 3185085222, 2021: 12345421311, 2022: 12345460211, 2023: 12345467671}
DECADES = ("70s", "80s", "90s", "00s", "10s", "20s")
LISTS = ("country", "world", *GENRES, *DECADES)


def _decade_years(key: str) -> list[int]:
    start = {"70s": 1970, "80s": 1980, "90s": 1990, "00s": 2000, "10s": 2010, "20s": 2020}[key]
    return [y for y in YEARS if start <= y < start + 10]


async def enabled(db: AsyncSession) -> bool:
    from app.core.app_settings import get_section
    return (await get_section(db, SECTION)).get("deezer", True) is not False


async def _get(path: str, cache_key: str, ttl: int) -> dict:
    redis = get_redis()
    try:
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception:
        cached = None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.get(API + path, headers={"User-Agent": "MeetGo"})
        data = res.json()
    except Exception:
        logger.warning("Deezer: no answer for %s", path)
        raise HTTPException(503, t("err_music_unavailable"))
    if isinstance(data, dict) and data.get("error"):
        raise HTTPException(404, t("err_music_not_found"))
    try:
        await redis.set(cache_key, json.dumps(data), ex=ttl)
    except Exception:
        pass
    return data


def _track(d: dict) -> dict | None:
    if not d.get("preview") or not d.get("readable", True):
        return None
    return {"id": f"dz{d['id']}", "source": "deezer", "deezer_id": d["id"], "kind": "hits", "title": d.get("title_short") or d.get("title"),
            "artist": (d.get("artist") or {}).get("name", ""), "cover": (d.get("album") or {}).get("cover_medium"),
            "link": d.get("link"), "url": f"/music/deezer/{d['id']}/play", "duration": PREVIEW_SECONDS, "explicit": bool(d.get("explicit_lyrics"))}


@router.get("/music/hits", response_model=list[dict])
async def hits(list: str = "country", db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """A list of hits: my country's chart (by default), the world's, one by genre or the hits of a decade."""
    if not await enabled(db):
        return []
    if list not in LISTS:
        raise HTTPException(400, t("err_music_invalid"))
    if list == "country":
        from app.communities.zones import country_of, geo_data
        country = country_of(await geo_data(db), user.province) if user.province else "ES"
        playlist = CHARTS.get(country)
        path = f"/playlist/{playlist}/tracks?limit=100" if playlist else "/chart/0/tracks?limit=100"
        rows = (await _get(path, f"dz:chart:{country}", 1800)).get("data", [])
    elif list == "world":
        rows = (await _get(f"/playlist/{WORLD}/tracks?limit=100", "dz:world", 1800)).get("data", [])
    elif list in GENRES:
        rows = (await _get(f"/chart/{GENRES[list]}/tracks?limit=100", f"dz:genre:{list}", 3600)).get("data", [])
    else:  # a decade: its years' lists, a few songs of each year in turn, so the whole decade shows
        per_year = [(await _get(f"/playlist/{YEARS[y]}/tracks?limit=60", f"dz:year:{y}", 86400)).get("data", []) for y in _decade_years(list)]
        rows = [songs[i] for i in range(max((len(x) for x in per_year), default=0)) for songs in per_year if i < len(songs)]
    seen: set[int] = set()
    out = []
    for d in rows:
        track = _track(d)
        if track and track["deezer_id"] not in seen:
            seen.add(track["deezer_id"])
            out.append(track)
    return out[:400]


@router.get("/music/search", response_model=list[dict])
async def search(q: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Any song, by its title or its artist."""
    q = q.strip()[:80]
    if not q or not await enabled(db):
        return []
    from urllib.parse import quote
    data = await _get(f"/search?q={quote(q)}&limit=40", f"dz:search:{q.lower()}", 600)
    return [x for x in (_track(d) for d in data.get("data", [])) if x]


@router.get("/music/deezer/{deezer_id}/play")
async def play(deezer_id: int, db: AsyncSession = Depends(get_db)):
    """The song's clip, now (its address lasts a while only): a redirect to Deezer's."""
    if not await enabled(db):
        raise HTTPException(404, t("err_music_not_found"))
    data = await _get(f"/track/{deezer_id}", f"dz:track:{deezer_id}", 1200)
    if not data.get("preview"):
        raise HTTPException(404, t("err_music_not_found"))
    return RedirectResponse(data["preview"], status_code=302, headers={"Cache-Control": "no-store"})


async def story_track(db: AsyncSession, value: dict) -> dict:
    """A story's Deezer song as stored: its id, where the 15 seconds start, and what to show of it."""
    data = await _get(f"/track/{int(value['deezer_id'])}", f"dz:track:{int(value['deezer_id'])}", 1200)
    track = _track(data)
    if not track:
        raise HTTPException(400, t("err_music_not_found"))
    from app.feed.music import STORY_SECONDS
    start = max(0, min(int(value.get("start") or 0), PREVIEW_SECONDS - STORY_SECONDS))
    return {"source": "deezer", "deezer_id": track["deezer_id"], "start": start, "title": track["title"], "artist": track["artist"],
            "cover": track["cover"], "link": track["link"]}


@router.get("/admin/music/settings", response_model=dict)
async def music_settings(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    return {"deezer": await enabled(db)}


@router.patch("/admin/music/settings", response_model=dict)
async def save_music_settings(payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    from app.core.app_settings import get_section, set_section
    section = await get_section(db, SECTION)
    if "deezer" in payload:
        section["deezer"] = bool(payload["deezer"])
    await set_section(db, SECTION, section)
    return {"deezer": section.get("deezer", True) is not False}
