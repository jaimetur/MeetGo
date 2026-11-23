# Tests

One folder per module: `auth`, `social`, `messaging`, `moderation`, `realtime`, `push`, `emails`,
`billing`, `admin`, `api` and `migrations`. Shared fixtures are in `conftest.py` and `helpers.py`.

The tests need a throwaway PostgreSQL and Redis. With Docker:

```bash
docker run -d --name meetgo-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=meetgo_test -p 55432:5432 postgres:16
docker run -d --name meetgo-test-redis -p 56379:6379 redis:7
```

Then, from the repository root (the settings are in `pytest.ini`):

```bash
.venv/bin/python -m pip install -e ".[dev]"
.venv/bin/python -m pytest
.venv/bin/python -m pytest tests/emails   # one module
```

Every test drops and recreates the `public` schema of that database, so never point
`DATABASE_URL` at real data.
