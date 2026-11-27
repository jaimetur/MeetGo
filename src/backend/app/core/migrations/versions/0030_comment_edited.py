"""Board comments (the replies in a debate or a plan) can be edited by their author: when, to show "edited".

Revision ID: 0030_comment_edited
Revises: 0029_owner_grace
"""

from alembic import op

revision = "0030_comment_edited"
down_revision = "0029_owner_grace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE board_comments ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE board_comments DROP COLUMN IF EXISTS edited_at")
