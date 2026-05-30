#!/bin/bash
set -e

echo "🚀 Deploying Blip Protocol v2 to Devnet"
echo "========================================"

# Navigate to project root
cd "$(dirname "$0")/.."

# Build program
echo "📦 Building program..."
anchor build

# Get program ID from keypair
PROGRAM_KEYPAIR="target/deploy/blip_protocol_v2-keypair.json"

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
  echo "❌ Program keypair not found at $PROGRAM_KEYPAIR"
  exit 1
fi

PROGRAM_ID=$(solana address -k "$PROGRAM_KEYPAIR")
echo "📍 Program ID: $PROGRAM_ID"

# Update lib.rs with actual program ID
echo "✏️  Updating declare_id! in lib.rs..."
sed -i.bak "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" programs/blip_protocol_v2/src/lib.rs
rm programs/blip_protocol_v2/src/lib.rs.bak

# Update Anchor.toml
echo "✏️  Updating Anchor.toml..."
sed -i.bak "s/blip_protocol_v2 = \".*\"/blip_protocol_v2 = \"$PROGRAM_ID\"/" Anchor.toml
rm Anchor.toml.bak

# Rebuild with correct program ID
echo "📦 Rebuilding with correct program ID..."
anchor build

# Deploy
echo "🌐 Deploying to devnet..."
anchor deploy --provider.cluster devnet

echo ""
echo "✅ Deployment complete!"
echo "Program ID: $PROGRAM_ID"
echo ""
echo "Next steps:"
echo "1. Run: npm run init-config"
echo "2. Run: npm run smoke-test"
