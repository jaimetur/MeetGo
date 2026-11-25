"""Visits (coming back to the app after a while), for the administration: sign-ins are few as the session stays open.

Revision ID: 0016_visits
Revises: 0015_receipt_times
"""

from alembic import op

revision = "0016_visits"
down_revision = "0015_receipt_times"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS visit_count INTEGER NOT NULL DEFAULT 0")
    op.execute("UPDATE users SET visit_count = coalesce(login_count, 0) WHERE visit_count = 0")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS visit_count")
