"""Deleting a chat only for yourself: the messages up to then are no longer shown to you.

Revision ID: 0009_delete_chat_for_me
Revises: 0008_age_ranges
"""

from alembic import op

revision = "0009_delete_chat_for_me"
down_revision = "0008_age_ranges"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS cleared_message_id BIGINT NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE conversation_members DROP COLUMN IF EXISTS cleared_message_id")
