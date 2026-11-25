"""Backups of MeetGo (Administration → Backups), as in DriveTest Analyzer's Backup Protection.

A backup is one ZIP in a folder of the data directory (DATA_DIR, the server's or the container's, not the browser's):
- manifest.json: when, full or light, made by hand, by the schedule or before a restore, the schema version, the content;
- database/<table>.csv: every table of the database, read in one consistent snapshot;
- files/...: the uploaded files (photos, attachments, voice notes, avatars), only in full backups.
A light backup is the database alone. Full backups go to <folder>/full and light ones to <folder>/light.

Restoring replaces, in the parts chosen, what this server has: the database's rows (table by table; columns added since
the backup take their defaults) and the files the backup has (others are kept). The backup settings of this server are
kept, and a light backup of the current database is made first, so a restore can be undone.

Scheduled backups: hourly, every 4 hours, daily, weekly or monthly, at a time of Madrid; with light backups (hourly,
every 4 hours, daily) the ones between the weekly full backup are light, and a missed full one is made at the next. After
each scheduled backup the retention keeps every scheduled backup of the last N days and, of the full ones, the newest
and the newest of each of the last weeks and months; backups made by hand or before a restore are never deleted.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import shutil
import tempfile
import time
import zipfile
from calendar import monthrange
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import text

from app.core.app_settings import get_section, set_section
from app.core.config import settings
from app.core.db import SessionLocal, engine

logger = logging.getLogger(__name__)

TZ = ZoneInfo("Europe/Madrid")
FORMAT = 1
LOW_DISK = 5 * 1024 ** 3  # less free space than this shows the disk in red
SKIP_TABLES = {"alembic_version"}
KEEP_SECTIONS = ("backups", "backup_state")  # this server's backup settings survive a restore
COMPONENTS = ("database", "files")
RECURRENCES = ("hourly", "every_4_hours", "daily", "weekly", "monthly")
LEVELS = ("full", "light")


def root() -> Path:
    return Path(settings.DATA_DIR).resolve()


def default_folder() -> Path:
    return root() / "backups"


DEFAULTS = {
    "enabled": False, "recurrence": "daily", "weekly_day": 0, "monthly_day": 1, "execution_time": "03:30",
    "light_backups": False, "full_backup_day": 0, "keep_days": 7, "keep_weeks": 4, "keep_months": 6,
    "components": list(COMPONENTS), "backup_path": "",
}


# ---------- settings and paths ----------

async def get_config(db) -> dict:
    cfg = {**DEFAULTS, **(await get_section(db, "backups"))}
    cfg["backup_path"] = cfg.get("backup_path") or str(default_folder())
    return cfg


async def get_state(db) -> dict:
    return await get_section(db, "backup_state")


async def save_state(db, **changes) -> None:
    state = await get_state(db)
    state.update(changes)
    await set_section(db, "backup_state", state)


def inside(path: str | Path) -> Path:
    """A folder of the data directory (nothing outside it can be read or written)."""
    p = Path(path).expanduser()
    p = (p if p.is_absolute() else root() / p).resolve()
    if p != root() and root() not in p.parents:
        raise ValueError("outside")
    return p


def backup_file(folder: str | Path, name: str) -> Path:
    """A backup ZIP of the folder (its full or light subfolder, or the folder itself)."""
    f = inside(folder)
    p = inside(f / name)
    if p.suffix != ".zip" or not p.is_file() or f not in p.parents:
        raise ValueError("no file")
    return p


def list_dirs(path: str | Path) -> dict:
    p = inside(path)
    p.mkdir(parents=True, exist_ok=True)
    dirs = sorted((d.name for d in p.iterdir() if d.is_dir() and not d.name.startswith(".")), key=str.lower)
    return {"path": str(p), "root": str(root()), "parent": str(p.parent) if p != root() else None, "dirs": dirs}


# ---------- what is in a folder ----------

def _origin(name: str) -> str:
    for o in ("manual", "scheduled", "prerestore"):
        if f"-{o}" in name:
            return o
    return "scheduled"  # copied or made before backups said who made them


def _when(p: Path) -> datetime:
    # meetgo-<level>-YYYYmmdd-HHMMSS-<origin>.zip, or the file's time
    parts = p.stem.split("-")
    try:
        return datetime.strptime(parts[2] + parts[3], "%Y%m%d%H%M%S").replace(tzinfo=TZ)
    except (IndexError, ValueError):
        return datetime.fromtimestamp(p.stat().st_mtime, TZ)


def list_backups(folder: str | Path) -> list[dict]:
    """The ZIPs of <folder>/full, <folder>/light and the folder itself (those count as full), newest first."""
    f = inside(folder)
    out = []
    for level, d in (("full", f / "full"), ("light", f / "light"), ("full", f)):
        if not d.is_dir():
            continue
        for p in d.glob("*.zip"):
            st = p.stat()
            out.append({"name": str(p.relative_to(f)), "level": level, "origin": _origin(p.name), "size": st.st_size,
                        "created_at": _when(p).isoformat()})
    out.sort(key=lambda b: b["created_at"], reverse=True)
    return out


def disk(folder: str | Path) -> dict:
    p = inside(folder)
    while not p.exists():
        p = p.parent
    u = shutil.disk_usage(p)
    return {"free": u.free, "total": u.total, "used": u.used, "low": u.free < LOW_DISK}


# ---------- the schedule ----------

def _hm(cfg: dict) -> tuple[int, int]:
    try:
        h, m = (int(x) for x in str(cfg.get("execution_time") or "03:30").split(":")[:2])
        return max(0, min(23, h)), max(0, min(59, m))
    except ValueError:
        return 3, 30


def next_run(cfg: dict, after: datetime) -> datetime | None:
    """The first scheduled time after `after` (Madrid time), or None when the schedule is off."""
    if not cfg.get("enabled"):
        return None
    after = after.astimezone(TZ)
    h, m = _hm(cfg)
    rec = cfg.get("recurrence")
    day = after.replace(second=0, microsecond=0)
    if rec == "hourly":
        c = day.replace(minute=m)
        return c if c > after else c + timedelta(hours=1)
    if rec == "every_4_hours":
        for i in range(0, 30):
            c = (day + timedelta(hours=i)).replace(minute=m)
            if c > after and (c.hour - h) % 4 == 0:
                return c
    for i in range(0, 400):
        d = (after + timedelta(days=i)).date()
        if rec == "weekly" and d.weekday() != int(cfg.get("weekly_day", 0)):
            continue
        if rec == "monthly" and d.day != min(int(cfg.get("monthly_day", 1)), monthrange(d.year, d.month)[1]):
            continue
        c = datetime(d.year, d.month, d.day, h, m, tzinfo=TZ)
        if c > after:
            return c
    return None


def light_schedule(cfg: dict) -> bool:
    return bool(cfg.get("light_backups")) and cfg.get("recurrence") in ("hourly", "every_4_hours", "daily")


def scheduled_level(cfg: dict, backups: list[dict], now: datetime) -> str:
    """Full, unless light backups are on and this week's full backup (from its day) was already made."""
    if not light_schedule(cfg):
        return "full"
    today = now.astimezone(TZ).date()
    since = today - timedelta(days=(today.weekday() - int(cfg.get("full_backup_day", 0))) % 7)
    for b in backups:
        if b["level"] == "full" and b["origin"] == "scheduled" and datetime.fromisoformat(b["created_at"]).date() >= since:
            return "light"
    return "full"


