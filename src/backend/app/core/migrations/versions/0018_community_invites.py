"""Invitations to a community for people registered in MeetGo (besides the invitation link).

Revision ID: 0018_community_invites
Revises: 0017_names_alias
"""

from alembic import op

revision = "0018_community_invites"
down_revision = "0017_names_alias"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS community_invites (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ)""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_community_invites_conversation_id ON community_invites (conversation_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_community_invites_user_id ON community_invites (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_community_invites_status ON community_invites (status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS community_invites")
