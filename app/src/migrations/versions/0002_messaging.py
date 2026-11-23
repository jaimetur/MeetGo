"""Messaging: conversations (channels, groups, direct messages) and their messages.

Moves the old rooms and direct messages into the new tables. The old tables are kept,
untouched, so nothing is lost if the migration has to be investigated.

Revision ID: 0002_messaging
Revises: 0001_baseline
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0002_messaging"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)

# Old age-range values mapped to the three current ones.
NORMALISE_AGE = """
CASE {col}::text
  WHEN 'R18_30' THEN '18_30'
  WHEN '31_55' THEN '31_50' WHEN 'R31_50' THEN '31_50' WHEN 'R31_55' THEN '31_50'
  WHEN '55_plus' THEN '51_plus' WHEN 'R51_PLUS' THEN '51_plus' WHEN 'R55_PLUS' THEN '51_plus'
  ELSE {col}::text END
"""


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False, index=True),
        sa.Column("title", sa.String(120)),
        sa.Column("description", sa.Text),
        sa.Column("avatar_url", sa.String(512)),
        sa.Column("province", sa.String(64), index=True),
        sa.Column("age_range", sa.String(16)),
        sa.Column("interest_id", sa.Integer, sa.ForeignKey("interests.id"), index=True),
        sa.Column("dm_key", sa.String(40), unique=True),
        sa.Column("created_by_id", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("last_message_id", sa.BigInteger),
        sa.Column("last_message_at", TS, index=True),
        sa.Column("slow_mode_seconds", sa.Integer, server_default="0", nullable=False),
        sa.Column("rules_markdown", sa.Text, server_default="", nullable=False),
        sa.Column("policy_json", JSONB, server_default="{}", nullable=False),
        sa.Column("invite_code", sa.String(32), unique=True),
        sa.Column("pinned_message_id", sa.BigInteger),
        sa.Column("legacy_room_id", sa.Integer, unique=True),
        sa.Column("legacy_dm_id", sa.Integer, unique=True),
        sa.UniqueConstraint("province", "age_range", "interest_id", name="uq_channel_key"),
    )
    op.create_table(
        "conversation_members",
        sa.Column("conversation_id", sa.Integer, sa.ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True),
        sa.Column("role", sa.String(16), server_default="member", nullable=False),
        sa.Column("joined_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("last_read_message_id", sa.BigInteger, server_default="0", nullable=False),
        sa.Column("notify", sa.String(16), server_default="all", nullable=False),
        sa.Column("muted_until", TS),
        sa.Column("pinned", sa.Boolean, server_default=sa.false(), nullable=False),
        sa.Column("hidden", sa.Boolean, server_default=sa.false(), nullable=False),
        sa.Column("strikes", sa.Integer, server_default="0", nullable=False),
        sa.Column("last_strike_at", TS),
        sa.Column("silenced_until", TS),
        sa.Column("banned", sa.Boolean, server_default=sa.false(), nullable=False),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("conversation_id", sa.Integer, sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), index=True),
        sa.Column("client_id", sa.String(64)),
        sa.Column("kind", sa.String(16), server_default="text", nullable=False),
        sa.Column("body", sa.Text, server_default="", nullable=False),
        sa.Column("reply_to_id", sa.BigInteger),
        sa.Column("thread_root_id", sa.BigInteger, index=True),
        sa.Column("thread_reply_count", sa.Integer, server_default="0", nullable=False),
        sa.Column("thread_last_reply_at", TS),
        sa.Column("also_in_channel", sa.Boolean, server_default=sa.false(), nullable=False),
        sa.Column("mentions", JSONB, server_default="[]", nullable=False),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("edited_at", TS),
        sa.Column("deleted_at", TS),
        sa.Column("moderation_reason", sa.String(64)),
        sa.UniqueConstraint("sender_id", "client_id", name="uq_message_client_id"),
    )
    op.create_index("ix_messages_conversation_id_id", "messages", ["conversation_id", "id"])
    op.execute("CREATE INDEX ix_messages_body_fts ON messages USING gin (to_tsvector('simple', body))")
    op.execute("CREATE INDEX ix_messages_mentions ON messages USING gin (mentions jsonb_path_ops)")
    op.create_table(
        "message_reactions",
        sa.Column("message_id", sa.BigInteger, sa.ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("emoji", sa.String(32), primary_key=True),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "attachments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("message_id", sa.BigInteger, sa.ForeignKey("messages.id", ondelete="CASCADE"), index=True),
        sa.Column("uploader_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("storage_key", sa.String(255), nullable=False),
        sa.Column("thumb_key", sa.String(255)),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("mime", sa.String(128), nullable=False),
        sa.Column("size", sa.Integer, nullable=False),
        sa.Column("width", sa.Integer),
        sa.Column("height", sa.Integer),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "devices",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("token", sa.Text, unique=True, nullable=False),
        sa.Column("keys", JSONB, server_default="{}", nullable=False),
        sa.Column("user_agent", sa.String(255)),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("last_seen_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "reports",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("message_id", sa.BigInteger, sa.ForeignKey("messages.id", ondelete="CASCADE"), index=True, nullable=False),
        sa.Column("reporter_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reason", sa.String(64), nullable=False),
        sa.Column("details", sa.Text),
        sa.Column("status", sa.String(16), server_default="open", nullable=False, index=True),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_by_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("resolved_at", TS),
        sa.UniqueConstraint("message_id", "reporter_id", name="uq_report_once"),
    )
    _migrate_rooms()
    _migrate_direct_messages()
    _finish()


def _migrate_rooms() -> None:
    age = NORMALISE_AGE.format(col="r.age_range")
    # One channel per zone and interest; old rooms with legacy age values fold into the current range.
    op.execute(f"""
        INSERT INTO conversations (kind, province, age_range, interest_id, rules_markdown, policy_json, created_at, legacy_room_id)
        SELECT DISTINCT ON (r.province, {age}, r.interest_id)
               'channel', r.province, {age}, r.interest_id,
               COALESCE(rr.rules_markdown, ''), COALESCE(rr.policy_json::jsonb, '{{}}'::jsonb),
               COALESCE(r.created_at, now() at time zone 'utc') AT TIME ZONE 'UTC', r.id
        FROM rooms r LEFT JOIN room_rules rr ON rr.room_id = r.id
        ORDER BY r.province, {age}, r.interest_id, r.id
        ON CONFLICT DO NOTHING
    """)
    op.execute(f"""
        CREATE TEMP TABLE room_map ON COMMIT DROP AS
        SELECT r.id AS room_id, c.id AS conversation_id
        FROM rooms r JOIN conversations c
          ON c.kind = 'channel' AND c.province = r.province AND c.age_range = {age} AND c.interest_id = r.interest_id
    """)
    op.execute("""
        INSERT INTO messages (conversation_id, sender_id, kind, body, created_at, deleted_at, moderation_reason)
        SELECT m.conversation_id, rm.user_id, 'text',
               CASE WHEN rm.is_deleted THEN '' ELSE COALESCE(rm.content, '') END,
               COALESCE(rm.created_at, now() at time zone 'utc') AT TIME ZONE 'UTC',
               CASE WHEN rm.is_deleted THEN COALESCE(rm.created_at, now() at time zone 'utc') AT TIME ZONE 'UTC' END,
               rm.moderation_reason
        FROM room_messages rm JOIN room_map m ON m.room_id = rm.room_id
        ORDER BY rm.id
    """)
    # Channels for every zone and interest people chose, even if no room was opened yet.
    user_age = NORMALISE_AGE.format(col="u.age_range")
    op.execute(f"""
        INSERT INTO conversations (kind, province, age_range, interest_id)
        SELECT DISTINCT 'channel', u.province, {user_age}, ui.interest_id
        FROM user_interests ui JOIN users u ON u.id = ui.user_id
        ON CONFLICT DO NOTHING
    """)
    op.execute(f"""
        INSERT INTO conversation_members (conversation_id, user_id, notify)
        SELECT c.id, u.id, 'mentions'
        FROM user_interests ui JOIN users u ON u.id = ui.user_id
        JOIN conversations c ON c.kind = 'channel' AND c.province = u.province
             AND c.age_range = {user_age} AND c.interest_id = ui.interest_id
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        UPDATE conversation_members cm
        SET strikes = COALESCE(d.strikes, 0),
            last_strike_at = d.last_strike_at AT TIME ZONE 'UTC',
            silenced_until = d.muted_until AT TIME ZONE 'UTC',
            banned = COALESCE(d.is_banned, false)
        FROM room_discipline d JOIN room_map m ON m.room_id = d.room_id
        WHERE cm.conversation_id = m.conversation_id AND cm.user_id = d.user_id
    """)


def _migrate_direct_messages() -> None:
    op.execute("""
        INSERT INTO conversations (kind, dm_key, created_at, legacy_dm_id)
        SELECT 'dm', LEAST(d.user1_id, d.user2_id) || ':' || GREATEST(d.user1_id, d.user2_id),
               COALESCE(d.created_at, now() at time zone 'utc') AT TIME ZONE 'UTC', d.id
        FROM dm_conversations d
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        INSERT INTO conversation_members (conversation_id, user_id)
        SELECT c.id, x.user_id FROM conversations c
        JOIN dm_conversations d ON d.id = c.legacy_dm_id
        CROSS JOIN LATERAL (VALUES (d.user1_id), (d.user2_id)) AS x(user_id)
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        INSERT INTO messages (conversation_id, sender_id, kind, body, created_at)
        SELECT c.id, dm.user_id, 'text', COALESCE(dm.content, ''),
               COALESCE(dm.created_at, now() at time zone 'utc') AT TIME ZONE 'UTC'
        FROM dm_messages dm JOIN conversations c ON c.legacy_dm_id = dm.conversation_id
        ORDER BY dm.id
    """)


def _finish() -> None:
    op.execute("""
        UPDATE conversations c SET last_message_id = x.max_id, last_message_at = x.max_at
        FROM (SELECT conversation_id, max(id) AS max_id, max(created_at) AS max_at FROM messages GROUP BY conversation_id) x
        WHERE x.conversation_id = c.id
    """)
    # Migrated history is not "new" for anybody.
    op.execute("""
        UPDATE conversation_members cm SET last_read_message_id = c.last_message_id
        FROM conversations c WHERE c.id = cm.conversation_id AND c.last_message_id IS NOT NULL
    """)


def downgrade() -> None:
    for table in ("reports", "devices", "attachments", "message_reactions", "messages", "conversation_members", "conversations"):
        op.drop_table(table)
