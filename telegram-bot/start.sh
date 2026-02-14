#!/bin/bash

# Blip Money Telegram Bot Starter
echo "🤖 Starting Blip Money Telegram Bot..."
echo ""

# Source nvm if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo ""
fi

# Check if backend is running
if ! curl -s http://localhost:3000/api >/dev/null 2>&1; then
  echo "⚠️  WARNING: Backend not responding on port 3000"
  echo ""
  echo "Please start the backend first:"
  echo "  cd settle && npm run dev"
  echo ""
  read -p "Continue anyway? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "✅ Starting bot..."
echo "📡 API: http://localhost:3000/api"
echo "🧠 AI: Claude 3.5 Haiku"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start the bot
node bot.js
