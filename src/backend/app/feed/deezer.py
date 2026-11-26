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
async def hits(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """The songs of the moment in my country (its Deezer chart), or the world's."""
    if not await enabled(db):
        return []
    from app.communities.zones import country_of, geo_data
    country = country_of(await geo_data(db), user.province) if user.province else "ES"
    playlist = CHARTS.get(country)
    path = f"/playlist/{playlist}/tracks?limit=100" if playlist else "/chart/0/tracks?limit=100"
    data = await _get(path, f"dz:chart:{country}", 1800)
    return [x for x in (_track(d) for d in data.get("data", [])) if x]


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
