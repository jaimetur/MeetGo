#!/usr/bin/env sh
set -eu

docker compose logs -f --tail=200 app web_user web_admin
