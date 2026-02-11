#!/usr/bin/env sh
set -eu

docker compose up -d --force-recreate backend web admin
docker compose logs -f --tail=200 backend web admin

