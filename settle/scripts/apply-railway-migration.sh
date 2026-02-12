#!/bin/bash
# ============================================================================
# Apply Railway Database Migration
# ============================================================================
# This script applies all pending migrations to Railway PostgreSQL
#
# Usage:
#   1. Install Railway CLI: npm i -g @railway/cli
#   2. Login: railway login
#   3. Link project: railway link (select your project)
#   4. Run this script: bash settle/scripts/apply-railway-migration.sh
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_FILE="$SCRIPT_DIR/../database/railway-migration.sql"

echo "=================================================="
echo "  Railway Database Migration"
echo "=================================================="
echo ""

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found!"
    echo ""
    echo "Install with: npm i -g @railway/cli"
    echo "Then run: railway login"
    exit 1
fi

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo "❌ Migration file not found: $MIGRATION_FILE"
    exit 1
fi

echo "✅ Railway CLI found"
echo "✅ Migration file found: $MIGRATION_FILE"
echo ""

# Get DATABASE_URL from Railway
echo "📡 Getting DATABASE_URL from Railway..."
DATABASE_URL=$(railway variables get DATABASE_URL 2>/dev/null)

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Could not get DATABASE_URL from Railway"
    echo ""
    echo "Make sure you:"
    echo "  1. Ran 'railway login'"
    echo "  2. Linked to your project with 'railway link'"
    echo "  3. Selected the correct environment"
    exit 1
fi

echo "✅ DATABASE_URL retrieved"
echo ""

# Apply migration using psql
echo "🚀 Applying migration..."
echo ""

if command -v psql &> /dev/null; then
    # Use local psql if available
    psql "$DATABASE_URL" -f "$MIGRATION_FILE"
else
    # Fallback to railway run
    echo "⚠️  psql not found locally, using 'railway run'"
    railway run psql "$DATABASE_URL" -f "$MIGRATION_FILE"
fi

echo ""
echo "=================================================="
echo "✅ Migration applied successfully!"
echo "=================================================="
echo ""
echo "Verify with:"
echo "  railway run psql \$DATABASE_URL -c \"SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('spread_preference', 'protocol_fee_percentage');\""
