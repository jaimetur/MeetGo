"""Backups (Administration → Backups): the schedule and its retention, backing up and restoring."""

import asyncio
from datetime import datetime, timedelta
from pathlib import Path

from app.backups import service as bk
from tests.helpers import admin_headers, make_user

TZ = bk.TZ


def test_next_run_for_each_recurrence():
    after = datetime(2026, 11, 25, 10, 15, tzinfo=TZ)  # a Wednesday
    base = {"enabled": True, "execution_time": "03:30"}
    assert bk.next_run({**base, "recurrence": "hourly"}, after) == datetime(2026, 11, 25, 10, 30, tzinfo=TZ)
    assert bk.next_run({**base, "recurrence": "every_4_hours"}, after) == datetime(2026, 11, 25, 11, 30, tzinfo=TZ)
    assert bk.next_run({**base, "recurrence": "daily"}, after) == datetime(2026, 11, 26, 3, 30, tzinfo=TZ)
    assert bk.next_run({**base, "recurrence": "weekly", "weekly_day": 0}, after) == datetime(2026, 11, 30, 3, 30, tzinfo=TZ)
    assert bk.next_run({**base, "recurrence": "monthly", "monthly_day": 31}, after) == datetime(2026, 11, 30, 3, 30, tzinfo=TZ)
    assert bk.next_run({**base, "enabled": False, "recurrence": "daily"}, after) is None


def _b(day: datetime, level="full", origin="scheduled"):
    return {"name": f"{level}/{day:%Y%m%d}-{origin}.zip", "level": level, "origin": origin, "size": 1, "created_at": day.isoformat()}


def test_retention_keeps_days_weeks_months_and_manual_ones():
    now = datetime(2026, 11, 25, 12, 0, tzinfo=TZ)
    backups = [_b(now - timedelta(days=d)) for d in range(0, 200)] + [_b(now - timedelta(days=300), origin="manual")]
    cfg = {"keep_days": 7, "keep_weeks": 4, "keep_months": 6}
    deleted = {b["name"] for b in bk.retention(cfg, backups, now)}
    kept = [b for b in backups if b["name"] not in deleted]
    assert all(b["origin"] == "scheduled" for b in backups if b["name"] in deleted)  # the manual one stays
    assert sum(1 for b in kept if b["origin"] == "scheduled" and (now - datetime.fromisoformat(b["created_at"])).days < 7) == 7
    assert len(kept) <= 7 + 4 + 6 + 1 and len(kept) >= 7 + 3


def test_light_schedule_makes_the_weekly_full_one_first():
    now = datetime(2026, 11, 25, 3, 30, tzinfo=TZ)  # Wednesday
    cfg = {"recurrence": "daily", "light_backups": True, "full_backup_day": 0}  # full on Mondays
    assert bk.scheduled_level(cfg, [], now) == "full"  # this week's full one is missing
    monday = _b(datetime(2026, 11, 23, 3, 30, tzinfo=TZ))
    assert bk.scheduled_level(cfg, [monday], now) == "light"
    assert bk.scheduled_level({**cfg, "light_backups": False}, [monday], now) == "full"


async def _wait(client, headers, task):
    for _ in range(200):
        task = (await client.get(f"/admin/backups/task/{task['id']}", headers=headers)).json()
        if task["state"] != "running":
            return task
        await asyncio.sleep(0.05)
    raise AssertionError("the task did not finish")


async def test_back_up_and_restore(client, db_session):
    headers = await admin_headers(client)
    status = (await client.get("/admin/backups", headers=headers)).json()
    folder = status["settings"]["backup_path"]
    assert status["status"]["count"] == 0 and status["settings"]["components"] == ["database", "files"]
    upload = Path(status["root"]) / "uploads" / "photo.txt"
    upload.parent.mkdir(parents=True, exist_ok=True)
    upload.write_text("before")
    await make_user(client, db_session, "ana@example.com", "Ana")

    task = await _wait(client, headers, (await client.post("/admin/backups/run", json={"level": "full"}, headers=headers)).json())
    assert task["state"] == "done", task
    [backup] = (await client.get("/admin/backups/files", params={"path": folder}, headers=headers)).json()
    assert backup["level"] == "full" and backup["origin"] == "manual" and backup["name"].startswith("full/")
    info = (await client.post("/admin/backups/inspect", json={"path": folder, "name": backup["name"]}, headers=headers)).json()
    assert info["has_database"] and info["has_files"] and info["file_count"] == 1

    # changes after the backup: a new person, a file changed, the schedule turned on
    await make_user(client, db_session, "bea@example.com", "Bea")
    upload.write_text("after")
    await client.put("/admin/backups/settings", json={**status["settings"], "enabled": True, "recurrence": "weekly"}, headers=headers)

    task = await _wait(client, headers, (await client.post("/admin/backups/restore", json={
        "path": folder, "name": backup["name"], "parts": ["database", "files"]}, headers=headers)).json())
    assert task["state"] == "done", task
    headers = await admin_headers(client)
    users = {u["email"] for u in (await client.get("/admin/users", headers=headers)).json()}
    assert "ana@example.com" in users and "bea@example.com" not in users
    assert upload.read_text() == "before"
    after = (await client.get("/admin/backups", headers=headers)).json()
    assert after["settings"]["enabled"] is True and after["settings"]["recurrence"] == "weekly"  # this server's schedule stays
    # a light backup of what there was before the restore, never deleted by the retention
    assert any(b["origin"] == "prerestore" and b["level"] == "light" for b in after["backups"])
    # new rows still get new ids
    await make_user(client, db_session, "cris@example.com", "Cris")

    link = (await client.post("/admin/backups/download-link", json={"path": folder, "name": backup["name"]}, headers=headers)).json()
    got = await client.get("/admin/backups/download", params={"path": folder, "name": backup["name"], "token": link["token"]})
    assert got.status_code == 200 and got.content[:2] == b"PK"
    assert (await client.get("/admin/backups/download", params={"path": folder, "name": backup["name"], "token": "1.x"})).status_code == 403
    assert (await client.get("/admin/backups/dirs", params={"path": "/etc"}, headers=headers)).status_code == 400
