"""Plans like Meetup: online/hybrid, companions, series, co-organisers, check-in and ratings; join questions; age spans
of people's communities; the personal calendar feed.

Revision ID: 0011_plans_meetup
Revises: 0010_interest_settings
"""

from alembic import op

revision = "0011_plans_meetup"
down_revision = "0010_interest_settings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS board_series (
            id SERIAL PRIMARY KEY,
            conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            freq VARCHAR(16) NOT NULL,
            tz VARCHAR(64) NOT NULL DEFAULT 'Europe/Madrid',
            first_starts_at TIMESTAMPTZ NOT NULL,
            until TIMESTAMPTZ,
            template JSONB NOT NULL DEFAULT '{}'::jsonb,
            ended BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_board_series_conversation_id ON board_series (conversation_id)")
    for sql in (
        "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'in_person'",
        "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS online_url VARCHAR(512)",
        "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS max_guests INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS series_id INTEGER REFERENCES board_series(id) ON DELETE SET NULL",
        "ALTER TABLE board_posts ADD COLUMN IF NOT EXISTS cohost_ids JSONB NOT NULL DEFAULT '[]'::jsonb",
        "CREATE INDEX IF NOT EXISTS ix_board_posts_series_id ON board_posts (series_id)",
        "ALTER TABLE board_attendees ADD COLUMN IF NOT EXISTS guests INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE board_attendees ADD COLUMN IF NOT EXISTS attended BOOLEAN",
        "ALTER TABLE board_attendees ADD COLUMN IF NOT EXISTS rating INTEGER",
        "ALTER TABLE board_attendees ADD COLUMN IF NOT EXISTS rating_note TEXT",
        "ALTER TABLE community_requests ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS min_age INTEGER",
        "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS max_age INTEGER",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token VARCHAR(64) UNIQUE",
    ):
        op.execute(sql)


def downgrade() -> None:
    for sql in (
        "ALTER TABLE users DROP COLUMN IF EXISTS calendar_token",
        "ALTER TABLE conversations DROP COLUMN IF EXISTS max_age",
        "ALTER TABLE conversations DROP COLUMN IF EXISTS min_age",
        "ALTER TABLE community_requests DROP COLUMN IF EXISTS answers",
        "ALTER TABLE board_attendees DROP COLUMN IF EXISTS rating_note",
        "ALTER TABLE board_attendees DROP COLUMN IF EXISTS rating",
        "ALTER TABLE board_attendees DROP COLUMN IF EXISTS attended",
        "ALTER TABLE board_attendees DROP COLUMN IF EXISTS guests",
        "ALTER TABLE board_posts DROP COLUMN IF EXISTS cohost_ids",
        "ALTER TABLE board_posts DROP COLUMN IF EXISTS series_id",
        "ALTER TABLE board_posts DROP COLUMN IF EXISTS max_guests",
        "ALTER TABLE board_posts DROP COLUMN IF EXISTS online_url",
        "ALTER TABLE board_posts DROP COLUMN IF EXISTS mode",
        "DROP TABLE IF EXISTS board_series",
    ):
        op.execute(sql)
