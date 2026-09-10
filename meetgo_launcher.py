"""Shared local-development launcher for the MeetGo PyCharm entry points."""

from __future__ import annotations

import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
WEB_DIR = ROOT / "web"
INTERFACES = {
    "user": ("web_user", "5173", "user interface"),
    "admin": ("web_admin", "5174", "administration interface"),
}


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.5)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def start_macos_homebrew_service(service: str, port: int) -> bool:
    if platform.system() != "Darwin":
        return False
    brew = shutil.which("brew")
    if not brew:
        return False
    subprocess.run([brew, "services", "start", service], check=False)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if port_is_open(port):
            return True
        time.sleep(0.25)
    return False


def require_local_services() -> None:
    missing: list[str] = []
    if not port_is_open(5432) and not start_macos_homebrew_service("postgresql@16", 5432):
        missing.append("PostgreSQL")
    if not port_is_open(6379) and not start_macos_homebrew_service("redis", 6379):
        missing.append("Redis")
    if missing:
        print(
            "MeetGo cannot start. Start "
            + ", ".join(missing)
            + " and see the README for your operating-system setup.",
            file=sys.stderr,
        )
        raise SystemExit(1)


def node_executable() -> str:
    candidates = [
        shutil.which("node"),
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    print("Node.js was not found. Install Node.js 20 or later and run again.", file=sys.stderr)
    raise SystemExit(1)


def terminate(processes: list[subprocess.Popen[object]]) -> None:
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def launch(interface: str) -> None:
    require_local_services()
    if not (WEB_DIR / "node_modules" / "vite").exists():
        print("Web dependencies are missing. Run `npm install` inside web/.", file=sys.stderr)
        raise SystemExit(1)
    node = node_executable()

    root, port, label = INTERFACES[interface]
    environment = os.environ.copy()
    local_user = quote(os.environ.get("USER", "postgres"), safe="")
    environment.setdefault("DATABASE_URL", f"postgresql+asyncpg://{local_user}@127.0.0.1:5432/meetgo")
    environment.setdefault("REDIS_URL", "redis://127.0.0.1:6379/0")
    environment.setdefault("JWT_SECRET", "dev-secret-change-me")

    backend = [
        sys.executable,
        "-m",
        "uvicorn",
        "src.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "18000",
        "--reload",
        "--reload-dir",
        "src",
    ]
    frontend = [
        node,
        str(WEB_DIR / "node_modules" / "vite" / "bin" / "vite.js"),
        "--host",
        "127.0.0.1",
        "--port",
        port,
    ]
    processes: list[subprocess.Popen[object]] = []
    try:
        if not port_is_open(18000):
            processes.append(subprocess.Popen(backend, cwd=APP_DIR, env=environment))

        processes.append(
            subprocess.Popen(
                frontend,
                cwd=WEB_DIR,
                env={**environment, "VITE_ROOT": f"./{root}", "VITE_API_BASE": "http://127.0.0.1:18000"},
            )
        )
    except BaseException:
        terminate(processes)
        raise
    print(f"MeetGo {label} ready: http://127.0.0.1:{port}")

    try:
        while True:
            for process in processes:
                if (exit_code := process.poll()) is not None:
                    raise SystemExit(exit_code)
            time.sleep(0.25)
    except KeyboardInterrupt:
        print("\nStopping MeetGo...")
    finally:
        terminate(processes)
