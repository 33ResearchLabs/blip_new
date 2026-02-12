#!/bin/bash
# ============================================================================
# Quick Railway Migration - Run This Script
# ============================================================================
# This script will guide you through applying the database migration
# ============================================================================

echo "=============================================="
echo "  Railway Database Migration"
echo "=============================================="
echo ""

# Step 1: Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found!"
    echo ""
    echo "Install with: npm i -g @railway/cli"
    exit 1
fi

echo "✅ Railway CLI found"
echo ""

# Step 2: Login
echo "Step 1: Logging in to Railway..."
echo "A browser window will open. Please authorize the CLI."
echo ""
railway login

if [ $? -ne 0 ]; then
    echo "❌ Login failed"
    exit 1
fi

echo ""
echo "✅ Login successful"
echo ""

# Step 3: Link project
echo "Step 2: Linking to your project..."
echo "Please select your Blip Money project from the list."
echo ""
railway link

if [ $? -ne 0 ]; then
    echo "❌ Project linking failed"
    exit 1
fi

echo ""
echo "✅ Project linked"
echo ""

# Step 4: Get DATABASE_URL
echo "Step 3: Getting DATABASE_URL..."
DATABASE_URL=$(railway variables get DATABASE_URL 2>&1)

if [ -z "$DATABASE_URL" ] || [[ "$DATABASE_URL" == *"error"* ]]; then
    echo "❌ Could not get DATABASE_URL"
    echo ""
    echo "Make sure PostgreSQL is added to your Railway project."
    exit 1
fi

echo "✅ DATABASE_URL retrieved"
echo ""

# Step 5: Apply migration
echo "Step 4: Applying migration..."
echo ""

cd "$(dirname "$0")/settle"

if [ ! -f "database/railway-migration.sql" ]; then
    echo "❌ Migration file not found!"
    exit 1
fi

# Use Node.js script to apply migration
node scripts/apply-migration-to-railway.js

if [ $? -eq 0 ]; then
    echo ""
    echo "=============================================="
    echo "✅ ALL DONE!"
    echo "=============================================="
    echo ""
    echo "Your Railway database has been updated."
    echo "The app should work now at app.blip.money"
    echo ""
else
    echo ""
    echo "❌ Migration failed. Check errors above."
    exit 1
fi
