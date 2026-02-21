#!/usr/bin/env sh
set -eu

docker compose -f docker-compose.yaml down --remove-orphans
docker compose -f docker-compose.yaml up -d --build