def retention(cfg: dict, backups: list[dict], now: datetime) -> list[dict]:
    """The scheduled backups to delete: kept are those of the last keep_days days (today included) and, of the full ones,
    the newest and the newest of each of the last keep_weeks weeks and keep_months months."""
    today = now.astimezone(TZ).date()
    sched = [b for b in backups if b["origin"] == "scheduled"]
    keep: set[str] = set()
    first_day = today - timedelta(days=max(1, int(cfg.get("keep_days", 7))) - 1)
    for b in sched:
        if datetime.fromisoformat(b["created_at"]).date() >= first_day:
            keep.add(b["name"])
    full = sorted((b for b in sched if b["level"] == "full"), key=lambda b: b["created_at"], reverse=True)
    if full:
        keep.add(full[0]["name"])
    weeks = {(today - timedelta(weeks=i)).isocalendar()[:2] for i in range(int(cfg.get("keep_weeks", 4)))}
    months, y, mth = set(), today.year, today.month
    for _ in range(int(cfg.get("keep_months", 6))):
        months.add((y, mth))
        y, mth = (y, mth - 1) if mth > 1 else (y - 1, 12)
    seen_w, seen_m = set(), set()
    for b in full:  # newest first: the first of each week or month is its newest
        d = datetime.fromisoformat(b["created_at"]).date()
        w, mo = d.isocalendar()[:2], (d.year, d.month)
        if w in weeks and w not in seen_w:
            seen_w.add(w)
            keep.add(b["name"])
        if mo in months and mo not in seen_m:
            seen_m.add(mo)
            keep.add(b["name"])
    return [b for b in sched if b["name"] not in keep]


