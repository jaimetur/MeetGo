"""Encrypt secrets stored in the database (payment keys, service accounts).

The key derives from JWT_SECRET: changing JWT_SECRET makes stored secrets unreadable,
and the administrator has to paste them again.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet() -> Fernet:
    digest = hashlib.sha256(("meetgo-secrets:" + settings.JWT_SECRET).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return ""


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
