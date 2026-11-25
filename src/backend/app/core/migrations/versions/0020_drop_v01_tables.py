"""The version 0.1 tables (rooms and direct messages), kept for safety after 0002 moved their data into conversations
and messages, go away.

Revision ID: 0020_drop_v01_tables
Revises: 0019_community_filters
"""

from alembic import op

revision = "0020_drop_v01_tables"
down_revision = "0019_community_filters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("room_discipline", "room_rules", "room_messages", "rooms", "dm_messages", "dm_conversations"):
        op.execute(f"DROP TABLE IF EXISTS {table}")


def downgrade() -> None:
    pass  # their data lives on in conversations and messages; the old tables are not rebuilt
