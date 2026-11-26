"""Categories of communities in the database (editable, named in every language), the category of each community made by
people, and the categories people propose.

Revision ID: 0024_categories
Revises: 0023_cover_art
"""

from alembic import op

revision = "0024_categories"
down_revision = "0023_cover_art"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS categories (
        key VARCHAR(48) PRIMARY KEY, names JSONB NOT NULL DEFAULT '{}'::jsonb, icon VARCHAR(32), color VARCHAR(16),
        position INTEGER NOT NULL DEFAULT 100, builtin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
    op.execute("""CREATE TABLE IF NOT EXISTS category_proposals (
        id SERIAL PRIMARY KEY, name VARCHAR(60) NOT NULL, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending',
        category_key VARCHAR(48), created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS category_key VARCHAR(48)")


def downgrade() -> None:
    op.execute("ALTER TABLE conversations DROP COLUMN IF EXISTS category_key")
    op.execute("DROP TABLE IF EXISTS category_proposals")
    op.execute("DROP TABLE IF EXISTS categories")
