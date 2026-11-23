"""Baseline: the schema MeetGo 0.1 created with create_all and manual ALTERs.

Existing databases already have these tables; only what is missing is created.

Revision ID: 0001_baseline
Revises:
"""

from alembic import op
import sqlalchemy as sa

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

AGE_RANGES = ("18_30", "31_50", "51_plus", "31_55", "55_plus", "R18_30", "R31_50", "R51_PLUS", "R31_55", "R55_PLUS")
DM_STATUS = ("PENDING", "ACCEPTED", "REJECTED", "EXPIRED")
FRIEND_STATUS = ("PENDING", "ACCEPTED", "REJECTED")


def _legacy_metadata() -> sa.MetaData:
    md = sa.MetaData()
    agerange = sa.Enum(*AGE_RANGES, name="agerange")
    sa.Table(
        "users", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(255), unique=True, index=True, nullable=True),
        sa.Column("phone", sa.String(64), unique=True, index=True, nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("display_name", sa.String(64), nullable=False),
        sa.Column("dob", sa.String(10), nullable=False),
        sa.Column("age_range", agerange, index=True, nullable=False),
        sa.Column("country", sa.String(2), index=True, nullable=True),
        sa.Column("province", sa.String(64), index=True, nullable=False),
        sa.Column("city", sa.String(64), nullable=True),
        sa.Column("dob_change_count", sa.Integer, server_default="0"),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column("bio", sa.Text, nullable=True),
        sa.Column("accept_dm", sa.Boolean, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime, server_default=sa.text("(now() at time zone 'utc')")),
        sa.Column("last_active_at", sa.DateTime, server_default=sa.text("(now() at time zone 'utc')")),
        sa.Column("role", sa.String(32), index=True, server_default="user"),
        sa.Column("email_verified", sa.Boolean, server_default=sa.false()),
        sa.Column("email_verification_token", sa.String(128), index=True, nullable=True),
        sa.Column("email_verification_sent_at", sa.DateTime, nullable=True),
        sa.Column("reset_token", sa.String(128), index=True, nullable=True),
        sa.Column("reset_expires_at", sa.DateTime, nullable=True),
        sa.Column("password_temp", sa.Boolean, server_default=sa.false()),
        sa.Column("phone_changed_at", sa.DateTime, nullable=True),
        sa.Column("login_count", sa.Integer, server_default="0"),
        sa.Column("last_login_at", sa.DateTime, nullable=True),
        sa.Column("last_seen_at", sa.DateTime, nullable=True),
        sa.Column("session_started_at", sa.DateTime, nullable=True),
        sa.Column("session_active", sa.Boolean, server_default=sa.false()),
        sa.Column("total_connected_seconds", sa.Integer, server_default="0"),
        sa.Column("is_banned", sa.Boolean, server_default=sa.false()),
        sa.Column("banned_until", sa.DateTime, nullable=True),
    )
    sa.Table(
        "interests", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("slug", sa.String(64), unique=True, index=True, nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
    )
    sa.Table(
        "user_interests", md,
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("interest_id", sa.Integer, sa.ForeignKey("interests.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "rooms", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("province", sa.String(64), index=True, nullable=False),
        sa.Column("age_range", agerange, index=True, nullable=False),
        sa.Column("interest_id", sa.Integer, sa.ForeignKey("interests.id"), index=True, nullable=False),
        sa.Column("created_at", sa.DateTime),
        sa.UniqueConstraint("province", "age_range", "interest_id", name="uq_room_key"),
    )
    sa.Table(
        "room_rules", md,
        sa.Column("room_id", sa.Integer, sa.ForeignKey("rooms.id"), primary_key=True),
        sa.Column("rules_markdown", sa.Text),
        sa.Column("policy_json", sa.JSON),
        sa.Column("updated_at", sa.DateTime),
        sa.Column("updated_by_user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
    )
    sa.Table(
        "room_discipline", md,
        sa.Column("room_id", sa.Integer, sa.ForeignKey("rooms.id"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("strikes", sa.Integer),
        sa.Column("last_strike_at", sa.DateTime, nullable=True),
        sa.Column("muted_until", sa.DateTime, nullable=True),
        sa.Column("is_banned", sa.Boolean),
        sa.Column("updated_at", sa.DateTime),
    )
    sa.Table(
        "room_messages", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("room_id", sa.Integer, sa.ForeignKey("rooms.id"), index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("content", sa.Text),
        sa.Column("created_at", sa.DateTime),
        sa.Column("is_deleted", sa.Boolean),
        sa.Column("moderation_reason", sa.String(64), nullable=True),
    )
    sa.Table(
        "dm_requests", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("from_user_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("to_user_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("status", sa.Enum(*DM_STATUS, name="dmstatus"), index=True),
        sa.Column("created_at", sa.DateTime),
        sa.Column("resolved_at", sa.DateTime, nullable=True),
    )
    sa.Table(
        "dm_conversations", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user1_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("user2_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("created_at", sa.DateTime),
        sa.UniqueConstraint("user1_id", "user2_id", name="uq_dm_pair"),
    )
    sa.Table(
        "dm_messages", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("conversation_id", sa.Integer, sa.ForeignKey("dm_conversations.id"), index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("content", sa.Text),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "follows", md,
        sa.Column("follower_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("following_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "friend_requests", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("from_user_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("to_user_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("status", sa.Enum(*FRIEND_STATUS, name="friendrequeststatus"), index=True),
        sa.Column("created_at", sa.DateTime),
        sa.Column("resolved_at", sa.DateTime, nullable=True),
    )
    sa.Table(
        "friendships", md,
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("friend_id", sa.Integer, sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "posts", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id"), index=True),
        sa.Column("content", sa.Text),
        sa.Column("created_at", sa.DateTime),
    )
    sa.Table(
        "app_settings", md,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("data", sa.JSON),
    )
    return md


def upgrade() -> None:
    bind = op.get_bind()
    _legacy_metadata().create_all(bind, checkfirst=True)
    # Databases created by older versions may lack enum values or columns added later.
    for value in AGE_RANGES:
        op.execute(f"ALTER TYPE agerange ADD VALUE IF NOT EXISTS '{value}'")
    for column, ddl in (
        ("country", "VARCHAR(2)"), ("dob_change_count", "INTEGER DEFAULT 0"), ("role", "VARCHAR(32) DEFAULT 'user'"),
        ("email_verified", "BOOLEAN DEFAULT FALSE"), ("email_verification_token", "VARCHAR(128)"),
        ("email_verification_sent_at", "TIMESTAMP"), ("reset_token", "VARCHAR(128)"), ("reset_expires_at", "TIMESTAMP"),
        ("password_temp", "BOOLEAN DEFAULT FALSE"), ("phone_changed_at", "TIMESTAMP"), ("login_count", "INTEGER DEFAULT 0"),
        ("last_login_at", "TIMESTAMP"), ("last_seen_at", "TIMESTAMP"), ("session_started_at", "TIMESTAMP"),
        ("session_active", "BOOLEAN DEFAULT FALSE"), ("total_connected_seconds", "INTEGER DEFAULT 0"),
        ("is_banned", "BOOLEAN DEFAULT FALSE"), ("banned_until", "TIMESTAMP"),
    ):
        op.execute(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {column} {ddl}")


def downgrade() -> None:
    raise NotImplementedError("The baseline cannot be downgraded.")
