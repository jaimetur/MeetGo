"""Outgoing email. SMTP is blocking, so it always runs in a worker thread."""

import asyncio
import base64
import json
import logging
import smtplib
import ssl
import urllib.parse
import urllib.request
from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..i18n import t
from .app_settings import get_section

logger = logging.getLogger("meetgo.email")
_background_tasks: set[asyncio.Task] = set()


async def send_email(db: AsyncSession, to_email: str, subject: str, body: str) -> None:
    """Send now and raise on failure (used where the caller reports the error)."""
    smtp = await get_section(db, "smtp")
    await asyncio.to_thread(deliver_email, smtp, to_email, subject, body)


async def send_email_background(db: AsyncSession, to_email: str, subject: str, body: str) -> None:
    """Queue an email without making the request wait for the mail server."""
    smtp = await get_section(db, "smtp")

    async def run():
        try:
            await asyncio.to_thread(deliver_email, smtp, to_email, subject, body)
        except Exception:
            logger.exception("Email to %s failed", to_email)

    task = asyncio.create_task(run())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def deliver_email(smtp: dict, to_email: str, subject: str, body: str) -> None:
    mode = smtp.get("mode") or "smtp"
    from_email = smtp.get("from_email") or smtp.get("sender_email") or ""
    if not from_email:
        raise HTTPException(500, t("err_smtp_sender_not_configured"))

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.set_content(body)

    if mode == "gmail_api":
        client_id = smtp.get("gmail_client_id") or ""
        client_secret = smtp.get("gmail_client_secret") or ""
        refresh_token = smtp.get("gmail_refresh_token") or ""
        sender_email = smtp.get("gmail_sender_email") or from_email
        if not (client_id and client_secret and refresh_token and sender_email):
            raise HTTPException(500, t("err_gmail_not_configured"))
        data = urllib.parse.urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode()
        req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
        with urllib.request.urlopen(req, timeout=10) as resp:
            token_payload = json.loads(resp.read().decode())
        access_token = token_payload.get("access_token")
        if not access_token:
            raise HTTPException(500, t("err_gmail_token_failed"))
        auth_string = f"user={sender_email}\x01auth=Bearer {access_token}\x01\x01"
        b64 = base64.b64encode(auth_string.encode()).decode()
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=10) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            server.docmd("AUTH", "XOAUTH2 " + b64)
            server.send_message(msg)
        return

    host = smtp.get("host") or ""
    port = int(smtp.get("port") or 587)
    username = smtp.get("username") or ""
    password = smtp.get("password") or ""
    encryption = (smtp.get("encryption") or "starttls").lower()
    if not host:
        raise HTTPException(500, t("err_smtp_host_not_configured"))
    if encryption == "ssl":
        with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=10) as server:
            if username:
                server.login(username, password)
            server.send_message(msg)
        return
    with smtplib.SMTP(host, port, timeout=10) as server:
        server.ehlo()
        if encryption == "starttls":
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if username:
            server.login(username, password)
        server.send_message(msg)
