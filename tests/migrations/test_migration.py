"""Version 0.1 data (rooms and direct messages) moves into conversations."""

from sqlalchemy import text

from app.core.db import engine
from app.core.migrate import run_migrations


async def test_rooms_and_direct_messages_are_migrated():
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
    await run_migrations(engine, "0001_baseline")
    async with engine.begin() as conn:
        for statement in LEGACY_DATA.split(";"):
            if statement.strip():
                await conn.execute(text(statement))
    await run_migrations(engine)
    await _check()


LEGACY_DATA = """
            INSERT INTO users (id, email, phone, password_hash, display_name, dob, age_range, province, created_at)
            VALUES (1, 'a@x.es', '+341', 'x', 'Ana', '1990-01-01', 'R31_50', 'Madrid', now()),
                   (2, 'b@x.es', '+342', 'x', 'Bea', '1985-01-01', '31_55', 'Madrid', now());
            INSERT INTO interests (id, slug, name) VALUES (1, 'cine', 'Cine'), (2, 'padel', 'Padel');
            INSERT INTO user_interests (user_id, interest_id) VALUES (1, 1), (2, 1), (2, 2);
            INSERT INTO rooms (id, province, age_range, interest_id, created_at) VALUES (10, 'Madrid', '31_55', 1, now());
            INSERT INTO room_rules (room_id, rules_markdown, policy_json) VALUES (10, 'Normas', '{"block_links": false}');
            INSERT INTO room_messages (room_id, user_id, content, created_at, is_deleted, moderation_reason)
            VALUES (10, 1, 'Hola cine', '2026-01-01 10:00:00', false, NULL),
                   (10, 2, 'insulto', '2026-01-01 10:01:00', true, 'TOXICITY');
            INSERT INTO room_discipline (room_id, user_id, strikes, is_banned) VALUES (10, 2, 3, false);
            INSERT INTO dm_conversations (id, user1_id, user2_id, created_at) VALUES (5, 1, 2, now());
            INSERT INTO dm_messages (conversation_id, user_id, content, created_at) VALUES (5, 2, 'Privado', '2026-01-02 09:00:00');
"""


async def _check():
    async with engine.connect() as conn:
        channels = (await conn.execute(text(
            "SELECT id, province, age_range, interest_id, rules_markdown, policy_json FROM conversations WHERE kind='channel' ORDER BY interest_id"))).all()
        assert [(c.province, c.age_range, c.interest_id) for c in channels] == [("Madrid", "31_50", 1), ("Madrid", "31_50", 2)]
        assert channels[0].rules_markdown == "Normas" and channels[0].policy_json == {"block_links": False}
        msgs = (await conn.execute(text(
            "SELECT body, deleted_at IS NOT NULL AS deleted, moderation_reason, created_at FROM messages WHERE conversation_id=:c ORDER BY id"),
            {"c": channels[0].id})).all()
        assert [(m.body, m.deleted) for m in msgs] == [("Hola cine", False), ("", True)]
        assert msgs[0].created_at.isoformat().startswith("2026-01-01T10:00:00")
        members = (await conn.execute(text(
            "SELECT conversation_id, user_id, notify, strikes, last_read_message_id FROM conversation_members ORDER BY conversation_id, user_id"))).all()
        cine = [m for m in members if m.conversation_id == channels[0].id]
        assert [(m.user_id, m.notify) for m in cine] == [(1, "mentions"), (2, "mentions")]
        assert cine[1].strikes == 3 and all(m.last_read_message_id > 0 for m in cine)
        dm = (await conn.execute(text("SELECT id, dm_key FROM conversations WHERE kind='dm'"))).one()
        assert dm.dm_key == "1:2"
        assert (await conn.execute(text("SELECT body FROM messages WHERE conversation_id=:c"), {"c": dm.id})).scalar() == "Privado"
        # The old tables stay untouched.
        assert (await conn.execute(text("SELECT count(*) FROM room_messages"))).scalar() == 2
