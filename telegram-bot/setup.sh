#!/bin/bash

echo "🤖 Blip Money Telegram Bot Setup"
echo "================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js 18+ from https://nodejs.org"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file..."
    cp .env.example .env

    echo ""
    echo "⚠️  IMPORTANT: Please configure your .env file:"
    echo ""
    echo "1. Get Telegram Bot Token:"
    echo "   - Open Telegram and message @BotFather"
    echo "   - Send: /newbot"
    echo "   - Follow instructions to create your bot"
    echo "   - Copy the token"
    echo ""
    echo "2. Get Anthropic API Key:"
    echo "   - Go to: https://console.anthropic.com"
    echo "   - Create account (free $5 credits)"
    echo "   - Generate API key"
    echo "   - Copy the key"
    echo ""
    echo "3. Edit .env file:"
    echo "   nano .env"
    echo ""
    echo "   Add:"
    echo "   BOT_TOKEN=your_telegram_bot_token"
    echo "   ANTHROPIC_API_KEY=sk-ant-your_key"
    echo ""
else
    echo "✅ .env file already exists"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Make sure Blip Money backend is running: cd ../settle && npm run dev"
echo "2. Configure .env file with your tokens"
echo "3. Start the bot: npm start"
echo ""
echo "For development with auto-reload: npm run dev"
echo ""
