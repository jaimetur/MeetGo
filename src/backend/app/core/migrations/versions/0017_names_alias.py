"""First name and surname(s) for everyone, and the display name as a unique one-word alias.

Revision ID: 0017_names_alias
Revises: 0016_visits

The current name is split: its first word is the first name and the rest the surnames (empty when there is only one
word: the app asks for them). The alias is the name without spaces or other signs, made unique with the account
number when two would be equal; anyone can change it.
"""

from alembic import op

revision = "0017_names_alias"
down_revision = "0016_visits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(64)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(96)")
    op.execute("""
        UPDATE users SET
            first_name = split_part(btrim(display_name), ' ', 1),
            last_name = nullif(btrim(substr(btrim(display_name), length(split_part(btrim(display_name), ' ', 1)) + 1)), '')
        WHERE bot_role IS NULL AND first_name IS NULL""")
    # one word: only letters, digits, "_" and "." (at least 3)
    op.execute(r"""
        UPDATE users SET display_name = left(regexp_replace(display_name, '[^[:alnum:]_.]', '', 'g'), 30)
        WHERE bot_role IS NULL AND display_name !~ '^[[:alnum:]_][[:alnum:]_.]{2,29}$'""")
    op.execute(r"""
        UPDATE users SET display_name = 'user' || id
        WHERE bot_role IS NULL AND display_name !~ '^[[:alnum:]_][[:alnum:]_.]{2,29}$'""")
    op.execute("""
        UPDATE users u SET display_name = left(u.display_name, 24) || u.id
        WHERE EXISTS (SELECT 1 FROM users o WHERE lower(o.display_name) = lower(u.display_name) AND o.id < u.id)""")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_alias ON users (lower(display_name))")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_users_alias")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_name")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS first_name")
