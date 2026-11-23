#!/usr/bin/env sh
set -eu

# Secrets live in .env.local (not tracked). Copy .env.local.example and fill it in first.
if [ ! -f .env.local ]; then
  echo "Missing .env.local: copy .env.local.example to .env.local and set its secrets." >&2
  exit 1
fi

docker compose --env-file .env --env-file .env.local -f docker-compose.yaml down --remove-orphans
docker compose --env-file .env --env-file .env.local -f docker-compose.yaml up -d --build
