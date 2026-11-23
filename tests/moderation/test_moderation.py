"""Automatic moderation of channel messages."""

from sqlalchemy import select, update

from app.core.models import Conversation, Interest, User
from app.accounts.common import normalize_phone as _normalize_phone
from app.core.security import hash_password
from app.messaging.moderation import PHONE_RE, contains_toxicity as _contains_toxicity

from tests.helpers import register, verified_token  # noqa: F401


def test_moderation_matches_whole_words_only():
    assert not _contains_toxicity("Tengo buena reputación")
    assert not _contains_toxicity("La disputa se resolvió")
    assert not _contains_toxicity("el cómputo total")
    assert _contains_toxicity("eres un IMBÉCIL")


def test_phone_filter():
    assert PHONE_RE.search("llámame al 612 34 56 78")
    assert PHONE_RE.search("+44 7911 123456")
    assert not PHONE_RE.search("quedamos el 2026-11-23 10:00")
    assert not PHONE_RE.search("son 11 km y 4 h")
