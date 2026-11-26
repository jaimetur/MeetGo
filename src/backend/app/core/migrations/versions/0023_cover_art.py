"""Plans and events can take a cover from the gallery of illustrations instead of an uploaded photo.

Revision ID: 0023_cover_art
Revises: 0022_download_counts
"""

from alembic import op

revision = "0023_cover_art"
down_revision = "0022_download_counts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS cover_art VARCHAR(32)")


def downgrade() -> None:
    op.execute("ALTER TABLE board_posts DROP COLUMN IF EXISTS cover_art")
