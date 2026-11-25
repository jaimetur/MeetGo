"""When each delivered / read tick moved, for the message's Info.

Revision ID: 0015_receipt_times
Revises: 0014_interest_tags
"""

from alembic import op

revision = "0015_receipt_times"
down_revision = "0014_interest_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS receipt_marks (
        id BIGSERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind VARCHAR(10) NOT NULL,
        message_id BIGINT NOT NULL,
        at TIMESTAMPTZ NOT NULL DEFAULT now())""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_receipt_marks_lookup ON receipt_marks (conversation_id, user_id, kind, message_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS receipt_marks")
