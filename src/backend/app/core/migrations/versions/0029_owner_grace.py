"""Communities made by people: when their owner stops fitting its ages or zone, the day it happened (30 days of grace to
hand it over; after that MeetGo hands it over).

Revision ID: 0029_owner_grace
Revises: 0028_story_music
"""

from alembic import op

revision = "0029_owner_grace"
down_revision = "0028_story_music"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS owner_out_since TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS owner_out_since")
