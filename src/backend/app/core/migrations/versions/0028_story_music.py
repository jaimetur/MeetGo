"""Stories with the text anywhere, styles, stickers and filters, and music from a library of songs.

Revision ID: 0028_story_music
Revises: 0027_feed_stories
"""

from alembic import op

revision = "0028_story_music"
down_revision = "0027_feed_stories"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE stories ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'")
    op.execute("ALTER TABLE stories ADD COLUMN IF NOT EXISTS music JSONB")
    op.execute("""CREATE TABLE IF NOT EXISTS music_tracks (
        id SERIAL PRIMARY KEY, key VARCHAR(64) NOT NULL UNIQUE, kind VARCHAR(16) NOT NULL DEFAULT 'classic',
        mood VARCHAR(24), title VARCHAR(160) NOT NULL, artist VARCHAR(160) NOT NULL DEFAULT '',
        performer VARCHAR(200) NOT NULL DEFAULT '', file VARCHAR(200) NOT NULL, duration INTEGER NOT NULL DEFAULT 30,
        license VARCHAR(64) NOT NULL DEFAULT '', license_url VARCHAR(300), source_url VARCHAR(400),
        builtin BOOLEAN NOT NULL DEFAULT false, active BOOLEAN NOT NULL DEFAULT true, position INTEGER NOT NULL DEFAULT 500,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS music_tracks")
    op.execute("ALTER TABLE stories DROP COLUMN IF EXISTS music")
    op.execute("ALTER TABLE stories DROP COLUMN IF EXISTS layout")
