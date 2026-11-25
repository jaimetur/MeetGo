"""Downloads counted by the server, per day: the Android app (APK) for Administration → Business.

Revision ID: 0022_download_counts
Revises: 0021_interest_names
"""

from alembic import op

revision = "0022_download_counts"
down_revision = "0021_interest_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS download_counts (
        day DATE NOT NULL, kind VARCHAR(16) NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS download_counts")
