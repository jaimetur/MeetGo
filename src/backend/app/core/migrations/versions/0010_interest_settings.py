"""Interest communities get a category, an icon, a colour and restrictions (age ranges, active).

Revision ID: 0010_interest_settings
Revises: 0009_delete_chat_for_me
"""

from alembic import op

revision = "0010_interest_settings"
down_revision = "0009_delete_chat_for_me"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS category VARCHAR(32)")
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS icon VARCHAR(32)")
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS color VARCHAR(16)")
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS age_ranges JSONB NOT NULL DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE")


def downgrade() -> None:
    for col in ("category", "icon", "color", "age_ranges", "active"):
        op.execute(f"ALTER TABLE interests DROP COLUMN IF EXISTS {col}")
