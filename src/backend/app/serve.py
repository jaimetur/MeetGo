"""Run MeetGo in one process on three ports: the API, the web site and the old administration address (app/web.py).

    python -m app.serve
"""

import asyncio
import socket

import uvicorn

from app.web import ADMIN_PORT, API_PORT, WEB_PORT


def _socket(port: int) -> socket.socket:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("0.0.0.0", port))
    return s


def main() -> None:
    config = uvicorn.Config("app.main:app", proxy_headers=True, forwarded_allow_ips="*")
    server = uvicorn.Server(config)
    asyncio.run(server.serve(sockets=[_socket(p) for p in (API_PORT, WEB_PORT, ADMIN_PORT)]))


if __name__ == "__main__":
    main()
