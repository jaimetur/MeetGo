"""Automatic emails: language and email choices of each person, digest markers and one-off notices.

Revision ID: 0004_email_notifications
Revises: 0003_subscriptions
"""

from alembic import op
import sqlalchemy as sa

revision = "0004_email_notifications"
down_revision = "0003_subscriptions"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS lang VARCHAR(8) NOT NULL DEFAULT 'es'")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_prefs JSONB")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_digest_email_at TIMESTAMPTZ")
    # Messages sent before this version are not emailed: start every marker at the newest message.
    op.execute("ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS email_notified_message_id BIGINT NOT NULL DEFAULT 0")
    op.execute("UPDATE conversation_members SET email_notified_message_id = COALESCE((SELECT MAX(id) FROM messages), 0)")
    op.create_table(
        "email_notices",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("key", sa.String(96), primary_key=True),
        sa.Column("sent_at", TS, server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("email_notices")
    op.execute("ALTER TABLE conversation_members DROP COLUMN IF EXISTS email_notified_message_id")
    for column in ("last_digest_email_at", "email_prefs", "lang"):
        op.execute(f"ALTER TABLE users DROP COLUMN IF EXISTS {column}")
