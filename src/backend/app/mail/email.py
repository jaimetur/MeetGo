"""Outgoing email. SMTP is blocking, so it always runs in a worker thread.

Every automatic email uses the same layout (`render`): a plain-text part and an HTML part."""

import asyncio
import base64
import html as html_lib
import json
import logging
import smtplib
import ssl
import urllib.parse
import urllib.request
from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.i18n import t
from app.core.app_settings import get_section

logger = logging.getLogger("meetgo.email")
_background_tasks: set[asyncio.Task] = set()


def smtp_ready(smtp: dict) -> bool:
    """Whether the administration has configured outgoing mail."""
    if (smtp.get("mode") or "smtp") == "gmail_api":
        return bool(smtp.get("gmail_client_id") and smtp.get("gmail_refresh_token") and (smtp.get("gmail_sender_email") or smtp.get("from_email")))
    return bool(smtp.get("host") and (smtp.get("from_email") or smtp.get("sender_email")))


def render(title: str, paragraphs: list[str], button: tuple[str, str] | None = None,
           footer: list[str] | None = None, footer_links: list[tuple[str, str]] | None = None) -> tuple[str, str]:
    """Plain text and HTML of an email. Texts are plain (escaped here); links are (label, url)."""
    esc = html_lib.escape
    text = [title, ""]
    for paragraph in paragraphs:
        text += [paragraph, ""]
    if button:
        text += [f"{button[0]}: {button[1]}", ""]
    if footer or footer_links:
        text += ["--"] + (footer or []) + [f"{label}: {url}" for label, url in footer_links or []]
    body = "".join(f'<p style="margin:0 0 14px;white-space:pre-line">{esc(p)}</p>' for p in paragraphs)
    if button:
        body += (f'<p style="margin:22px 0 6px"><a href="{esc(button[1], quote=True)}" style="display:inline-block;padding:12px 22px;'
                 f'border-radius:10px;background:#1e90ff;color:#ffffff;text-decoration:none;font-weight:600">{esc(button[0])}</a></p>')
    foot = "".join(f'<p style="margin:0 0 6px">{esc(f)}</p>' for f in footer or [])
    if footer_links:
        foot += '<p style="margin:0">' + " · ".join(
            f'<a href="{esc(url, quote=True)}" style="color:#5a6b85">{esc(label)}</a>' for label, url in footer_links) + "</p>"
    html = (
        '<!doctype html><html><body style="margin:0;padding:24px 12px;background:#eef1f5;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#142036">'
        '<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;padding:26px 24px">'
        '<div style="font-size:22px;font-weight:700;margin-bottom:14px"><span style="color:#1e90ff">Meet</span>'
        '<span style="color:#1f9d4a">Go</span></div>'
        f'<h1 style="font-size:19px;margin:0 0 14px">{esc(title)}</h1>{body}</div>'
        + (f'<div style="max-width:520px;margin:14px auto 0;font-size:12px;color:#5a6b85;line-height:1.5">{foot}</div>' if foot else "")
        + "</body></html>"
    )
    return "\n".join(text).strip() + "\n", html


async def send_email(db: AsyncSession, to_email: str, subject: str, body: str, html: str | None = None) -> None:
    """Send now and raise on failure (used where the caller reports the error)."""
    smtp = await get_section(db, "smtp")
    await asyncio.to_thread(deliver_email, smtp, to_email, subject, body, html)


async def send_email_background(db: AsyncSession, to_email: str, subject: str, body: str, html: str | None = None,
                                headers: dict[str, str] | None = None) -> None:
    """Queue an email without making the request wait for the mail server."""
    if (to_email or "").lower().endswith(".invalid"):  # demo accounts (app/demo): no mailbox behind them
        return
    smtp = await get_section(db, "smtp")

    async def run():
        try:
            await asyncio.to_thread(deliver_email, smtp, to_email, subject, body, html, headers)
        except Exception:
            logger.exception("Email to %s failed", to_email)

    task = asyncio.create_task(run())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


def deliver_email(smtp: dict, to_email: str, subject: str, body: str, html: str | None = None,
                  headers: dict[str, str] | None = None) -> None:
    mode = smtp.get("mode") or "smtp"
    from_email = smtp.get("from_email") or smtp.get("sender_email") or ""
    if not from_email:
        raise HTTPException(500, t("err_smtp_sender_not_configured"))

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    for name, value in (headers or {}).items():
        msg[name] = value
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")

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
