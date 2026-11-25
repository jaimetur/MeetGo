"""Administration → Backups: the status, back up now, restore, the schedule and the backup folders (see service.py)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.backups import service as bk
from app.core.app_settings import set_section
from app.core.deps import get_db, require_admin
from app.core.models import User

router = APIRouter(prefix="/admin/backups", tags=["admin"])


class SettingsIn(BaseModel):
    enabled: bool = False
    recurrence: str = Field(default="daily", pattern="^(hourly|every_4_hours|daily|weekly|monthly)$")
    weekly_day: int = Field(default=0, ge=0, le=6)
    monthly_day: int = Field(default=1, ge=1, le=31)
    execution_time: str = Field(default="03:30", pattern=r"^\d{2}:\d{2}$")
    light_backups: bool = False
    full_backup_day: int = Field(default=0, ge=0, le=6)
    keep_days: int = Field(default=7, ge=1, le=3650)
    keep_weeks: int = Field(default=4, ge=0, le=520)
    keep_months: int = Field(default=6, ge=0, le=240)
    components: list[str] = Field(default_factory=lambda: list(bk.COMPONENTS))
    backup_path: str = ""


class RunIn(BaseModel):
    level: str = Field(pattern="^(full|light)$")


class FileIn(BaseModel):
    path: str
    name: str


class RestoreIn(FileIn):
    parts: list[str] = Field(default_factory=list)


class DirIn(BaseModel):
    path: str
    name: str = Field(min_length=1, max_length=80)


def _folder(path: str) -> str:
    try:
        return str(bk.inside(path or bk.default_folder()))
    except ValueError:
        raise HTTPException(400, "The folder must be inside the data directory")


def _file(path: str, name: str):
    try:
        return bk.backup_file(_folder(path), name)
    except ValueError:
        raise HTTPException(404, "Backup not found")


async def _status(db: AsyncSession) -> dict:
    cfg = await bk.get_config(db)
    state = await bk.get_state(db)
    backups = bk.list_backups(cfg["backup_path"])
    by = {lvl: [b for b in backups if b["level"] == lvl] for lvl in bk.LEVELS}
    since = state.get("last_scheduled_at") or state.get("enabled_at")
    nxt = bk.next_run(cfg, datetime.fromisoformat(since)) if since and cfg.get("enabled") else bk.next_run(cfg, datetime.now(bk.TZ))
    task = bk.current_task()
    return {
        "settings": cfg,
        "root": str(bk.root()),
        "default_path": str(bk.default_folder()),
        "status": {
            "count": len(backups), "size": sum(b["size"] for b in backups),
            "count_full": len(by["full"]), "count_light": len(by["light"]),
            "size_full": sum(b["size"] for b in by["full"]), "size_light": sum(b["size"] for b in by["light"]),
            "latest_full": by["full"][0]["size"] if by["full"] else None, "latest_light": by["light"][0]["size"] if by["light"] else None,
            "disk": bk.disk(cfg["backup_path"]),
            "last_success": state.get("last_success"), "last_level": state.get("last_level"),
            "next_run": nxt.isoformat() if nxt else None,
            "next_level": (bk.scheduled_level(cfg, backups, nxt) if nxt else None),
            "problem": state.get("problem"),
        },
        "backups": backups,
        "task": task.out() if task else None,
    }


@router.get("", response_model=dict)
async def status(db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    return await _status(db)


@router.put("/settings", response_model=dict)
async def save_settings(payload: SettingsIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """The schedule, the content and the folder of the next backups (scheduled ones included)."""
    data = payload.model_dump()
    data["components"] = [c for c in data["components"] if c in bk.COMPONENTS] or list(bk.COMPONENTS)
    data["backup_path"] = _folder(data["backup_path"])
    before = await bk.get_config(db)
    await set_section(db, "backups", data)
    if data["enabled"] and not before.get("enabled"):  # the schedule counts from now, not from the last backup made
        await bk.save_state(db, enabled_at=datetime.now(bk.TZ).isoformat(), last_scheduled_at=None)
    return await _status(db)


@router.get("/files", response_model=list[dict])
async def files(path: str = "", admin: User = Depends(require_admin)):
    return bk.list_backups(_folder(path))


@router.get("/dirs", response_model=dict)
async def dirs(path: str = "", admin: User = Depends(require_admin)):
    try:
        return bk.list_dirs(_folder(path))
    except OSError as e:
        raise HTTPException(400, str(e))


@router.post("/dirs", response_model=dict)
async def new_dir(payload: DirIn, admin: User = Depends(require_admin)):
    name = payload.name.strip().replace("/", "").replace("\\", "")
    if not name or name.startswith("."):
        raise HTTPException(400, "Invalid folder name")
    target = bk.inside(_folder(payload.path)) / name
    target.mkdir(parents=True, exist_ok=True)
    return bk.list_dirs(target)


@router.post("/run", response_model=dict)
async def run(payload: RunIn, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Back up now (full or light), with the content and folder saved in the settings."""
    if bk.busy():
        raise HTTPException(409, "A backup or restore is already running")
    cfg = await bk.get_config(db)
    components = list(cfg.get("components") or bk.COMPONENTS)
    if payload.level == "light" and components == ["files"]:
        raise HTTPException(400, "A light backup leaves the files out: choose the database too")
    t = bk.start("backup", lambda t: bk.make_backup(t, level=payload.level, origin="manual", components=components,
                                                      folder=cfg["backup_path"], by=admin.display_name))
    return t.out()


@router.get("/task/{task_id}", response_model=dict)
async def task(task_id: str, admin: User = Depends(require_admin)):
    t = bk.get_task(task_id)
    if not t:
        raise HTTPException(404, "No such task")
    return t.out()


@router.post("/inspect", response_model=dict)
async def inspect(payload: FileIn, admin: User = Depends(require_admin)):
    """What a backup holds, to choose the parts to restore."""
    try:
        return bk.read_manifest(_file(payload.path, payload.name))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Unreadable backup: {e}")


@router.post("/restore", response_model=dict)
async def restore(payload: RestoreIn, admin: User = Depends(require_admin)):
    parts = [p for p in payload.parts if p in bk.COMPONENTS]
    if not parts:
        raise HTTPException(400, "Choose what to restore")
    if bk.busy():
        raise HTTPException(409, "A backup or restore is already running")
    path = _file(payload.path, payload.name)
    folder = _folder(payload.path)
    t = bk.start("restore", lambda t: bk.restore(t, path=path, parts=parts, folder=folder, by=admin.display_name))
    return t.out()


@router.post("/download-link", response_model=dict)
async def download_link(payload: FileIn, admin: User = Depends(require_admin)):
    """A link valid 10 minutes to download a backup in the browser."""
    _file(payload.path, payload.name)
    folder = _folder(payload.path)
    return {"token": bk.download_token(payload.name, folder)}


@router.get("/download")
async def download(path: str, name: str, token: str):
    folder = _folder(path)
    if not bk.check_download(name, folder, token):
        raise HTTPException(403, "Expired link")
    p = _file(path, name)
    return FileResponse(p, media_type="application/zip", filename=p.name)


@router.post("/delete", response_model=dict)
async def delete(payload: FileIn, admin: User = Depends(require_admin)):
    if bk.busy():
        raise HTTPException(409, "A backup or restore is running")
    _file(payload.path, payload.name).unlink()
    return {"ok": True}
