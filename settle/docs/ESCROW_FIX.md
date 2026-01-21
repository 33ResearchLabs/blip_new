# Escrow Error Fix - Protocol Config Missing

## Problem
The error "Account not found: protocolConfig" occurred when trying to create escrow trades because the protocol configuration wasn't initialized on-chain.

## Root Cause
The Blip Protocol V2.2 requires a `protocolConfig` account to be initialized before any trades can be created. This account stores:
- Protocol authority
- Treasury wallet for fees
- Fee configuration (fee_bps, max_fee_bps, min_fee_bps)
- Protocol settings (frozen status, version)

## Solution Implemented

### 1. Added Protocol Initialization Functions ([program.ts](settle/src/lib/solana/v2/program.ts:281-324))
- `checkProtocolConfigExists()` - Check if config is already initialized
- `initializeProtocolConfig()` - Initialize the protocol config on-chain

### 2. Automatic Initialization in App ([SolanaWalletContext.tsx](settle/src/context/SolanaWalletContext.tsx:485-517))
- Added `ensureProtocolConfigInitialized()` helper function
- Automatically called before creating any trades
- Uses the connected wallet as authority if needed

### 3. Manual Initialization Script ([init-protocol.ts](settle/scripts/init-protocol.ts))
- Standalone script to initialize protocol config
- Can be run manually if needed

## How to Use

### Option 1: Automatic (Recommended)
The app will now automatically initialize the protocol config when you first try to create a trade. Just:
1. Connect your wallet
2. Try to create an escrow transaction
3. The app will initialize the config if needed (requires one additional transaction approval)

### Option 2: Manual Pre-initialization
Run the initialization script before using the app:

```bash
cd settle
npx ts-node scripts/init-protocol.ts
```

This requires:
- A Solana wallet at `~/.config/solana/id.json` (or update the script to use your wallet)
- SOL for transaction fees (~0.01 SOL)

## Technical Details

### Protocol Config PDA
- **Seeds**: `["protocol-config"]`
- **Program ID**: `6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87`
- **PDA Address**: Derived deterministically from seeds

### Initialization Parameters
- **Authority**: Connected wallet (can be transferred later)
- **Treasury**: `8G55Mg2QmeR5LTz1Ckp8fH2cYh4H3HpLHz2VmFMFKvtB`
- **Fee**: 250 bps (2.5%)
- **Max Fee**: 1000 bps (10%)
- **Min Fee**: 0 bps (0%)

## Files Modified

1. **[program.ts](settle/src/lib/solana/v2/program.ts)**
   - Added `checkProtocolConfigExists()`
   - Added `initializeProtocolConfig()`
   - Updated `buildCreateTradeTx()` to check for config

2. **[index.ts](settle/src/lib/solana/v2/index.ts)**
   - Exported new initialization functions

3. **[SolanaWalletContext.tsx](settle/src/context/SolanaWalletContext.tsx)**
   - Imported initialization functions
   - Added `ensureProtocolConfigInitialized()` helper
   - Updated `createTrade()` to auto-initialize
   - Updated `depositToEscrow()` to auto-initialize

4. **[scripts/init-protocol.ts](settle/scripts/init-protocol.ts)** (NEW)
   - Manual initialization script

## Testing

1. Clear any existing state and refresh the app
2. Connect your Phantom wallet
3. Try to create an escrow transaction
4. You should see logs indicating protocol initialization if needed
5. The escrow transaction should complete successfully

## Troubleshooting

### Error: "Wallet not connected"
- Ensure your wallet is connected before attempting transactions

### Error: "Insufficient SOL balance"
- You need ~0.02 SOL for the initialization transaction + escrow creation
- Get devnet SOL: https://faucet.solana.com/

### Error: "Transaction simulation failed"
- Check that you're on the correct network (Devnet)
- Verify the program is deployed: `6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87`

### Config Already Initialized
If the config is already initialized, you'll see:
```
[SolanaWallet] Protocol config already exists
```
This is normal and expected after the first initialization.

## Next Steps for Production

Before deploying to mainnet:
1. Use a dedicated authority keypair (not user wallets)
2. Consider multi-sig for protocol authority
3. Test fee calculations thoroughly
4. Implement authority transfer mechanism if needed
5. Add monitoring for protocol config state

---

**Status**: ✅ Ready for testing
**Priority**: 🔴 Critical (blocks escrow functionality)
**Tested**: Pending user verification
