"""Age ranges 18-30, 31-60 and 61+ (were 18-30, 31-50 and 51+).

Communities of 31-50 become 31-60 and those of 51+ become 61+. People aged 51 to 60 who were in a 61+ interest
community join its 31-60 twin (created if missing) and keep the old membership as away, as when someone changes zone.

Revision ID: 0008_age_ranges
Revises: 0007_user_blocks
"""

from alembic import op

revision = "0008_age_ranges"
down_revision = "0007_user_blocks"
branch_labels = None
depends_on = None

AGE = "date_part('year', age(current_date, u.dob::date))"
VALID_DOB = "u.dob ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'"
# memberships of people aged 60 or less in a 61+ interest community
MOVING = f"""conversation_members m JOIN conversations c ON c.id = m.conversation_id JOIN users u ON u.id = m.user_id
    WHERE c.kind = 'channel' AND c.age_range = '61_plus' AND c.interest_id IS NOT NULL AND NOT m.away
      AND {VALID_DOB} AND {AGE} <= 60"""


def upgrade() -> None:
    # New values of the users' age range type (usable once this commits: the users are updated at startup, see seed).
    for value in ("31_60", "61_plus"):
        op.execute(f"ALTER TYPE agerange ADD VALUE IF NOT EXISTS '{value}'")
    op.execute("UPDATE conversations SET age_range = '31_60' WHERE age_range = '31_50'")
    op.execute("UPDATE conversations SET age_range = '61_plus' WHERE age_range = '51_plus'")
    op.execute(f"""
        INSERT INTO conversations (kind, province, age_range, interest_id, created_at)
        SELECT DISTINCT 'channel', c.province, '31_60', c.interest_id, now() FROM {MOVING}
        ON CONFLICT ON CONSTRAINT uq_channel_key DO NOTHING""")
    op.execute(f"""
        INSERT INTO conversation_members (conversation_id, user_id, role, notify, last_read_message_id)
        SELECT t.id, m.user_id, CASE WHEN m.role = 'owner' THEN 'member' ELSE m.role END, m.notify, coalesce(t.last_message_id, 0)
        FROM {MOVING.replace('WHERE', "JOIN conversations t ON t.kind = 'channel' AND t.province = c.province AND t.age_range = '31_60' AND t.interest_id = c.interest_id WHERE", 1)}
        ON CONFLICT (conversation_id, user_id) DO UPDATE SET away = false""")
    op.execute(f"""
        UPDATE conversation_members SET away = true WHERE (conversation_id, user_id) IN (
            SELECT m.conversation_id, m.user_id FROM {MOVING})""")
    op.execute("""
        UPDATE app_settings SET data = jsonb_set(data::jsonb, '{age_ranges}', '[
            {"key": "18_30", "label": "18-30", "min": 18, "max": 30},
            {"key": "31_60", "label": "31-60", "min": 31, "max": 60},
            {"key": "61_plus", "label": "61+", "min": 61, "max": null}]'::jsonb)::json
        WHERE data IS NOT NULL AND (data::jsonb) ? 'age_ranges'""")


def downgrade() -> None:
    op.execute("UPDATE conversations SET age_range = '31_50' WHERE age_range = '31_60'")
    op.execute("UPDATE conversations SET age_range = '51_plus' WHERE age_range = '61_plus'")
