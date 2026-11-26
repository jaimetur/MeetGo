"""Everyone's wall (posts with photos or a video, reactions, comments, shares, saved posts) and stories of 24 hours.

Revision ID: 0027_feed_stories
Revises: 0026_request_logs
"""

from alembic import op

revision = "0027_feed_stories"
down_revision = "0026_request_logs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS feed_posts (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL DEFAULT '', audience VARCHAR(16) NOT NULL DEFAULT 'friends', place VARCHAR(120),
        province VARCHAR(64), mentions JSONB NOT NULL DEFAULT '[]',
        shared_from_id INTEGER REFERENCES feed_posts(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), edited_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_feed_posts_user_id ON feed_posts (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_feed_posts_created_at ON feed_posts (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_feed_posts_shared_from_id ON feed_posts (shared_from_id)")
    op.execute("""CREATE TABLE IF NOT EXISTS feed_reactions (
        post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, emoji VARCHAR(32) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (post_id, user_id))""")
    op.execute("""CREATE TABLE IF NOT EXISTS feed_comments (
        id SERIAL PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id INTEGER REFERENCES feed_comments(id) ON DELETE CASCADE, body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_feed_comments_post_id ON feed_comments (post_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_feed_comments_user_id ON feed_comments (user_id)")
    op.execute("""CREATE TABLE IF NOT EXISTS feed_saves (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, post_id))""")
    op.execute("""CREATE TABLE IF NOT EXISTS stories (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind VARCHAR(8) NOT NULL, text TEXT NOT NULL DEFAULT '', bg VARCHAR(32),
        audience VARCHAR(16) NOT NULL DEFAULT 'friends', province VARCHAR(64), hidden_from JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stories_user_id ON stories (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stories_created_at ON stories (created_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_stories_expires_at ON stories (expires_at)")
    op.execute("""CREATE TABLE IF NOT EXISTS story_views (
        story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(), reaction VARCHAR(32), PRIMARY KEY (story_id, user_id))""")
    op.execute("ALTER TABLE attachments ADD COLUMN IF NOT EXISTS feed_post_id INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE attachments ADD COLUMN IF NOT EXISTS story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE")
    op.execute("CREATE INDEX IF NOT EXISTS ix_attachments_feed_post_id ON attachments (feed_post_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_attachments_story_id ON attachments (story_id)")
    op.execute("ALTER TABLE reports ADD COLUMN IF NOT EXISTS feed_post_id INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE")
    op.execute("CREATE INDEX IF NOT EXISTS ix_reports_feed_post_id ON reports (feed_post_id)")
    # the old text posts of the «Activity» tab move to the wall, for whoever follows their author
    op.execute("""INSERT INTO feed_posts (user_id, body, audience, created_at)
        SELECT user_id, content, 'followers', created_at FROM posts
        WHERE NOT EXISTS (SELECT 1 FROM feed_posts LIMIT 1)""")


def downgrade() -> None:
    op.execute("ALTER TABLE reports DROP COLUMN IF EXISTS feed_post_id")
    op.execute("ALTER TABLE attachments DROP COLUMN IF EXISTS story_id")
    op.execute("ALTER TABLE attachments DROP COLUMN IF EXISTS feed_post_id")
    for table in ("story_views", "stories", "feed_saves", "feed_comments", "feed_reactions", "feed_posts"):
        op.execute(f"DROP TABLE IF EXISTS {table}")
