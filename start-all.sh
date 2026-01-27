#!/bin/bash

echo "🚀 Starting all Blip Money services..."
echo ""

# Kill existing processes
echo "🛑 Stopping any existing services..."
pkill -f "next dev" 2>/dev/null
sleep 2

# Start BlipScan Indexer
echo "📡 Starting BlipScan Indexer..."
cd /Users/zeus/Documents/Vscode/BM/blipscan/indexer
npm run dev > /tmp/blipscan-indexer.log 2>&1 &
INDEXER_PID=$!
echo "   PID: $INDEXER_PID"

# Start BlipScan Web UI
echo "🌐 Starting BlipScan Web UI..."
cd /Users/zeus/Documents/Vscode/BM/blipscan/web
npm run dev > /tmp/blipscan-web.log 2>&1 &
WEB_PID=$!
echo "   PID: $WEB_PID"

# Start Blip Money App
echo "💰 Starting Blip Money App..."
cd /Users/zeus/Documents/Vscode/BM/settle
npm run dev > /tmp/blip-money.log 2>&1 &
APP_PID=$!
echo "   PID: $APP_PID"

echo ""
echo "⏳ Waiting for services to start..."
sleep 10

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All services started!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📱 URLs:"
echo "   Main App:      http://localhost:3000"
echo "   Merchant:      http://localhost:3000/merchant"
echo "   Compliance:    http://localhost:3000/compliance"
echo "   BlipScan:      http://localhost:3001"
echo ""
echo "🔧 Process IDs:"
echo "   BlipScan Indexer: $INDEXER_PID"
echo "   BlipScan Web UI:  $WEB_PID"
echo "   Blip Money App:   $APP_PID"
echo ""
echo "📋 View logs:"
echo "   tail -f /tmp/blip-money.log"
echo "   tail -f /tmp/blipscan-indexer.log"
echo "   tail -f /tmp/blipscan-web.log"
echo ""
echo "🛑 To stop all services:"
echo "   pkill -f \"next dev\""
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
