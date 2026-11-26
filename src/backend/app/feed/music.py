"""The music of stories: famous works in free recordings (public domain or Creative Commons, with their author and
licence) and MeetGo's own music by mood, built in (app/feed/music: the files and catalog.json); and the songs the
administration uploads. GET /music lists them, GET /music/files/<name> serves one."""

from __future__ import annotations

import json
import re
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db, require_admin
from app.core.i18n import t
from app.core.models import MusicTrack, User, utcnow
from app.messaging.storage import uploads_dir

router = APIRouter(tags=["music"])
BUILTIN_DIR = Path(__file__).resolve().parent / "music"
MOODS = ("happy", "chill", "romantic", "epic", "sad", "energetic", "mysterious", "party", "dreamy", "summer")
NAME_RE = re.compile(r"^[a-z0-9_-]{1,80}\.(m4a|mp3|ogg|wav)$")
MAX_BYTES = 20 * 1024 * 1024
STORY_SECONDS = 15  # how much of a song a story plays


def _uploaded_dir() -> Path:
    d = uploads_dir() / "music"
    d.mkdir(parents=True, exist_ok=True)
    return d


async def ensure_music(db: AsyncSession) -> None:
    """The built-in songs are in the library (at startup); what the administration changed of them is kept."""
    path = BUILTIN_DIR / "catalog.json"
    if not path.exists():
        return
    have = set((await db.execute(select(MusicTrack.key))).scalars().all())
    for i, item in enumerate(json.loads(path.read_text(encoding="utf-8"))):
        if item["key"] in have or not (BUILTIN_DIR / item["file"]).exists():
            continue
        db.add(MusicTrack(key=item["key"], kind=item.get("kind", "classic"), mood=item.get("mood"), title=item["title"],
                          artist=item.get("artist", ""), performer=item.get("performer", ""), file=item["file"],
                          duration=int(item.get("duration") or 30), license=item.get("license", ""),
                          license_url=item.get("license_url"), source_url=item.get("source_url"), builtin=True,
                          position=i * 10, created_at=utcnow()))
    await db.commit()


def track_out(m: MusicTrack, admin: bool = False) -> dict:
    out = {"id": m.id, "kind": m.kind, "mood": m.mood, "title": m.title, "artist": m.artist, "performer": m.performer,
           "url": f"/music/files/{m.file}", "duration": m.duration, "license": m.license, "license_url": m.license_url,
           "source_url": m.source_url}
    if admin:
        out.update(builtin=m.builtin, active=m.active, key=m.key)
    return out


@router.get("/music", response_model=list[dict])
async def music(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """The songs to choose for a story: famous ones first (classic), then MeetGo's by mood."""
    rows = (await db.execute(select(MusicTrack).where(MusicTrack.active.is_(True)).order_by(MusicTrack.kind, MusicTrack.position, MusicTrack.id))).scalars().all()
    return [track_out(m) for m in rows]


@router.get("/music/files/{name}")
async def music_file(name: str):
    if not NAME_RE.match(name):
        raise HTTPException(404, t("err_file_not_found"))
    path = BUILTIN_DIR / name
    if not path.exists():
        path = _uploaded_dir() / name
    if not path.exists():
        raise HTTPException(404, t("err_file_not_found"))
    media = {"m4a": "audio/mp4", "mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav"}[name.rsplit(".", 1)[1]]
    return FileResponse(path, media_type=media, headers={"Cache-Control": "public, max-age=2592000"})


async def story_music(db: AsyncSession, value: dict | None) -> dict | None:
    """A story's song as stored: {id, start} of an active song, the start within it."""
    if not value or not value.get("id"):
        return None
    track = await db.get(MusicTrack, int(value["id"]))
    if not track or not track.active:
        raise HTTPException(400, t("err_music_not_found"))
    start = max(0, min(int(value.get("start") or 0), max(0, track.duration - STORY_SECONDS)))
    return {"id": track.id, "start": start}


# ---------- administration ----------

@router.get("/admin/music", response_model=list[dict])
async def admin_music(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    rows = (await db.execute(select(MusicTrack).order_by(MusicTrack.kind, MusicTrack.position, MusicTrack.id))).scalars().all()
    return [track_out(m, admin=True) for m in rows]


@router.post("/admin/music", response_model=dict)
async def add_music(file: UploadFile = File(...), title: str = Form(..., max_length=160), artist: str = Form("", max_length=160),
                    kind: str = Form("classic"), mood: str | None = Form(None), license: str = Form("", max_length=64),
                    source_url: str | None = Form(None), db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """A song uploaded by the administration (MP3, M4A, OGG or WAV), cut to its first minute."""
    import subprocess
    import tempfile
    if kind not in ("classic", "mood") or (mood and mood not in MOODS):
        raise HTTPException(400, t("err_music_invalid"))
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, t("err_file_too_big"))
    name = f"up_{secrets.token_hex(8)}.m4a"
    with tempfile.NamedTemporaryFile(suffix=Path(file.filename or "x.mp3").suffix or ".mp3") as tmp:
        tmp.write(data)
        tmp.flush()
        done = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-t", "60", "-vn", "-c:a", "aac", "-b:a", "128k",
                               str(_uploaded_dir() / name)], capture_output=True, timeout=120)
    if done.returncode:
        raise HTTPException(400, t("err_music_invalid"))
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(_uploaded_dir() / name)],
                           capture_output=True, text=True, timeout=30)
    try:
        duration = int(float(probe.stdout.strip() or 30))
    except ValueError:
        duration = 30
    track = MusicTrack(key=f"up_{secrets.token_hex(6)}", kind=kind, mood=mood if kind == "mood" else None, title=title.strip(),
                       artist=artist.strip(), file=name, duration=duration, license=license.strip(),
                       source_url=(source_url or "").strip() or None, builtin=False, position=900, created_at=utcnow())
    db.add(track)
    await db.commit()
    return track_out(track, admin=True)


@router.patch("/admin/music/{track_id}", response_model=dict)
async def edit_music(track_id: int, payload: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    track = await db.get(MusicTrack, track_id)
    if not track:
        raise HTTPException(404, t("err_music_not_found"))
    if "active" in payload:
        track.active = bool(payload["active"])
    for key in ("title", "artist", "license"):
        if isinstance(payload.get(key), str) and payload[key].strip():
            setattr(track, key, payload[key].strip()[:160])
    await db.commit()
    return track_out(track, admin=True)


@router.delete("/admin/music/{track_id}", response_model=dict)
async def delete_music(track_id: int, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """An uploaded song goes for good; a built-in one can only be hidden."""
    track = await db.get(MusicTrack, track_id)
    if not track:
        raise HTTPException(404, t("err_music_not_found"))
    if track.builtin:
        raise HTTPException(400, t("err_music_builtin"))
    (_uploaded_dir() / track.file).unlink(missing_ok=True)
    await db.delete(track)
    await db.commit()
    return {"ok": True}
