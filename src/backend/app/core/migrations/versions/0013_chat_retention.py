"""Communities keep their chat for a limited time: interest communities one year; communities made by people choose
(1 day to 1 year, one month for new ones). Existing communities made by people start at one year, so nothing recent
disappears without their owners choosing it.

Revision ID: 0013_chat_retention
Revises: 0012_delivered_privacy
"""

from alembic import op

revision = "0013_chat_retention"
down_revision = "0012_delivered_privacy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS retention_days INTEGER")
    op.execute("UPDATE conversations SET retention_days = 365 WHERE kind = 'channel' AND retention_days IS NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS retention_days")
