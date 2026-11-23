"""Who gets a push notification for a new message."""

from datetime import timedelta

from src.models import Conversation, ConversationMember, Message, utcnow
from src.services.push import _wants


def _member(user_id, notify="all", **kw):
    return ConversationMember(conversation_id=1, user_id=user_id, notify=notify, banned=False, **kw)


def _msg(**kw):
    base = {"conversation_id": 1, "sender_id": 1, "body": "hola", "mentions": [], "thread_root_id": None, "also_in_channel": False}
    return Message(**{**base, **kw})


def test_groups_and_direct_messages_notify_everything_but_your_own():
    group = Conversation(id=1, kind="group")
    assert _wants(group, _member(2), _msg(), None, None)
    assert not _wants(group, _member(1), _msg(), None, None)
    assert not _wants(group, _member(2, notify="none"), _msg(), None, None)
    assert not _wants(group, _member(2, muted_until=utcnow() + timedelta(hours=1)), _msg(), None, None)


def test_channels_notify_mentions_and_replies_only():
    channel = Conversation(id=1, kind="channel")
    assert not _wants(channel, _member(2, notify="mentions"), _msg(), None, None)
    assert _wants(channel, _member(2, notify="mentions"), _msg(mentions=[2]), None, None)
    assert _wants(channel, _member(2, notify="mentions"), _msg(reply_to_id=9), None, 2)
    assert _wants(channel, _member(2, notify="all"), _msg(), None, None)


def test_thread_replies_reach_the_thread_author():
    channel = Conversation(id=1, kind="channel")
    reply = _msg(thread_root_id=5)
    assert _wants(channel, _member(3, notify="mentions"), reply, 3, None)
    assert not _wants(Conversation(id=1, kind="group"), _member(4), reply, 3, None)
