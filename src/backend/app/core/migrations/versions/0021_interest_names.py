"""Interest names in every language, editable in the administration; the built-in interests get theirs.

Revision ID: 0021_interest_names
Revises: 0020_drop_v01_tables
"""

import json

from alembic import op
from sqlalchemy import text

revision = "0021_interest_names"
down_revision = "0020_drop_v01_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.core.interest_names import BUILTIN_NAMES
    op.execute("ALTER TABLE interests ADD COLUMN IF NOT EXISTS names JSONB NOT NULL DEFAULT '{}'::jsonb")
    conn = op.get_bind()
    for slug, names in BUILTIN_NAMES.items():
        conn.execute(text("UPDATE interests SET names = CAST(:n AS jsonb) WHERE slug = :s AND names = '{}'::jsonb"),
                     {"n": json.dumps(names, ensure_ascii=False), "s": slug})


def downgrade() -> None:
    op.execute("ALTER TABLE interests DROP COLUMN IF EXISTS names")
