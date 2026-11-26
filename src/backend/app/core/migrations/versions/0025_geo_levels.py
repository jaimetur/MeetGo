"""Interest communities with an editable geographic width (country, region or province; country by default) and an
official language for every community.

Revision ID: 0025_geo_levels
Revises: 0024_categories
"""

from alembic import op

revision = "0025_geo_levels"
down_revision = "0024_categories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS geo_level VARCHAR(16) NOT NULL DEFAULT 'country'")
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS language VARCHAR(8)")


def downgrade() -> None:
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS language")
    op.execute("ALTER TABLE interests DROP COLUMN IF EXISTS geo_level")