# ---------- tasks (one backup or restore at a time) ----------

@dataclass
class Task:
    id: str
    kind: str  # backup | restore
    state: str = "running"  # running | done | error
    step: str = ""
    progress: float = 0.0
    message: str = ""
    file: str = ""
    started: float = field(default_factory=time.time)

    def out(self) -> dict:
        return {"id": self.id, "kind": self.kind, "state": self.state, "step": self.step,
                "progress": round(self.progress, 3), "message": self.message, "file": self.file}


_lock = asyncio.Lock()
_tasks: dict[str, Task] = {}
_running: set[asyncio.Task] = set()


def current_task() -> Task | None:
    live = [t for t in _tasks.values() if t.state == "running"]
    if live:
        return live[0]
    done = sorted(_tasks.values(), key=lambda t: t.started, reverse=True)
    return done[0] if done and time.time() - done[0].started < 600 else None


def get_task(task_id: str) -> Task | None:
    return _tasks.get(task_id)


def busy() -> bool:
    return _lock.locked()


def start(kind: str, coro_factory) -> Task:
    t = Task(id=os.urandom(6).hex(), kind=kind)
    _tasks[t.id] = t

    async def run():
        async with _lock:
            try:
                await coro_factory(t)
                t.state, t.progress = "done", 1.0
            except Exception as e:  # noqa: BLE001
                logger.exception("Backup task %s failed", kind)
                t.state, t.message = "error", str(e) or e.__class__.__name__

    task = asyncio.create_task(run())
    _running.add(task)
    task.add_done_callback(_running.discard)
    return t


# ---------- making a backup ----------

async def _tables(conn) -> list[str]:
    rows = await conn.fetch("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' "
                            "AND table_type = 'BASE TABLE' ORDER BY table_name")
    return [r["table_name"] for r in rows if r["table_name"] not in SKIP_TABLES]


def _upload_files(skip: list[Path]) -> list[Path]:
    """The uploaded files of the data directory, without the backup folders."""
    skip = [x.resolve() for x in skip]

    def skipped(d: Path) -> bool:
        d = d.resolve()
        return any(d == x or x in d.parents for x in skip)

    out = []
    for dirpath, dirnames, filenames in os.walk(root()):
        here = Path(dirpath)
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and not skipped(here / d)]
        out += [here / f for f in filenames if not f.startswith(".") and not f.endswith(".partial")]
    return out


async def estimate(level: str, components: list[str], folder: Path) -> int:
    """Bytes a backup needs: the latest one of the same level, else the database's size and the files'."""
    same = [b for b in list_backups(folder) if b["level"] == level]
    if same:
        return int(same[0]["size"] * 1.2) + 50 * 1024 ** 2
    total = 0
    if "database" in components:
        async with SessionLocal() as db:
            total += int((await db.execute(text("SELECT pg_database_size(current_database())"))).scalar() or 0)
    if level == "full" and "files" in components:
        total += sum(p.stat().st_size for p in await asyncio.to_thread(_upload_files, [folder]))
    return total + 50 * 1024 ** 2


