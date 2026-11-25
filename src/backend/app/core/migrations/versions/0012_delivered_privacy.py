"""Delivered ticks (the message reached the other person's app) and WhatsApp-like privacy: read receipts and last seen.

Revision ID: 0012_delivered_privacy
Revises: 0011_plans_meetup
"""

from alembic import op

revision = "0012_delivered_privacy"
down_revision = "0011_plans_meetup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS last_delivered_message_id BIGINT NOT NULL DEFAULT 0")
    # what was read was delivered too
    op.execute("UPDATE conversation_members SET last_delivered_message_id = last_read_message_id WHERE last_delivered_message_id < last_read_message_id")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS read_receipts BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_privacy VARCHAR(16) NOT NULL DEFAULT 'all'")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_seen_privacy")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS read_receipts")
    op.execute("ALTER TABLE conversation_members DROP COLUMN IF EXISTS last_delivered_message_id")
