"""Subscriptions: Stripe, Google Play, free-access grants and promotional codes.

Seeds the launch campaign: one year free for the first 50 accounts.

Revision ID: 0003_subscriptions
Revises: 0002_messaging
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003_subscriptions"
down_revision = "0002_messaging"
branch_labels = None
depends_on = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS access_required BOOLEAN NOT NULL DEFAULT FALSE")
    op.create_table(
        "promo_codes",
        sa.Column("code", sa.String(64), primary_key=True),
        sa.Column("aliases", JSONB, server_default="[]", nullable=False),
        sa.Column("duration", sa.String(16), server_default="1y", nullable=False),
        sa.Column("max_uses", sa.Integer),
        sa.Column("used", sa.Integer, server_default="0", nullable=False),
        sa.Column("public", sa.Boolean, server_default=sa.false(), nullable=False),
        sa.Column("expires_on", sa.String(10)),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "access_grants",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("source", sa.String(64), nullable=False),
        sa.Column("until", TS),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "stripe_subscriptions",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("customer_id", sa.String(64), nullable=False),
        sa.Column("subscription_id", sa.String(64), unique=True, nullable=False),
        sa.Column("plan", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("period_end", TS),
        sa.Column("cancel_at_period_end", sa.Boolean, server_default=sa.false(), nullable=False),
        sa.Column("updated_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "play_subscriptions",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("token_hash", sa.String(64), unique=True, nullable=False),
        sa.Column("token_enc", sa.Text, nullable=False),
        sa.Column("product_id", sa.String(64), nullable=False),
        sa.Column("base_plan", sa.String(32)),
        sa.Column("state", sa.String(48), nullable=False),
        sa.Column("expiry", TS),
        sa.Column("checked_at", TS, server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", TS, server_default=sa.func.now(), nullable=False),
    )
    op.execute("""
        INSERT INTO promo_codes (code, aliases, duration, max_uses, used, public)
        VALUES ('LANZAMIENTO', '["MEETGO50"]', '1y', 50, 0, true)
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    for table in ("play_subscriptions", "stripe_subscriptions", "access_grants", "promo_codes"):
        op.drop_table(table)
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS access_required")
