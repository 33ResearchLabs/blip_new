#!/bin/bash

# Quick Fix Script for HMR Issues
# Run this if you get module errors

echo "🔧 Quick Fix for Module Errors"
echo "================================"
echo ""

# Kill all Next.js processes
echo "1. Stopping all Next.js processes..."
pkill -9 -f "next" 2>/dev/null
sleep 1
echo "   ✓ Done"

# Clear all caches
echo "2. Clearing all caches..."
rm -rf .next
rm -rf .turbopack 2>/dev/null
rm -rf node_modules/.cache 2>/dev/null
echo "   ✓ Done"

# Start dev server
echo "3. Starting fresh dev server..."
echo ""
npm run dev &

# Wait for server
echo ""
echo "⏳ Waiting for server to start (this takes ~15 seconds)..."
sleep 15

# Check if running
if lsof -i :3000 2>/dev/null | grep -q LISTEN; then
    echo ""
    echo "✅ SUCCESS! Server is running on http://localhost:3000"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Open http://localhost:3000 in your browser"
    echo "   2. Press Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows) to hard refresh"
    echo "   3. If you still see errors, close ALL browser tabs and reopen"
    echo ""
else
    echo ""
    echo "⏳ Server is still starting... Give it 10 more seconds"
    echo "   Then open http://localhost:3000"
    echo ""
fi
