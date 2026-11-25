"""Community filters the creator can change: the geographic scope (province, group of provinces or country) and who
was expelled when they changed (read-only history).

Revision ID: 0019_community_filters
Revises: 0018_community_invites
"""

from alembic import op

revision = "0019_community_filters"
down_revision = "0018_community_invites"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS scope_kind VARCHAR(16)")
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS scope_value VARCHAR(64)")
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS scope_label VARCHAR(96)")
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS scope_provinces JSONB")
    op.execute("CREATE INDEX IF NOT EXISTS ix_conversations_scope_provinces ON conversations USING gin (scope_provinces)")
    op.execute("ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS expelled_message_id BIGINT")


def downgrade() -> None:
    op.execute("ALTER TABLE conversation_members DROP COLUMN IF EXISTS expelled_message_id")
    op.execute("DROP INDEX IF EXISTS ix_conversations_scope_provinces")
    for col in ("scope_provinces", "scope_label", "scope_value", "scope_kind"):
        op.execute(f"ALTER TABLE conversations DROP COLUMN IF EXISTS {col}")
