#!/usr/bin/env bash
# Apply schema + all migrations to the CI database.
# Requires DATABASE_URL in the environment.
#
# Usage: bash scripts/migrate-ci.sh
#        pnpm db:migrate:ci

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Error: DATABASE_URL is not set" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SCHEMA="$REPO_ROOT/settle/database/schema.sql"
MIGRATIONS_DIR="$REPO_ROOT/settle/database/migrations"

echo "▶ Applying base schema..."
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$SCHEMA"

echo "▶ Applying migrations..."
# Sort numerically by filename (001_, 002_, …) then apply in order
for f in $(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort); do
  echo "  $(basename "$f")"
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "✓ Database ready"
