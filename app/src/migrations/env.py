from alembic import context

connection = context.config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Run migrations through src.migrate.run_migrations().")

context.configure(connection=connection, target_metadata=None)
with context.begin_transaction():
    context.run_migrations()
