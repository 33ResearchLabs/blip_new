# 8-State Minimal Settlement Layer

## Overview

This document describes the **8-state minimal settlement layer** implemented for backwards-compatible API simplification.

The system maintains full compatibility with the existing 12-status database while exposing a cleaner 8-status API to clients.

## Architecture

### Three Layers

1. **Database Layer (12 statuses)** - PostgreSQL enum unchanged
2. **Normalization Layer** - Maps between 12-status DB and 8-status API
3. **API Layer (8 statuses)** - Clean, minimal public interface

### Status Mapping

| DB Status (12) | API Status (8) | Description |
|----------------|----------------|-------------|
| `pending` | `open` | Order created, waiting for merchant to accept |
| `accepted` | `accepted` | Merchant accepted order |
| `escrow_pending` | `accepted` | **Transient** - Collapsed to accepted |
| `escrowed` | `escrowed` | Crypto locked in escrow |
| `payment_pending` | `escrowed` | **Transient** - Collapsed to escrowed |
| `payment_sent` | `payment_sent` | Fiat payment marked as sent |
| `payment_confirmed` | `payment_sent` | **Transient** - Collapsed to payment_sent |
| `releasing` | `completed` | **Transient** - Collapsed to completed |
| `completed` | `completed` | Trade completed successfully |
| `cancelled` | `cancelled` | Order cancelled |
| `disputed` | `disputed` | Order in dispute |
| `expired` | `expired` | Order expired due to timeout |

### Transient Statuses (Deprecated for New Writes)

The following statuses are **read-only** and should NOT be written by new code:

- `escrow_pending` → Use `accepted` instead
- `payment_pending` → Use `escrowed` instead
- `payment_confirmed` → Use `payment_sent` instead
- `releasing` → Use `completed` instead (atomic)

These exist only for backwards compatibility with historical data.

## Public Actions (6)

The API exposes 6 user-facing actions:

1. **accept** - Merchant accepts order (`open` → `accepted`)
2. **lock_escrow** - Lock crypto in escrow (`accepted` → `escrowed`)
3. **mark_paid** - Mark fiat payment as sent (`escrowed` → `payment_sent`)
4. **confirm_and_release** - Confirm payment and release escrow (`payment_sent` → `completed`)
5. **cancel** - Cancel order (any → `cancelled`)
6. **dispute** - Raise dispute (escrow+ → `disputed`)

## State Transitions

### Flow Diagram (8-State)

```
open
  ├─(accept)──────────────> accepted
  ├─(lock_escrow)─────────> escrowed (direct for sell orders)
  ├─(cancel)──────────────> cancelled
  └─(timeout:15min)───────> expired

accepted
  ├─(lock_escrow)─────────> escrowed
  ├─(mark_paid)───────────> payment_sent (if escrow already locked)
  ├─(cancel)──────────────> cancelled
  └─(timeout:120min)──────> cancelled

escrowed
  ├─(accept)──────────────> accepted (M2M/sell order acceptance)
  ├─(mark_paid)───────────> payment_sent
  ├─(confirm_and_release)> completed (direct completion)
  ├─(cancel)──────────────> cancelled (refund)
  ├─(dispute)─────────────> disputed
  └─(timeout:120min)──────> disputed

payment_sent
  ├─(confirm_and_release)> completed
  ├─(dispute)─────────────> disputed
  └─(timeout:120min)──────> disputed

completed  [TERMINAL]

cancelled  [TERMINAL]

disputed
  ├─(system_resolve)──────> completed (release)
  └─(system_resolve)──────> cancelled (refund)

expired  [TERMINAL]
```

## Timeout Rules (Updated)

### Open Orders
- **Timeout**: 15 minutes from creation
- **Outcome**: → `expired` (not `cancelled`)
- **Liquidity**: Restored to offer

### Accepted Orders (No Escrow)
- **Timeout**: 120 minutes from acceptance
- **Outcome**: → `cancelled`
- **Liquidity**: Restored to offer

### Escrowed+ Orders
- **Timeout**: 120 minutes from acceptance
- **Outcome**: → `disputed` (NEVER auto-cancel)
- **Invariant**: After escrow locked, timeout → dispute only

## Invariants Maintained

The minimal system maintains all critical invariants:

1. **Escrow Integrity**: Cannot complete without `release_tx_hash`
2. **Terminal Finality**: No transitions from `completed`/`cancelled`/`expired`
3. **Role-Based Transitions**: Actor permissions enforced
4. **Single Accept Lock**: Row-level locking on accept
5. **Escrow-Locked Timeout → Dispute**: Post-escrow timeouts require manual resolution

## Implementation Files

### Core Files

