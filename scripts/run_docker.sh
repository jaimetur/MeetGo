#!/usr/bin/env sh
set -eu

docker compose up -d --force-recreate web backend admin
docker compose logs -f --tail=200 web backend admin

