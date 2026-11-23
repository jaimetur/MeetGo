#!/usr/bin/env sh
# Builds and starts MeetGo (from any folder). Secrets live in docker/.env.local (not tracked):
# copy docker/.env.local.example and fill it in first.
set -eu
cd "$(dirname "$0")"

if [ ! -f .env.local ]; then
  echo "Missing docker/.env.local: copy docker/.env.local.example to docker/.env.local and set its secrets." >&2
  exit 1
fi

docker compose --env-file .env --env-file .env.local -f compose.yml down --remove-orphans
docker compose --env-file .env --env-file .env.local -f compose.yml up -d --build