async def make_backup(t: Task, *, level: str, origin: str, components: list[str], folder: str | Path, by: str = "") -> Path:
    folder = inside(folder)
    if level == "light":
        components = [c for c in components if c != "files"]
    if not components:
        raise ValueError("nothing to back up")
    dest = folder / level
    dest.mkdir(parents=True, exist_ok=True)
    for leftover in dest.glob("*.partial"):  # what an interrupted backup left
        leftover.unlink(missing_ok=True)
    need = await estimate(level, components, folder)
    if shutil.disk_usage(dest).free < need:
        raise OSError(f"Not enough free space in {dest}: about {need // 1024 ** 2} MB are needed")
    now = datetime.now(TZ)
    name = f"meetgo-{level}-{now:%Y%m%d-%H%M%S}-{origin}.zip"
    partial = dest / (name + ".partial")
    manifest = {"app": "MeetGo", "format": FORMAT, "created_at": now.isoformat(), "level": level, "origin": origin,
                "by": by, "components": components, "tables": {}, "files": 0}
    t.step, t.file = "database", str((dest / name).relative_to(folder))
    try:
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as z:
            if "database" in components:
                async with engine.connect() as c:
                    raw = (await c.get_raw_connection()).driver_connection
                    async with raw.transaction(isolation="repeatable_read", readonly=True):
                        manifest["alembic"] = await raw.fetchval("SELECT version_num FROM alembic_version")
                        tables = await _tables(raw)
                        with tempfile.TemporaryDirectory(dir=dest) as tmp:
                            for i, table in enumerate(tables):
                                path = Path(tmp) / f"{table}.csv"
                                await raw.copy_from_table(table, output=str(path), format="csv", header=True)
                                manifest["tables"][table] = path.stat().st_size
                                await asyncio.to_thread(z.write, path, f"database/{table}.csv")
                                path.unlink()
                                t.progress = 0.6 * (i + 1) / max(1, len(tables)) if "files" in components else (i + 1) / max(1, len(tables))
            if "files" in components:
                t.step = "files"
                files = await asyncio.to_thread(_upload_files, [folder, inside(default_folder())])

                def add_files():
                    for i, p in enumerate(files):
                        z.write(p, "files/" + str(p.relative_to(root())))
                        t.progress = 0.6 + 0.4 * (i + 1) / max(1, len(files))
                await asyncio.to_thread(add_files)
                manifest["files"] = len(files)
            z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        final = dest / name
        partial.replace(final)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    async with SessionLocal() as db:
        await save_state(db, last_success=now.isoformat(), last_level=level, last_size=final.stat().st_size, problem=None)
    t.message = final.name
    return final


# ---------- restoring ----------

def read_manifest(path: Path) -> dict:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        try:
            m = json.loads(z.read("manifest.json"))
        except KeyError:
            m = {"level": "full" if any(n.startswith("files/") for n in names) else "light"}
        m["has_database"] = any(n.startswith("database/") for n in names)
        m["has_files"] = any(n.startswith("files/") for n in names)
        m["file_count"] = sum(1 for n in names if n.startswith("files/") and not n.endswith("/"))
        m["table_count"] = sum(1 for n in names if n.startswith("database/") and n.endswith(".csv"))
    return m


async def _restore_database(t: Task, z: zipfile.ZipFile) -> None:
    async with SessionLocal() as db:
        kept = {k: await get_section(db, k) for k in KEEP_SECTIONS}
    entries = [n for n in z.namelist() if n.startswith("database/") and n.endswith(".csv")]
    async with engine.connect() as c:
        raw = (await c.get_raw_connection()).driver_connection
        async with raw.transaction():
            await raw.execute("SET LOCAL session_replication_role = replica")  # no foreign keys or triggers while loading
            current = await _tables(raw)
            if current:
                await raw.execute("TRUNCATE " + ", ".join(f'"{x}"' for x in current) + " CASCADE")
            cols_of = {}
            for r in await raw.fetch("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"):
                cols_of.setdefault(r["table_name"], set()).add(r["column_name"])
            with tempfile.TemporaryDirectory() as tmp:
                for i, entry in enumerate(entries):
                    table = entry[len("database/"):-4]
                    t.progress = 0.8 * i / max(1, len(entries))
                    if table not in current:
                        continue  # a table this version no longer has
                    path = Path(tmp) / "t.csv"

                    def extract() -> list[str]:
                        # only the columns this version has (those added since the backup take their defaults)
                        with z.open(entry) as src, open(path, "w", newline="", encoding="utf-8") as dst:
                            reader = csv.reader(io.TextIOWrapper(src, encoding="utf-8", newline=""))
                            header = next(reader, [])
                            idx = [k for k, col in enumerate(header) if col in cols_of.get(table, set())]
                            writer = csv.writer(dst)
                            writer.writerow([header[k] for k in idx])
                            for row in reader:
                                writer.writerow([row[k] for k in idx])
                            return [header[k] for k in idx]
                    columns = await asyncio.to_thread(extract)
                    if columns:
                        await raw.copy_to_table(table, source=str(path), columns=columns, format="csv", header=True)
            # sequences continue after the restored ids
            for r in await raw.fetch("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' "
                                     "AND column_default LIKE 'nextval(%'"):
                await raw.execute(
                    f"SELECT setval(pg_get_serial_sequence('\"{r['table_name']}\"', '{r['column_name']}'), "
                    f"COALESCE((SELECT max(\"{r['column_name']}\") FROM \"{r['table_name']}\"), 1), "
                    f"(SELECT max(\"{r['column_name']}\") FROM \"{r['table_name']}\") IS NOT NULL)")
    async with SessionLocal() as db:
        for k, v in kept.items():
            await set_section(db, k, v)


