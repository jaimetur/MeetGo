"""Logs of the calls to the API (30 days), for the administration.

Revision ID: 0026_request_logs
Revises: 0025_geo_levels
"""

from alembic import op

revision = "0026_request_logs"
down_revision = "0025_geo_levels"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE TABLE IF NOT EXISTS request_logs (
        id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), user_id INTEGER, method VARCHAR(8) NOT NULL,
        path VARCHAR(300) NOT NULL, status INTEGER NOT NULL, ms INTEGER NOT NULL DEFAULT 0, kind VARCHAR(16) NOT NULL,
        ip VARCHAR(64), agent VARCHAR(300))""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_request_logs_at ON request_logs (at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_request_logs_user_id ON request_logs (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_request_logs_status ON request_logs (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_request_logs_kind ON request_logs (kind)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS request_logs")
