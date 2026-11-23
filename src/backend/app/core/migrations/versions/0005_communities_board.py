"""Communities and board: access and board modes, away memberships, join requests, board posts with attendees and
comments, and reports of board posts.

Revision ID: 0005_communities_board
Revises: 0004_email_notifications
"""

from alembic import op
import sqlalchemy as sa

revision = "0005_communities_board"
down_revision = "0004_email_notifications"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS access_mode VARCHAR(16) NOT NULL DEFAULT 'open'")
    op.execute("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS board_mode VARCHAR(16) NOT NULL DEFAULT 'open'")
    op.execute("ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS away BOOLEAN NOT NULL DEFAULT false")

    op.create_table(
        "community_requests",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("conversation_id", sa.Integer, sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", sa.String(16), server_default="pending", nullable=False, index=True),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", TS),
        sa.Column("resolved_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
    )
    op.create_table(
        "board_posts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("conversation_id", sa.Integer, sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), index=True),
        sa.Column("kind", sa.String(16), nullable=False, index=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("body", sa.Text, server_default="", nullable=False),
        sa.Column("starts_at", TS, index=True),
        sa.Column("ends_at", TS),
        sa.Column("place", sa.String(200)),
        sa.Column("place_url", sa.String(512)),
        sa.Column("capacity", sa.Integer),
        sa.Column("link_url", sa.String(512)),
        sa.Column("cover_attachment_id", sa.Integer, sa.ForeignKey("attachments.id", ondelete="SET NULL")),
        sa.Column("comments_mode", sa.String(16), server_default="all", nullable=False),
        sa.Column("join_mode", sa.String(16), server_default="open", nullable=False),
        sa.Column("pinned", sa.Boolean, server_default=sa.false(), nullable=False),
        sa.Column("closed", sa.Boolean, server_default=sa.false(), nullable=False),
        sa.Column("chat_conversation_id", sa.Integer, sa.ForeignKey("conversations.id", ondelete="SET NULL")),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", TS),
    )
    op.create_table(
        "board_attendees",
        sa.Column("post_id", sa.Integer, sa.ForeignKey("board_posts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "board_comments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("post_id", sa.Integer, sa.ForeignKey("board_posts.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("author_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    # Reports can point at a board post instead of a message.
    op.alter_column("reports", "message_id", nullable=True)
    op.add_column("reports", sa.Column("post_id", sa.Integer, sa.ForeignKey("board_posts.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_reports_post_id", "reports", ["post_id"])
    op.create_unique_constraint("uq_report_post_once", "reports", ["post_id", "reporter_id"])


def downgrade() -> None:
    op.drop_constraint("uq_report_post_once", "reports")
    op.drop_index("ix_reports_post_id", "reports")
    op.drop_column("reports", "post_id")
    op.execute("DELETE FROM reports WHERE message_id IS NULL")
    op.alter_column("reports", "message_id", nullable=False)
    for table in ("board_comments", "board_attendees", "board_posts", "community_requests"):
        op.drop_table(table)
    op.execute("ALTER TABLE conversation_members DROP COLUMN IF EXISTS away")
    for column in ("board_mode", "access_mode"):
        op.execute(f"ALTER TABLE conversations DROP COLUMN IF EXISTS {column}")
