"""Community bots and temporary bans: bot accounts (bot-admin, bot-moderator) that are members of every community,
and a ban with an end on community memberships.

Revision ID: 0006_community_bots
Revises: 0005_communities_board
"""

from alembic import op

revision = "0006_community_bots"
down_revision = "0005_communities_board"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_role VARCHAR(16)")
    op.execute("ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS ban_until TIMESTAMPTZ")
    # Every new community gets the bots as members, whoever or whatever creates it.
    op.execute("""
        CREATE OR REPLACE FUNCTION meetgo_add_community_bots() RETURNS trigger AS $$
        BEGIN
          IF NEW.kind = 'channel' THEN
            INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, last_read_message_id, notify,
                                              pinned, hidden, strikes, banned, email_notified_message_id, away)
            SELECT NEW.id, u.id, u.bot_role, now(), 0, 'none', false, false, 0, false, 0, false
            FROM users u WHERE u.bot_role IS NOT NULL
            ON CONFLICT DO NOTHING;
          END IF;
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql
    """)
    op.execute("DROP TRIGGER IF EXISTS meetgo_community_bots ON conversations")
    op.execute("CREATE TRIGGER meetgo_community_bots AFTER INSERT ON conversations "
               "FOR EACH ROW EXECUTE FUNCTION meetgo_add_community_bots()")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS meetgo_community_bots ON conversations")
    op.execute("DROP FUNCTION IF EXISTS meetgo_add_community_bots()")
    op.execute("ALTER TABLE conversation_members DROP COLUMN IF EXISTS ban_until")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS bot_role")
