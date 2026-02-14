# Minimal Migration Plan: 12-State to 8-State Settlement Layer

**Version**: 1.0
**Date**: 2026-02-12
**Status**: Implementation Guide

This document provides a comprehensive, phased migration plan for transitioning from the current 12-status order state machine to the simplified 8-status minimal settlement layer.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Phase 1: Compatibility Layer (Current - Safe to Deploy)](#2-phase-1-compatibility-layer-current---safe-to-deploy)
3. [Phase 2: DB Enum Migration (Later - After Validation)](#3-phase-2-db-enum-migration-later---after-validation)
4. [Phase 3: Cleanup (Final - After Full Migration)](#4-phase-3-cleanup-final---after-full-migration)
5. [Timeline](#5-timeline)
6. [UI Implications](#6-ui-implications)
7. [API Compatibility Matrix](#7-api-compatibility-matrix)
8. [Webhook Migration](#8-webhook-migration)
9. [Risk Checklist](#9-risk-checklist)
10. [Rollback Plans](#10-rollback-plans)
11. [Monitoring & Validation](#11-monitoring--validation)
12. [Team Communication](#12-team-communication)
13. [Success Criteria](#13-success-criteria)
14. [Open Questions](#14-open-questions)

---

## 1. Overview

### Current State: 12 Statuses, 44 Transitions

The current order state machine has grown complex with transient micro-statuses that don't add value to the core settlement logic:

**Current Statuses** (12):
```
pending          → User creates order
accepted         → Merchant claims order
escrow_pending   → ⚠️ Transient: Escrow tx in progress (~30s)
escrowed         → Crypto locked on-chain
payment_pending  → ⚠️ Transient: Awaiting fiat payment
payment_sent     → Buyer marks payment sent
payment_confirmed → ⚠️ Transient: Seller confirms receipt
releasing        → ⚠️ Transient: Escrow release tx in progress (~30s)
completed        → Trade complete
cancelled        → Order cancelled
disputed         → Under arbitration
expired          → Timed out
```

**Issues**:
- 4 transient statuses (escrow_pending, payment_pending, payment_confirmed, releasing) are implementation details, not domain concepts
- UI complexity: 12 status badges, 8-step progress indicators
- State machine has 44 possible transitions to validate
- Historical confusion around which status to use (e.g., payment_sent vs payment_confirmed)

### Target State: 8 Statuses, ~24 Transitions

The minimal settlement layer collapses transient states into their parent states:

**Minimal Statuses** (8):
```
open         ← pending (clearer name)
accepted     ← accepted + escrow_pending (collapsed)
escrowed     ← escrowed + payment_pending (collapsed)
payment_sent ← payment_sent + payment_confirmed (collapsed)
completed    ← completed + releasing (collapsed)
cancelled    ← cancelled
expired      ← expired
disputed     ← disputed
```

**Benefits**:
- Clearer domain model: statuses represent business states, not implementation details
- Simpler UI: 8 badges, 5-step progress indicators
- Fewer transitions to validate: ~24 instead of 44
- Event-driven details: payment_confirmed_at timestamp instead of payment_confirmed status

### Migration Strategy: Phased Rollout with Backwards Compatibility

**Core Principle**: Add new, deprecate old, remove old - in that order.

1. **Phase 1**: Add compatibility layer (API returns both status fields, DB unchanged)
2. **Phase 2**: Migrate DB enum (add minimal_status column, dual write period)
3. **Phase 3**: Remove legacy code (cleanup after full adoption)

---

## 2. Phase 1: Compatibility Layer (Current - Safe to Deploy)

**Goal**: Expose minimal statuses via API without breaking existing code.

### What Changes NOW:

✅ **Add normalizeStatus() function**
- Location: `/src/lib/orders/statusNormalizer.ts`
- Purpose: Map 12-status DB layer → 8-status API layer
- Status: ✅ **ALREADY IMPLEMENTED**

✅ **Add MinimalOrderStatus type**
- Location: `/src/lib/types/database.ts`
- Purpose: Type-safe minimal status enum
- Status: ✅ **ALREADY IMPLEMENTED**

✅ **API responses include minimal_status field**
- Location: All order API routes (`/api/orders/*`)
- Example:
  ```typescript
  import { normalizeStatus } from '@/lib/orders/statusNormalizer';

  // In API response serialization:
  return {
    ...order,
    minimal_status: normalizeStatus(order.status),
  };
  ```
- Status: ⚠️ **NEEDS IMPLEMENTATION**

✅ **State machine validates minimal statuses for new writes**
- Location: `/src/lib/orders/stateMachineMinimal.ts`
- Purpose: Prevent new writes from using transient statuses
- Status: ✅ **ALREADY IMPLEMENTED**

✅ **UI can start using minimal_status field**
- Location: Frontend order components
- Purpose: Gradual migration of UI code
- Status: ⚠️ **NEEDS COORDINATION**

✅ **Tests updated to assert minimal statuses**
- Location: Test files across codebase
- Purpose: Validate new contract
- Status: ⚠️ **NEEDS IMPLEMENTATION**

✅ **Documentation updated**
- Location: Domain specs, API docs
- Purpose: Communicate new contract
- Status: ⚠️ **NEEDS IMPLEMENTATION**

### What Stays Unchanged:

❌ **Database enum (still 12 statuses)**
- Column: `orders.status` with `order_status` enum
- Reason: Non-breaking, allows historical data queries
- Migration: Deferred to Phase 2

❌ **Historical data (readable with old statuses)**
- Reason: Existing orders retain original statuses
- Impact: Queries must handle both schemas

❌ **Existing API contracts (status field still present)**
- Reason: Backwards compatibility for existing clients
- Migration: Deprecation in Phase 2

❌ **Webhooks/events (still emit old statuses if subscribed)**
- Reason: Don't break existing integrations
- Migration: Dual emission in Phase 2

### Implementation Checklist

**Backend**:
- [ ] Update `/api/orders/route.ts` (GET /api/orders) to include `minimal_status`
- [ ] Update `/api/orders/[id]/route.ts` (GET /api/orders/:id) to include `minimal_status`
- [ ] Update `/api/orders/[id]/route.ts` (PATCH /api/orders/:id) to accept minimal statuses
- [ ] Update `/api/merchant/orders/route.ts` to include `minimal_status`
- [ ] Add `minimal_status` to WebSocket broadcast payloads
- [ ] Add `minimal_status` to Pusher event payloads

**Serialization Helper**:
```typescript
// /src/lib/serializers/orderSerializer.ts
import { normalizeStatus } from '@/lib/orders/statusNormalizer';
import { Order } from '@/lib/types/database';

export function serializeOrder(order: Order) {
  return {
    ...order,
    minimal_status: normalizeStatus(order.status),
    // Remove password_hash, internal fields, etc.
  };
}
```

**State Machine Integration**:
```typescript
// In updateOrderStatus or similar:
import { validateStatusWrite } from '@/lib/orders/statusNormalizer';

export async function updateOrderStatus(
  orderId: string,
  newStatus: OrderStatus,
  actorType: ActorType
) {
  // Validate: don't allow new writes to use transient statuses
  validateStatusWrite(newStatus);

  // Rest of state machine logic...
}
```

**Testing**:
```typescript
// In tests/api/orders.test.ts
test('GET /api/orders includes minimal_status field', async () => {
  const response = await fetch('/api/orders');
  const data = await response.json();

  expect(data.orders[0]).toHaveProperty('minimal_status');
  expect(data.orders[0].minimal_status).toBeOneOf([
    'open', 'accepted', 'escrowed', 'payment_sent',
    'completed', 'cancelled', 'expired', 'disputed'
  ]);
});

test('PATCH /api/orders/:id accepts minimal statuses', async () => {
  const response = await fetch('/api/orders/123', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'payment_sent' })
  });

  expect(response.ok).toBe(true);
});

test('Legacy transient statuses map correctly', () => {
  expect(normalizeStatus('escrow_pending')).toBe('accepted');
  expect(normalizeStatus('payment_pending')).toBe('escrowed');
  expect(normalizeStatus('payment_confirmed')).toBe('payment_sent');
  expect(normalizeStatus('releasing')).toBe('completed');
});
```

### Risk Level: 🟢 LOW

**Why low risk?**
- No breaking changes to database schema
- Additive API change (new field, old field still present)
- Backwards compatible with existing clients
- Can be rolled back instantly by removing minimal_status field

**Rollback Steps**:
1. Remove `minimal_status` from API responses
2. Revert state machine validation changes
3. Update tests to use old statuses
4. Deploy previous version

**Deployment Strategy**:
- Deploy during off-peak hours
- Monitor error rates for 1 hour
- Run smoke tests on production
- If issues detected, rollback immediately

---

## 3. Phase 2: DB Enum Migration (Later - After Validation)

**Goal**: Replace database enum with minimal statuses.

### Prerequisites

- [ ] Phase 1 deployed to production for **2+ weeks**
- [ ] All UI clients using `minimal_status` field
- [ ] No errors in logs related to status normalization
- [ ] Historical data analysis complete (query patterns, reporting needs)
- [ ] Webhook subscribers notified of upcoming changes

### Step 2.1: Add Minimal Status Column (Non-Breaking)

**Migration 024: Add minimal_status column**

```sql
-- /database/migrations/024_add_minimal_status_column.sql

BEGIN;

-- Add new column (nullable initially)
ALTER TABLE orders
ADD COLUMN minimal_status VARCHAR(20);

-- Create mapping function (PostgreSQL)
CREATE OR REPLACE FUNCTION normalize_order_status(status order_status)
RETURNS VARCHAR(20) AS $$
BEGIN
  RETURN CASE
    WHEN status = 'pending' THEN 'open'
    WHEN status = 'accepted' THEN 'accepted'
    WHEN status = 'escrow_pending' THEN 'accepted'
    WHEN status = 'escrowed' THEN 'escrowed'
    WHEN status = 'payment_pending' THEN 'escrowed'
    WHEN status = 'payment_sent' THEN 'payment_sent'
    WHEN status = 'payment_confirmed' THEN 'payment_sent'
    WHEN status = 'releasing' THEN 'completed'
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'expired' THEN 'expired'
    WHEN status = 'disputed' THEN 'disputed'
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill with normalized values
UPDATE orders
SET minimal_status = normalize_order_status(status);

-- Verify no nulls
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM orders WHERE minimal_status IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Found % rows with null minimal_status after backfill', null_count;
  END IF;
END $$;

-- Add NOT NULL constraint after backfill
ALTER TABLE orders
ALTER COLUMN minimal_status SET NOT NULL;

-- Create index for queries (critical for performance)
CREATE INDEX idx_orders_minimal_status ON orders(minimal_status);

-- Add check constraint to prevent invalid values
ALTER TABLE orders
ADD CONSTRAINT orders_minimal_status_valid
CHECK (minimal_status IN (
  'open', 'accepted', 'escrowed', 'payment_sent',
  'completed', 'cancelled', 'expired', 'disputed'
));

COMMIT;
```

**Rollback Migration 024**:
```sql
BEGIN;
ALTER TABLE orders DROP COLUMN minimal_status;
DROP FUNCTION IF EXISTS normalize_order_status(order_status);
COMMIT;
```

**Testing**:
```bash
# Test in staging first
psql $STAGING_DB_URL < database/migrations/024_add_minimal_status_column.sql

# Verify all rows have minimal_status
psql $STAGING_DB_URL -c "SELECT COUNT(*) FROM orders WHERE minimal_status IS NULL;"
# Should return 0

# Verify index exists
psql $STAGING_DB_URL -c "\di idx_orders_minimal_status"

# Test query performance
psql $STAGING_DB_URL -c "EXPLAIN ANALYZE SELECT * FROM orders WHERE minimal_status = 'escrowed';"
```

### Step 2.2: Dual Write Period (1-2 weeks)

**Purpose**: Write to both `status` and `minimal_status` columns to ensure data consistency.

**Code Changes**:
```typescript
// In order creation/update functions:
export async function updateOrderStatus(
  orderId: string,
  newMinimalStatus: MinimalOrderStatus,
  actorType: ActorType
) {
  // Map minimal status to canonical DB status
  const dbStatus = denormalizeStatus(newMinimalStatus);

  // Dual write: update both columns
  await query(
    `UPDATE orders
     SET status = $1, minimal_status = $2, updated_at = NOW()
     WHERE id = $3`,
    [dbStatus, newMinimalStatus, orderId]
  );

  // ... rest of logic
}
```

**Query Migration**:
```typescript
// BEFORE (Phase 1):
const orders = await query(
  `SELECT * FROM orders WHERE status = $1`,
  ['payment_sent']
);

// AFTER (Phase 2):
const orders = await query(
  `SELECT * FROM orders WHERE minimal_status = $1`,
  ['payment_sent']
);
```

**Validation Queries**:
```sql
-- Check for inconsistencies between status and minimal_status
SELECT
  id,
  status,
  minimal_status,
  normalize_order_status(status) as expected_minimal_status
FROM orders
WHERE minimal_status != normalize_order_status(status);
-- Should return 0 rows
```

**Monitoring**:
- Run validation query hourly via cron job
- Alert if any inconsistencies found
- Track write latency (should not increase significantly)

### Step 2.3: Deprecate Old Status Column (Optional - High Risk)

**⚠️ WARNING**: This step is OPTIONAL and HIGH RISK. Consider keeping both columns permanently if:
- Historical reporting requires legacy statuses
- External integrations depend on old enum
- Rollback capability is critical

If proceeding:

**Migration 025: Rename and replace status column**

```sql
-- /database/migrations/025_replace_status_column.sql

BEGIN;

-- 1. Rename old status column (keep for historical reference)
ALTER TABLE orders
RENAME COLUMN status TO legacy_status;

-- 2. Rename minimal_status to status
ALTER TABLE orders
RENAME COLUMN minimal_status TO status;

-- 3. Update column type to new enum
-- CRITICAL: This will fail if any foreign keys or views reference the old enum
-- Run this query first to check:
-- SELECT * FROM information_schema.table_constraints
-- WHERE constraint_type = 'FOREIGN KEY' AND table_name = 'orders';

-- Drop old enum (only if safe)
-- DROP TYPE order_status CASCADE; -- ⚠️ DANGEROUS - may break views/functions

-- Create new enum with 8 values
CREATE TYPE minimal_order_status AS ENUM (
  'open',
  'accepted',
  'escrowed',
  'payment_sent',
  'completed',
  'cancelled',
  'expired',
  'disputed'
);

-- Update column type
ALTER TABLE orders
ALTER COLUMN status TYPE minimal_order_status USING status::minimal_order_status;

-- Drop legacy_status column (optional - consider keeping for auditing)
-- ALTER TABLE orders DROP COLUMN legacy_status;

COMMIT;
```

**Alternative Approach (Safer)**:

Keep both columns permanently:
- `status` → minimal 8-state enum (new writes)
- `legacy_status` → original 12-state enum (historical data)

Benefits:
- Zero data loss
- Historical queries still work
- Easy rollback
- Audit trail for debugging

### Risk Level: 🟡 MEDIUM

**Why medium risk?**
- Requires careful coordination between backend and DB
- Potential performance impact during migration
- Risk of data inconsistency during dual write period
- Requires testing in staging environment first

**Mitigation**:
1. Test in staging first (full migration dress rehearsal)
2. Schedule migration during maintenance window
3. Have DB admin on standby
4. Run validation queries before and after
5. Keep rollback script ready

**Rollback Steps**:
1. Stop writing to `minimal_status` column
2. Revert queries to use `status` column
3. Drop `minimal_status` column (optional)
4. Restore old API behavior

---

## 4. Phase 3: Cleanup (Final - After Full Migration)

**Goal**: Remove backwards compatibility code and finalize documentation.

### Remove Legacy Code

**Files to Update**:
- [ ] Remove `normalizeStatus()` function (no longer needed if DB uses minimal statuses)
- [ ] Remove `denormalizeStatus()` function
- [ ] Remove `expandStatus()` function
- [ ] Remove legacy status validation in state machine
- [ ] Remove dual write logic
- [ ] Remove `legacy_status` column (if using alternative approach)

**Codebase Cleanup**:
```bash
# Find all references to old statuses
grep -r "payment_confirmed" src/
grep -r "escrow_pending" src/
grep -r "payment_pending" src/
grep -r "releasing" src/

# Should only find historical references, not active code
```

### Update Documentation

**Files to Archive**:
- [ ] `/settle/DOMAIN_SPEC.md` → `/settle/docs/archive/DOMAIN_SPEC_12_STATE.md`
- [ ] `/settle/ORDER_STATE_DIAGRAM.md` → `/settle/docs/archive/ORDER_STATE_DIAGRAM_12_STATE.md`

**Files to Create/Update**:
- [ ] `/settle/DOMAIN_SPEC_MINIMAL.md` → canonical reference
- [ ] `/settle/ORDER_STATE_DIAGRAM_MINIMAL.md` → 8-state diagram
- [ ] `/settle/API_INTEGRATION.md` → update examples with minimal statuses
- [ ] `/settle/MIGRATION_CHANGELOG.md` → document breaking changes

### Team Training

**Knowledge Transfer**:
- [ ] Team meeting: Present new 8-state model
- [ ] Update onboarding docs with minimal state machine
- [ ] Create FAQ document for common migration questions
- [ ] Code review checklist: ensure no new code uses transient statuses

### Risk Level: 🟢 LOW

**Why low risk?**
- Only cleanup, no functional changes
- All active code already using minimal statuses
- Easy to defer if needed

---

## 5. Timeline

| Phase | Duration | Start Date | End Date | Milestone |
|-------|----------|------------|----------|-----------|
| **Phase 1: Compatibility Layer** | 1-2 weeks | Week 1 | Week 2 | Deploy to production |
| **Validation Period** | 2-4 weeks | Week 3 | Week 6 | Monitor, fix issues, coordinate UI migration |
| **Phase 2: DB Migration (Staging)** | 1 week | Week 7 | Week 7 | Test in staging environment |
| **Phase 2: DB Migration (Production)** | 1 week | Week 8 | Week 8 | Run DB migrations in production |
| **Phase 3: Cleanup** | 1 week | Week 9 | Week 9 | Remove legacy code, update docs |
| **Total** | **6-9 weeks** | Week 1 | Week 9 | **Full migration complete** |

**Critical Path**:
1. Week 1-2: Deploy Phase 1 (compatibility layer)
2. Week 3-6: UI teams migrate to `minimal_status` field
3. Week 7: Test DB migration in staging
4. Week 8: Run DB migration in production
5. Week 9: Cleanup and documentation

**Milestones**:
- ✅ Phase 1 deployed (Week 2)
- ✅ All UI using minimal_status (Week 6)
- ✅ DB migration complete (Week 8)
- ✅ Legacy code removed (Week 9)

---

## 6. UI Implications

### Current UI Code (Needs Update)

**Problem**: UI code checks for specific statuses that will be collapsed.

**Old Code**:
```typescript
// ❌ BREAKS after migration
if (order.status === 'payment_confirmed') {
  return <CompleteOrderButton />;
}

if (order.status === 'escrow_pending') {
  return <LoadingSpinner text="Locking escrow..." />;
}
```

**New Code**:
```typescript
// ✅ CORRECT after migration
if (order.minimal_status === 'payment_sent') {
  // Check for payment_confirmed event timestamp
  if (order.payment_confirmed_at) {
    return <CompleteOrderButton />;
  }
  return <AwaitingConfirmationMessage />;
}

if (order.minimal_status === 'accepted' && order.escrow_tx_hash) {
  return <LoadingSpinner text="Locking escrow..." />;
}
```

### Status Display Mapping

UI should display user-friendly labels for minimal statuses:

| Minimal Status | Display Name | Badge Color | Description |
|----------------|-------------|-------------|-------------|
| `open` | "Pending Assignment" | Gray | Waiting for merchant to accept |
| `accepted` | "Merchant Assigned" | Blue | Merchant accepted, preparing escrow |
| `escrowed` | "Crypto Locked" | Yellow | Crypto locked, awaiting payment |
| `payment_sent` | "Payment In Progress" | Orange | Buyer sent fiat, seller verifying |
| `completed` | "Completed" | Green | Trade complete |
| `cancelled` | "Cancelled" | Red | Order cancelled |
| `expired` | "Expired" | Red | Order timed out |
| `disputed` | "Under Review" | Purple | Dispute in progress |

### UI Changes Required

**Component Updates**:
- [ ] Update `<OrderStatusBadge>` to handle 8 statuses instead of 12
- [ ] Update `<OrderProgress>` indicator (4-5 steps instead of 8)
- [ ] Update `<OrderTimeline>` to show minimal statuses
- [ ] Update status filter dropdowns (8 options instead of 12)
- [ ] Add `payment_confirmed` indicator (icon/badge, not separate status)

**Progress Indicator Example**:
```typescript
// Old (8 steps):
const steps = [
  'pending', 'accepted', 'escrow_pending', 'escrowed',
  'payment_pending', 'payment_sent', 'payment_confirmed', 'completed'
];

// New (5 steps):
const steps = [
  'open',       // Step 1: Order created
  'accepted',   // Step 2: Merchant assigned
  'escrowed',   // Step 3: Crypto locked
  'payment_sent', // Step 4: Payment in progress
  'completed'   // Step 5: Trade complete
];
```

**Event-Driven Details**:

Instead of relying on micro-statuses, check event timestamps:

```typescript
interface OrderWithEvents {
  id: string;
  minimal_status: MinimalOrderStatus;

  // Event timestamps replace micro-statuses
  escrow_tx_hash?: string;           // Replaces escrow_pending
  escrow_confirmed_at?: Date;        // Replaces transition to escrowed
  payment_sent_at?: Date;            // Already exists
  payment_confirmed_at?: Date;       // Replaces payment_confirmed status
  escrow_release_tx_hash?: string;   // Replaces releasing status
  completed_at?: Date;               // Already exists
}

// UI can show progress based on timestamps:
function getOrderProgress(order: OrderWithEvents): number {
  if (order.completed_at) return 100;
  if (order.payment_confirmed_at) return 80;
  if (order.payment_sent_at) return 60;
  if (order.escrow_confirmed_at) return 40;
  if (order.escrow_tx_hash) return 20;
  return 0;
}
```

### Mobile App Considerations

If mobile apps exist:
- [ ] Notify mobile team of API changes
- [ ] Add `minimal_status` to mobile data models
- [ ] Update status badge rendering
- [ ] Test on iOS and Android

---

## 7. API Compatibility Matrix

| Endpoint | Phase 1 | Phase 2 | Phase 3 |
|----------|---------|---------|---------|
| **GET /api/orders** | Returns both `status` and `minimal_status` | Returns `minimal_status` only (legacy `status` deprecated) | Returns `status` (8 values) |
| **GET /api/orders/:id** | Returns both `status` and `minimal_status` | Returns `minimal_status` only | Returns `status` (8 values) |
| **POST /api/orders** | Writes normalized status (accepts old or new) | Writes to `minimal_status` column | Writes to `status` column (8-value enum) |
| **PATCH /api/orders/:id** | Accepts old or new status names | Accepts minimal status only | Accepts minimal status only |
| **WebSocket broadcasts** | Emits both status fields | Emits `minimal_status` only | Emits `status` only |
| **Pusher events** | Emits both status fields | Emits `minimal_status` only | Emits `status` only |
| **Webhooks** | Dual emission (see section 8) | Deprecation warning | Minimal only |

### API Response Examples

**Phase 1 (Current)**:
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "payment_confirmed",
  "minimal_status": "payment_sent",
  "amount": 1000,
  "created_at": "2026-02-12T10:00:00Z"
}
```

**Phase 2 (DB Migration)**:
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "payment_sent",
  "minimal_status": "payment_sent",
  "_deprecation": {
    "status": "Field 'status' is deprecated. Use 'minimal_status' instead."
  },
  "amount": 1000,
  "created_at": "2026-02-12T10:00:00Z"
}
```

**Phase 3 (Final)**:
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "payment_sent",
  "amount": 1000,
  "created_at": "2026-02-12T10:00:00Z"
}
```

---

## 8. Webhook Migration

If webhook subscribers exist (partners, analytics, etc.), coordinate migration carefully.

### Phase 1: Dual Emission

Emit both old and new status fields:

```json
{
  "event": "order.status_changed",
  "timestamp": "2026-02-12T10:00:00Z",
  "data": {
    "order_id": "123e4567-e89b-12d3-a456-426614174000",
    "status": "payment_confirmed",
    "minimal_status": "payment_sent",
    "old_status": "payment_sent",
    "old_minimal_status": "payment_sent"
  }
}
```

### Phase 2: Deprecation Notice

Add deprecation warnings:

```json
{
  "event": "order.status_changed",
  "timestamp": "2026-02-12T10:00:00Z",
  "data": {
    "status": "payment_sent",
    "legacy_status": "payment_confirmed",
    "_deprecation_warning": "Field 'legacy_status' will be removed in v2.0 on 2026-04-01. Use 'status' field instead."
  }
}
```

### Phase 3: Minimal Only

Remove legacy fields:

```json
{
  "event": "order.status_changed",
  "timestamp": "2026-02-12T10:00:00Z",
  "data": {
    "status": "payment_sent"
  }
}
```

### Webhook Subscriber Communication

**Email Template**:
```
Subject: BREAKING CHANGE: Order Status Simplification (Effective 2026-04-01)

Hi [Partner Name],

We're simplifying our order status system from 12 statuses to 8 statuses.

WHAT'S CHANGING:
- Old statuses like "payment_confirmed" will be replaced by "payment_sent"
- Your webhook payloads will include both old and new fields during transition

TIMELINE:
- 2026-02-15: Dual emission starts (both old and new fields)
- 2026-03-15: Deprecation warnings added
- 2026-04-01: Old fields removed (BREAKING CHANGE)

ACTION REQUIRED:
- Update your webhook handlers to use the new "status" field
- Map old statuses to new ones (see migration guide: [link])

MIGRATION GUIDE: [link to documentation]

Questions? Reply to this email.
```

---

## 9. Risk Checklist

### Before Phase 1 Deployment:

- [ ] All tests pass with minimal statuses
- [ ] State machine validates minimal statuses (`validateStatusWrite`)
- [ ] API responses include `minimal_status` field (all endpoints)
- [ ] WebSocket/Pusher events include `minimal_status`
- [ ] No performance regression (load testing)
- [ ] Logs show no normalization errors
- [ ] Smoke tests pass in staging

### Before Phase 2 Deployment:

- [ ] Phase 1 stable in production (2+ weeks)
- [ ] UI fully migrated to `minimal_status` field
- [ ] Webhook subscribers notified (email sent)
- [ ] DB migration tested in staging (full dress rehearsal)
- [ ] Historical data analysis complete (no unexpected edge cases)
- [ ] Rollback plan documented and tested
- [ ] DB admin available during migration window
- [ ] Monitoring alerts configured

### Before Phase 3 Deployment:

- [ ] No legacy status references in codebase (`grep` confirms)
- [ ] Historical data archived (if needed)
- [ ] Documentation fully updated
- [ ] Team trained on new statuses
- [ ] Mobile apps updated (if applicable)
- [ ] External partners migrated (if applicable)

---

## 10. Rollback Plans

### Phase 1 Rollback (Easy - 5 minutes)

**Trigger**: API errors spike, normalization bugs discovered

**Steps**:
1. Revert API response serialization (remove `minimal_status` field)
2. Revert state machine validation changes
3. Update tests to use old statuses
4. Deploy previous version via CI/CD

**Validation**:
```bash
# Check API response
curl https://api.blip.money/api/orders | jq '.[0].minimal_status'
# Should return: null (field removed)
```

**Recovery Time**: ~5 minutes

### Phase 2 Rollback (Medium - 15-30 minutes)

**Trigger**: Data inconsistencies detected, query performance degraded

**Steps**:
1. Stop writing to `minimal_status` column
   ```typescript
   // Comment out minimal_status writes
   await query(
     `UPDATE orders SET status = $1 WHERE id = $2`,
     [dbStatus, orderId]
   );
   ```
2. Revert queries to use `status` column
   ```typescript
   // Change WHERE clause
   await query(
     `SELECT * FROM orders WHERE status = $1`,
     [expandStatus(minimalStatus)]
   );
   ```
3. Optionally drop `minimal_status` column (or leave for next attempt)
   ```sql
   ALTER TABLE orders DROP COLUMN minimal_status;
   ```
4. Restore old API behavior (Phase 1 state)

**Validation**:
```sql
-- Check queries are using status column
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'payment_sent';
-- Should use idx_orders_status, not idx_orders_minimal_status
```

**Recovery Time**: ~15-30 minutes

### Phase 3 Rollback (Hard - 1-2 hours)

**Trigger**: Unexpected production issues, partner integration breaks

**Steps**:
1. Re-add `normalizeStatus()` function
2. Restore `legacy_status` column (if dropped)
   ```sql
   ALTER TABLE orders ADD COLUMN legacy_status order_status;
   -- Backfill from audit logs or historical data
   ```
3. Update UI to use both status fields
4. Redeploy Phase 2 code

**Recovery Time**: ~1-2 hours

**Recommendation**: Don't rollback Phase 3. Fix forward instead.

---

## 11. Monitoring & Validation

### Metrics to Track

**Application Metrics**:
- [ ] Status normalization errors (should be 0)
  ```typescript
  // Add monitoring
  try {
    const minimalStatus = normalizeStatus(order.status);
  } catch (error) {
    logger.error('Status normalization failed', { orderId, status: order.status, error });
    // Alert: critical error
  }
  ```
- [ ] API response times (should not increase)
  - Baseline: GET /api/orders < 200ms (p99)
  - Target: GET /api/orders < 250ms (p99)
- [ ] Order creation success rate (should stay ≥99%)
- [ ] State machine validation failures
  - Track invalid transitions attempted
  - Alert if transient statuses written
- [ ] UI error rates (status display issues)

**Database Metrics**:
- [ ] Query performance (index usage)
  ```sql
  -- Monitor slow queries
  SELECT query, calls, total_time, mean_time
  FROM pg_stat_statements
  WHERE query LIKE '%orders%status%'
  ORDER BY mean_time DESC
  LIMIT 10;
  ```
- [ ] Data consistency (dual write validation)
  ```sql
  -- Run hourly
  SELECT COUNT(*) FROM orders
  WHERE minimal_status != normalize_order_status(status);
  -- Should be 0
  ```

**Business Metrics**:
- [ ] Order completion rate (should stay ≥95%)
- [ ] Dispute rate (should not increase)
- [ ] Average order duration (should not increase)

### Alerts to Configure

**Critical Alerts** (PagerDuty):
- Status normalization returns null/undefined
- Transient status written to database
- State machine rejects valid transition
- Data inconsistency detected (dual write mismatch)
- API error rate > 1%

**Warning Alerts** (Slack):
- Query performance degraded (>250ms p99)
- Unusual status distribution (e.g., 50% of orders in "open")
- High rate of order cancellations

### Validation Dashboards

**Grafana Dashboard**: Order Status Migration

Panels:
1. Status distribution (pie chart)
2. API response times (line chart)
3. Normalization errors (counter)
4. State machine validation failures (table)
5. Data consistency check (gauge)

---

## 12. Team Communication

### Announcement Template

**Phase 1 Launch**:

> **🚀 Order Status Simplification: Phase 1 Deployed**
>
> We've deployed the first phase of our order status simplification project.
>
> **What's New:**
> - API responses now include `minimal_status` field (8 values instead of 12)
> - Old `status` field still present for backwards compatibility
> - No breaking changes
>
> **Action Required (Frontend):**
> - [ ] Start using `order.minimal_status` in your UI components
> - [ ] Update status badges to handle 8 statuses (see migration guide)
> - [ ] Check for `payment_confirmed_at` timestamp instead of `payment_confirmed` status
> - [ ] Update order progress indicators (5 steps instead of 8)
>
> **Action Required (Backend):**
> - [ ] No changes needed immediately
> - [ ] Monitor logs for normalization errors (should be 0)
> - [ ] Avoid using transient statuses in new code (escrow_pending, payment_pending, payment_confirmed, releasing)
>
> **Timeline:**
> - Phase 1: Now (compatibility layer) ✅
> - Phase 2: Week 8 (DB migration)
> - Phase 3: Week 9 (cleanup)
>
> **Resources:**
> - Migration guide: `/settle/MINIMAL_MIGRATION_PLAN.md`
> - New state machine: `/settle/src/lib/orders/stateMachineMinimal.ts`
> - API docs: [link]
>
> Questions? Ask in #engineering-support

### Meeting Agenda

**Team Meeting: Order Status Migration Kickoff**

1. **Context** (5 min)
   - Why are we doing this?
   - Current problems: 12 statuses, 44 transitions, UI complexity
   - Target: 8 statuses, cleaner domain model

2. **Technical Overview** (10 min)
   - Architecture: 3-phase rollout
   - Phase 1: API compatibility layer (this week)
   - Phase 2: DB migration (4 weeks)
   - Phase 3: Cleanup (6 weeks)

3. **Team Responsibilities** (10 min)
   - Backend: Add `minimal_status` to API responses
   - Frontend: Migrate UI to use `minimal_status`
   - Mobile: Update status handling (if applicable)
   - QA: Test scenarios with new statuses

4. **Timeline & Milestones** (5 min)
   - Week 2: Phase 1 deployed
   - Week 6: All UI using minimal_status
   - Week 8: DB migration
   - Week 9: Cleanup complete

5. **Q&A** (10 min)

---

## 13. Success Criteria

### Phase 1 Success:

- [x] All production APIs return `minimal_status` field
- [x] No increase in error rates (< 0.1%)
- [x] UI teams can access `minimal_status` field
- [x] Tests updated and passing (100% test coverage)
- [x] No normalization errors in logs (0 errors over 1 week)
- [x] API response times unchanged (< 200ms p99)

### Phase 2 Success:

- [x] DB uses `minimal_status` column for all queries
- [x] Historical data preserved in `legacy_status` column (or archived)
- [x] No data loss during migration (100% row integrity)
- [x] Performance same or better (query times < 200ms p99)
- [x] Zero data inconsistencies (validation query returns 0)
- [x] Rollback plan tested and documented

### Phase 3 Success:

- [x] Single source of truth (8 statuses only)
- [x] No legacy code remaining (grep confirms)
- [x] Documentation fully updated
- [x] Team trained and confident (survey: >80% comfortable)
- [x] External partners migrated (if applicable)
- [x] Zero production incidents related to migration

---

## 14. Open Questions

### Technical Questions

1. **Event History**: Should we backfill `payment_confirmed_at` events for historical orders in `payment_confirmed` status?
   - **Impact**: Analytics queries, historical reports
   - **Options**:
     - A. Backfill from `updated_at` timestamp (approximation)
     - B. Leave null (accept data loss for old orders)
     - C. Infer from order_events table (if available)
   - **Recommendation**: Option C if event log exists, else Option B

2. **Analytics Queries**: Do analytics dashboards rely on 12 statuses?
   - **Impact**: Business reporting, KPIs
   - **Action Required**: Audit all analytics queries
   - **Tools**: Check Metabase, Looker, or BI tool for status filters

3. **Historical Data Retention**: How long should we keep `legacy_status` column?
   - **Options**:
     - A. Keep forever (audit trail)
     - B. Drop after 6 months
     - C. Archive to separate table
   - **Recommendation**: Option A (storage is cheap, data is valuable)

### Integration Questions

4. **Mobile Apps**: Are there iOS/Android apps that parse status strings?
   - **Impact**: App crashes if unknown status received
   - **Action Required**: Coordinate release with mobile team
   - **Mitigation**: Add unknown status fallback in mobile code

5. **Third-party Integrations**: Any partners consuming our API?
   - **Impact**: Partner systems may break
   - **Action Required**: Identify and notify all partners
   - **Timeline**: 6-week notice before breaking changes

6. **Webhooks**: Do we have webhook subscribers?
   - **Impact**: Subscriber code may break
   - **Action Required**: Email all subscribers with migration timeline
   - **Coordination**: Follow webhook migration plan (Section 8)

### Business Questions

7. **Compliance**: Does compliance team use specific statuses for reporting?
   - **Impact**: Regulatory reports may need adjustment
   - **Action Required**: Meet with compliance team
   - **Timeline**: Before Phase 2 deployment

8. **Customer Support**: Do support agents rely on 12-status granularity?
   - **Impact**: Support ticket resolution may be affected
   - **Action Required**: Train support team on new statuses
   - **Timeline**: Before Phase 1 deployment

### Recommendation

**Action Items**:
- [ ] Schedule meeting with analytics team to audit queries
- [ ] Schedule meeting with mobile team to plan coordinated release
- [ ] Identify all API consumers (partners, integrations)
- [ ] Send webhook migration emails (if applicable)
- [ ] Meet with compliance team to review reporting requirements
- [ ] Train customer support on new status system

---

## Appendix A: Status Mapping Reference

### Complete Mapping Table

| Old Status (12) | New Status (8) | Event Timestamp | Notes |
|----------------|---------------|----------------|-------|
| `pending` | `open` | - | Clearer name for initial state |
| `accepted` | `accepted` | - | No change |
| `escrow_pending` | `accepted` | `escrow_tx_hash` | Transient state collapsed |
| `escrowed` | `escrowed` | `escrow_confirmed_at` | No change |
| `payment_pending` | `escrowed` | - | Transient state collapsed |
| `payment_sent` | `payment_sent` | `payment_sent_at` | No change |
| `payment_confirmed` | `payment_sent` | `payment_confirmed_at` | Transient state collapsed |
| `releasing` | `completed` | `escrow_release_tx_hash` | Atomic completion |
| `completed` | `completed` | `completed_at` | No change |
| `cancelled` | `cancelled` | `cancelled_at` | No change |
| `disputed` | `disputed` | `disputed_at` | No change |
| `expired` | `expired` | `expired_at` | No change |

---

## Appendix B: Code Migration Snippets

### API Response Serialization

```typescript
// /src/lib/serializers/orderSerializer.ts
import { normalizeStatus } from '@/lib/orders/statusNormalizer';
import { Order, MinimalOrderStatus } from '@/lib/types/database';

export interface SerializedOrder {
  id: string;
  status: string; // Keep for backwards compatibility
  minimal_status: MinimalOrderStatus; // New field
  amount: number;
  created_at: string;
  // ... other fields
}

export function serializeOrder(order: Order): SerializedOrder {
  return {
    id: order.id,
    status: order.status, // Old field
    minimal_status: normalizeStatus(order.status), // New field
    amount: order.amount,
    created_at: order.created_at.toISOString(),
    // ... other fields
  };
}
```

### UI Component Update

```typescript
// /src/components/OrderStatusBadge.tsx
import { MinimalOrderStatus } from '@/lib/types/database';

interface OrderStatusBadgeProps {
  status: MinimalOrderStatus; // Use minimal status
}

export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  const config = {
    open: { label: 'Pending Assignment', color: 'gray' },
    accepted: { label: 'Merchant Assigned', color: 'blue' },
    escrowed: { label: 'Crypto Locked', color: 'yellow' },
    payment_sent: { label: 'Payment In Progress', color: 'orange' },
    completed: { label: 'Completed', color: 'green' },
    cancelled: { label: 'Cancelled', color: 'red' },
    expired: { label: 'Expired', color: 'red' },
    disputed: { label: 'Under Review', color: 'purple' },
  };

  const { label, color } = config[status];

  return (
    <span className={`badge badge-${color}`}>
      {label}
    </span>
  );
}
```

---

## Appendix C: Testing Strategy

### Unit Tests

```typescript
// /tests/lib/orders/statusNormalizer.test.ts
import { normalizeStatus, expandStatus } from '@/lib/orders/statusNormalizer';

describe('normalizeStatus', () => {
  it('maps pending to open', () => {
    expect(normalizeStatus('pending')).toBe('open');
  });

  it('maps escrow_pending to accepted', () => {
    expect(normalizeStatus('escrow_pending')).toBe('accepted');
  });

  it('maps payment_confirmed to payment_sent', () => {
    expect(normalizeStatus('payment_confirmed')).toBe('payment_sent');
  });

  it('maps releasing to completed', () => {
    expect(normalizeStatus('releasing')).toBe('completed');
  });
});

describe('expandStatus', () => {
  it('expands accepted to include escrow_pending', () => {
    expect(expandStatus('accepted')).toEqual(['accepted', 'escrow_pending']);
  });

  it('expands payment_sent to include payment_confirmed', () => {
    expect(expandStatus('payment_sent')).toEqual(['payment_sent', 'payment_confirmed']);
  });
});
```

### Integration Tests

```typescript
// /tests/api/orders.integration.test.ts
describe('GET /api/orders', () => {
  it('returns minimal_status field', async () => {
    const response = await fetch('/api/orders');
    const data = await response.json();

    expect(data.orders[0]).toHaveProperty('minimal_status');
    expect(data.orders[0].minimal_status).toBeOneOf([
      'open', 'accepted', 'escrowed', 'payment_sent',
      'completed', 'cancelled', 'expired', 'disputed'
    ]);
  });

  it('filters by minimal_status', async () => {
    const response = await fetch('/api/orders?status=payment_sent');
    const data = await response.json();

    data.orders.forEach(order => {
      expect(order.minimal_status).toBe('payment_sent');
    });
  });
});
```

### End-to-End Tests

```typescript
// /tests/e2e/orderFlow.test.ts
describe('Order lifecycle with minimal statuses', () => {
  it('progresses through 8 states correctly', async () => {
    // 1. Create order (open)
    const order = await createOrder({ amount: 1000, type: 'buy' });
    expect(order.minimal_status).toBe('open');

    // 2. Merchant accepts (accepted)
    await acceptOrder(order.id, merchantId);
    const accepted = await getOrder(order.id);
    expect(accepted.minimal_status).toBe('accepted');

    // 3. Lock escrow (escrowed)
    await lockEscrow(order.id);
    const escrowed = await getOrder(order.id);
    expect(escrowed.minimal_status).toBe('escrowed');

    // 4. Mark payment sent (payment_sent)
    await markPaymentSent(order.id);
    const paymentSent = await getOrder(order.id);
    expect(paymentSent.minimal_status).toBe('payment_sent');

    // 5. Complete order (completed)
    await releaseEscrow(order.id);
    const completed = await getOrder(order.id);
    expect(completed.minimal_status).toBe('completed');
  });
});
```

---

## Appendix D: Rollback Checklist

### Phase 1 Rollback Checklist

- [ ] Notify team of rollback decision
- [ ] Revert API response changes (remove `minimal_status`)
- [ ] Revert state machine validation
- [ ] Deploy previous version
- [ ] Verify API responses (minimal_status field gone)
- [ ] Check error rates (should return to baseline)
- [ ] Postmortem: document what went wrong

### Phase 2 Rollback Checklist

- [ ] Notify team and DB admin
- [ ] Stop writing to `minimal_status` column
- [ ] Revert queries to use `status` column
- [ ] Verify data consistency
- [ ] (Optional) Drop `minimal_status` column
- [ ] Deploy rollback code
- [ ] Monitor query performance
- [ ] Postmortem: document issues

### Phase 3 Rollback Checklist

- [ ] Assess severity (can we fix forward?)
- [ ] Restore `normalizeStatus()` function
- [ ] Restore `legacy_status` column (if dropped)
- [ ] Update UI to use both fields
- [ ] Redeploy Phase 2 code
- [ ] Notify partners of delay
- [ ] Postmortem and revised timeline

---

**End of Migration Plan**

**Recommended Approach**: Start with Phase 1, monitor for 2-4 weeks, then proceed to Phase 2 only if no issues found. Phase 3 can be deferred indefinitely if needed (keeping both statuses is acceptable).

**Questions?** Contact the platform team or refer to the documentation at `/settle/docs/`.
