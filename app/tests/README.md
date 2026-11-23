# Backend tests

The tests need a throwaway PostgreSQL and Redis. With Docker:

```bash
docker run -d --name meetgo-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=meetgo_test -p 55432:5432 postgres:16
docker run -d --name meetgo-test-redis -p 56379:6379 redis:7
```

Then, from `app/`:

```bash
../.venv/bin/python -m pip install -e ".[dev]"
../.venv/bin/python -m pytest
```

Every test drops and recreates the `public` schema of that database, so never point
`DATABASE_URL` at real data.