- **`/src/lib/orders/statusNormalizer.ts`** - Normalization layer
- **`/src/lib/orders/stateMachineMinimal.ts`** - 8-state state machine
- **`/src/lib/types/database.ts`** - Type definitions (added `MinimalOrderStatus`)
- **`/src/lib/db/repositories/orders.ts`** - Updated to prevent transient writes

### API Files Updated

- **`/src/app/api/orders/route.ts`** - GET/POST with `minimal_status` field
- **`/src/app/api/orders/[id]/route.ts`** - GET/PATCH/DELETE with `minimal_status` field
- **`/src/app/api/merchant/orders/route.ts`** - GET/POST with `minimal_status` field

### Response Format

All API responses now include both statuses:

```json
{
  "id": "...",
  "status": "payment_confirmed",        // DB status (12-state, for backwards compat)
  "minimal_status": "payment_sent",     // API status (8-state, NEW)
  "..."
}
```

## Backwards Compatibility

### ✅ What's Preserved

- **Database schema**: Unchanged (12-status enum remains)
- **Existing API endpoints**: All endpoints still work
- **Historical data**: Old status values readable
- **Response structure**: Added `minimal_status` field (non-breaking)

### ⚠️ What's Changed

- **New writes**: Transient statuses (`escrow_pending`, `payment_pending`, `payment_confirmed`, `releasing`) rejected
- **Timeout outcomes**: Pending → `expired` (not `cancelled`)
- **Escrow timeout**: Always → `disputed` (never auto-cancel)

### 🔒 What's Enforced

- **Status write validation**: `isTransientStatus()` check in `updateOrderStatus()`
- **State machine**: Minimal transitions only
- **Normalization**: All responses include `minimal_status`

## Usage

### For API Consumers

**Use `minimal_status` field** for all new integrations:

```typescript
// ✅ Good (8-state)
if (order.minimal_status === 'payment_sent') {
  // Show "Payment sent" UI
}

// ⚠️ Avoid (12-state, legacy)
if (order.status === 'payment_confirmed') {
  // This still works but use minimal_status instead
}
```

### For Backend Code

**Always write canonical statuses**:

```typescript
// ✅ Good
await updateOrderStatus(orderId, 'payment_sent', 'user', userId);

// ❌ Bad - will be rejected
await updateOrderStatus(orderId, 'payment_confirmed', 'user', userId);
// Error: "Status 'payment_confirmed' is a transient status and cannot be written."
```

### For Queries

**Use `expandStatus()` when filtering**:

```typescript
import { expandStatus } from '@/lib/orders/statusNormalizer';

// Find all "payment_sent" orders (includes payment_confirmed)
const dbStatuses = expandStatus('payment_sent'); // ['payment_sent', 'payment_confirmed']
const orders = await query(
  'SELECT * FROM orders WHERE status = ANY($1)',
  [dbStatuses]
);
```

## Testing

Run the test suite:

```bash
cd settle
pnpm test src/lib/orders/__tests__/statusNormalizer.test.ts
```

### Key Tests

- ✅ Status normalization (12 → 8)
- ✅ Status expansion (8 → 12[])
- ✅ Action normalization
- ✅ Transient status detection
- ✅ Write validation
- ✅ Roundtrip consistency

## Migration Notes

### For Existing Orders

- Historical orders with transient statuses are normalized in API responses
- `GET /api/orders/:id` returns both `status` (DB) and `minimal_status` (normalized)
- No database migration required

### For New Orders

- Use `pending`, `accepted`, `escrowed`, `payment_sent`, `completed`, `cancelled`, `disputed`, `expired`
- Avoid `escrow_pending`, `payment_pending`, `payment_confirmed`, `releasing`
- System will reject writes to transient statuses

## Benefits

1. **Simpler API**: 8 statuses instead of 12
2. **Cleaner UX**: Fewer intermediate states to handle
3. **Backwards Compatible**: No breaking changes
4. **Future-Proof**: Easy to deprecate legacy statuses later
5. **Testable**: Clear normalization boundaries

## Next Steps

### Phase 1: Current (Dual Status)
- ✅ Implement normalization layer
- ✅ Update API responses with `minimal_status`
- ✅ Prevent new transient writes
- ✅ Maintain DB compatibility

### Phase 2: Migration (Optional)
- [ ] Monitor `status` field usage
- [ ] Deprecation warnings for `status` field
- [ ] Client migration to `minimal_status`

### Phase 3: Cleanup (Future)
- [ ] Remove `status` from API responses (breaking change)
- [ ] Rename `minimal_status` → `status`
- [ ] Database migration to consolidate statuses

## Contact

For questions or issues, refer to:
- **State Machine**: `/src/lib/orders/stateMachineMinimal.ts`
- **Normalizer**: `/src/lib/orders/statusNormalizer.ts`
- **Tests**: `/src/lib/orders/__tests__/statusNormalizer.test.ts`