def _restore_files(t: Task, z: zipfile.ZipFile) -> int:
    names = [n for n in z.namelist() if n.startswith("files/") and not n.endswith("/")]
    base = root()
    for i, n in enumerate(names):
        target = (base / n[len("files/"):]).resolve()
        if base not in target.parents:
            continue  # never outside the data directory
        target.parent.mkdir(parents=True, exist_ok=True)
        with z.open(n) as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst)
        t.progress = 0.8 + 0.2 * (i + 1) / max(1, len(names))
    return len(names)


async def restore(t: Task, *, path: Path, parts: list[str], folder: str | Path, by: str = "") -> None:
    # first, a light backup of what there is now: the restore can be undone
    t.step = "safety"
    if "database" in parts:
        await make_backup(Task(id="pre", kind="backup"), level="light", origin="prerestore", components=["database"], folder=folder, by=by)
    with zipfile.ZipFile(path) as z:
        if "database" in parts:
            t.step = "database"
            await _restore_database(t, z)
        if "files" in parts:
            t.step = "files"
            await asyncio.to_thread(_restore_files, t, z)
    try:  # what was cached for the old data (members, presence) goes
        from app.core.redis_conn import get_redis
        await get_redis().flushdb()
    except Exception:  # noqa: BLE001
        logger.warning("Could not clear Redis after the restore")
    t.message = path.name


# ---------- downloads ----------

def download_token(name: str, folder: str, minutes: int = 10) -> str:
    exp = int(time.time()) + minutes * 60
    payload = f"{folder}|{name}|{exp}"
    sig = hmac.new(settings.JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{exp}.{sig}"


def check_download(name: str, folder: str, token: str) -> bool:
    try:
        exp, sig = token.split(".", 1)
        if int(exp) < time.time():
            return False
    except ValueError:
        return False
    good = hmac.new(settings.JWT_SECRET.encode(), f"{folder}|{name}|{exp}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(good, sig)


# ---------- the scheduler ----------

_loop_task: asyncio.Task | None = None


async def scheduled_once(now: datetime | None = None) -> bool:
    """Makes the scheduled backup when it is due (and then applies the retention). True when one was made."""
    now = now or datetime.now(TZ)
    async with SessionLocal() as db:
        cfg = await get_config(db)
        state = await get_state(db)
    if not cfg.get("enabled") or busy():
        return False
    since = datetime.fromisoformat(state["last_scheduled_at"]) if state.get("last_scheduled_at") else \
        datetime.fromisoformat(state.get("enabled_at") or now.isoformat())
    due = next_run(cfg, since)
    if not due or now < due:
        return False
    folder = cfg["backup_path"]
    async with SessionLocal() as db:
        await save_state(db, last_scheduled_at=now.isoformat())
    level = scheduled_level(cfg, list_backups(folder), now)
    t = Task(id=os.urandom(6).hex(), kind="backup")
    _tasks[t.id] = t
    async with _lock:
        try:
            try:
                await make_backup(t, level=level, origin="scheduled", components=list(cfg.get("components") or COMPONENTS), folder=folder)
            except OSError as e:
                if level == "full" and light_schedule(cfg):  # no room for the full one: a light one instead
                    await make_backup(t, level="light", origin="scheduled", components=list(cfg.get("components") or COMPONENTS), folder=folder)
                    async with SessionLocal() as db:
                        await save_state(db, problem=str(e))
                else:
                    raise
            t.state, t.progress = "done", 1.0
        except Exception as e:  # noqa: BLE001
            t.state, t.message = "error", str(e)
            logger.exception("Scheduled backup failed")
            async with SessionLocal() as db:
                await save_state(db, problem=str(e))
            return False
    for b in retention(cfg, list_backups(folder), now):
        try:
            (inside(folder) / b["name"]).unlink(missing_ok=True)
            logger.info("Backup retention: deleted %s", b["name"])
        except OSError:
            logger.warning("Backup retention: could not delete %s", b["name"])
    return True


async def _loop() -> None:
    while True:
        await asyncio.sleep(30)
        try:
            from app.core.redis_conn import get_redis
            if not await get_redis().set("backups:loop", "1", nx=True, ex=25):  # several API processes: one at a time
                continue
            await scheduled_once()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Backup scheduler round failed")


def start_scheduler() -> None:
    global _loop_task
    if _loop_task is None:
        _loop_task = asyncio.create_task(_loop())


async def stop_scheduler() -> None:
    global _loop_task
    if _loop_task:
        _loop_task.cancel()
        try:
            await _loop_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        _loop_task = None

