"""Interest communities get the settings of people's communities (age span, access, board, chat retention, join
questions), and interests a community is about (its own interest and related ones; chosen by people for their communities), to
suggest communities that fit each person's interests.

Revision ID: 0014_interest_tags
Revises: 0013_chat_retention
"""

from alembic import op

revision = "0014_interest_tags"
down_revision = "0013_chat_retention"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS interest_tags JSONB NOT NULL DEFAULT '[]'::jsonb")
    # interest communities get the settings of people's communities, set per interest
    for sql in (
        "ALTER TABLE interests ADD COLUMN IF NOT EXISTS min_age INTEGER",
        "ALTER TABLE interests ADD COLUMN IF NOT EXISTS max_age INTEGER",
        "ALTER TABLE interests ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'open'",
        "ALTER TABLE interests ADD COLUMN IF NOT EXISTS board_mode VARCHAR(16) NOT NULL DEFAULT 'open'",
        "ALTER TABLE interests ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 365",
        "ALTER TABLE interests ADD COLUMN IF NOT EXISTS join_questions JSONB NOT NULL DEFAULT '[]'::jsonb",
    ):
        op.execute(sql)


def downgrade() -> None:
    for col in ("min_age", "max_age", "access_mode", "board_mode", "retention_days", "join_questions"):
        op.execute(f"ALTER TABLE interests DROP COLUMN IF EXISTS {col}")
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS interest_tags")
    op.execute("ALTER TABLE interests DROP COLUMN IF EXISTS tags")
