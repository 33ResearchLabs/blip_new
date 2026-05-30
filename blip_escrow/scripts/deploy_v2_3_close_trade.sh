#!/usr/bin/env bash
#
# Deploy the v2.3 upgrade that adds `close_trade` to blip_protocol_v2.
# Run with the program upgrade authority keypair already configured:
#
#   solana config set --keypair /path/to/upgrade-authority.json
#   solana config set --url mainnet-beta
#   bash scripts/deploy_v2_3_close_trade.sh
#
# Pre-flight: the current authority is
#   6yU8cbxm3teKJHNyAgZxTtxvJmPBhvwVyWBoA9xzeCRZ
# Confirm `solana address` matches that. Otherwise the upgrade aborts.

set -euo pipefail

PROGRAM_ID="gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS"
EXPECTED_AUTHORITY="6yU8cbxm3teKJHNyAgZxTtxvJmPBhvwVyWBoA9xzeCRZ"
SO_PATH="target/deploy/blip_protocol_v2.so"

echo "==> Pre-flight checks"
CURRENT=$(solana address)
echo "    Current signer: $CURRENT"
if [[ "$CURRENT" != "$EXPECTED_AUTHORITY" ]]; then
  echo "    ERROR: configured keypair is not the program upgrade authority."
  echo "    Expected: $EXPECTED_AUTHORITY"
  exit 1
fi

URL=$(solana config get | awk '/RPC URL/ { print $NF }')
echo "    RPC: $URL"
if [[ "$URL" != *"mainnet"* ]]; then
  read -p "    RPC isn't mainnet. Continue anyway? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || exit 1
fi

if [[ ! -f "$SO_PATH" ]]; then
  echo "    Building program..."
  anchor build
fi

echo "==> Pre-deploy program info"
solana program show "$PROGRAM_ID" --url "$URL" | head -10

echo
echo "==> Estimating SOL needed"
SIZE=$(stat -f%z "$SO_PATH" 2>/dev/null || stat -c%s "$SO_PATH")
EXPECTED_LAMPORTS=$((SIZE * 2 + 1000000))
echo "    .so size: ${SIZE} bytes (~$((EXPECTED_LAMPORTS / 1000000000)) SOL for buffer rent + fees)"
BALANCE=$(solana balance --lamports | awk '{print $1}')
echo "    Wallet balance: ${BALANCE} lamports"
if (( BALANCE < EXPECTED_LAMPORTS )); then
  echo "    WARNING: balance may be insufficient. Fund the wallet and retry."
  exit 1
fi

echo
read -p "==> Deploy program upgrade now? [y/N] " confirm
[[ "$confirm" == "y" || "$confirm" == "Y" ]] || { echo "Aborted."; exit 0; }

echo "==> Deploying..."
anchor upgrade "$SO_PATH" --program-id "$PROGRAM_ID" --provider.cluster "$URL"

echo
echo "==> Post-deploy verification"
solana program show "$PROGRAM_ID" --url "$URL" | head -10

echo
echo "==> Done. The deployed binary now includes:"
echo "    - close_trade (new instruction — close terminal Trade PDAs)"
echo "    - release_escrow / refund_escrow now close Trade PDA automatically"
echo "      via close = depositor (was in source but never deployed before)"
echo
echo "==> Next step: copy target/idl/blip_protocol_v2.json into the settle"
echo "    repo to expose close_trade to the TS client, then run"
echo "    scripts/sweep_terminal_trades.ts to reclaim rent from existing"
echo "    stuck PDAs."
