#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"

docker compose --env-file .env --env-file .env.local -f compose.yml logs -f --tail=200 app web_user web_admin
