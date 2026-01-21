# Blip Protocol V2.2 Escrow Setup Guide

This guide covers the IDL configuration required to interact with the Blip Protocol V2.2 on-chain escrow system.

## Program Details

- **Program ID**: `6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87`
- **Network**: Solana Devnet
- **Anchor Version**: 0.32.x

## IDL Configuration

### Anchor 0.30+ Compatibility

The IDL must use the **new Anchor 0.30+ format**. Key differences from older formats:

#### 1. Type References

Old format (Anchor < 0.30):
```json
{ "name": "side", "type": { "defined": "TradeSide" } }
```

New format (Anchor 0.30+):
```json
{ "name": "side", "type": { "defined": { "name": "TradeSide" } } }
```

#### 2. PublicKey Type

Old format:
```json
{ "name": "creator", "type": "publicKey" }
```

New format:
```json
{ "name": "creator", "type": "pubkey" }
```

#### 3. Instruction Arguments

Arguments must be **flattened** (passed individually), not wrapped in a params struct:

```typescript
// Correct - flattened args
program.methods.createTrade(tradeId, amount, sideEnum)

// Incorrect - params struct
program.methods.createTrade({ tradeId, amount, side })
```

## PDA Seeds

All PDAs use `-v2` suffixes to differentiate from V1:

| PDA | Seeds |
|-----|-------|
| Trade | `["trade-v2", creator, trade_id]` |
| Escrow | `["escrow-v2", trade_pda]` |
| Vault Authority | `["vault-authority-v2", escrow_pda]` |
| Lane | `["lane-v2", merchant, lane_id]` |
| Lane Vault Authority | `["lane-vault-authority-v2", lane_pda]` |
| Protocol Config | `["protocol-config-v2"]` |

## Enum Definitions

### TradeSide
```json
{
  "name": "TradeSide",
  "type": {
    "kind": "enum",
    "variants": [
      { "name": "Buy" },
      { "name": "Sell" }
    ]
  }
}
```

When passing to program methods:
```typescript
const sideEnum = side === TradeSide.Buy ? { buy: {} } : { sell: {} };
```

### TradeStatus
```json
{
  "name": "TradeStatus",
  "type": {
    "kind": "enum",
    "variants": [
      { "name": "Created" },
      { "name": "Locked" },
      { "name": "Released" },
      { "name": "Refunded" }
    ]
  }
}
```

## Common Errors

### `IdlError: Type not found: <type_name>`

**Cause**: Using old IDL format `{ "defined": "TypeName" }` instead of new format `{ "defined": { "name": "TypeName" } }`

**Fix**: Update all type references in IDL to use the nested object format.

### `InstructionFallbackNotFound` (Error 0x65 / 101)

**Cause**: IDL doesn't match deployed program. Could be:
- Wrong instruction discriminator
- Wrong argument format (struct vs flattened)
- Wrong PDA seeds

**Fix**:
1. Ensure IDL matches the deployed program exactly
2. Use flattened args, not structs
3. Verify PDA seeds match program expectations

### `Unauthorized` (Error 6003)

**Cause**: Signer doesn't have permission for the operation.

**Fix**: Ensure the correct wallet is signing:
- `lockEscrow`: Either party can lock
- `releaseEscrow`: Only depositor or creator
- `refundEscrow`: Only depositor or creator

## Example: Lock Escrow Flow

```typescript
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

// 1. Derive PDAs
const [tradePda] = PublicKey.findProgramAddressSync(
  [Buffer.from('trade-v2'), creator.toBuffer(), new BN(tradeId).toArrayLike(Buffer, 'le', 8)],
  programId
);

const [escrowPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('escrow-v2'), tradePda.toBuffer()],
  programId
);

const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('vault-authority-v2'), escrowPda.toBuffer()],
  programId
);

// 2. Get token accounts
const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
const depositorAta = await getAssociatedTokenAddress(mint, depositor);

// 3. Build and send transaction
const tx = await program.methods
  .lockEscrow(counterparty)  // Pass counterparty directly, not as object
  .accounts({
    depositor,
    trade: tradePda,
    escrow: escrowPda,
    vaultAuthority,
    vaultAta,
    depositorAta,
    mint,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

## File Structure

```
src/lib/solana/v2/
├── idl.json          # Program IDL (Anchor 0.30+ format)
├── program.ts        # Program interaction functions
├── pdas.ts           # PDA derivation helpers
├── types.ts          # TypeScript types
├── config.ts         # Network configuration
└── index.ts          # Exports
```

## Troubleshooting Checklist

1. [ ] IDL uses `{ "defined": { "name": "..." } }` format for type references
2. [ ] IDL uses `"pubkey"` not `"publicKey"` for public key types
3. [ ] Program methods pass flattened args, not param structs
4. [ ] PDA seeds include `-v2` suffix
5. [ ] Correct program ID: `6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87`
6. [ ] Using `@coral-xyz/anchor` version 0.30+
