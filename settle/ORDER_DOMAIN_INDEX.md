# Order Domain Documentation Index

**Project**: Blip.money P2P Trading Platform
**Date**: 2026-02-12
**Agent**: Agent D - Consistency Enforcer
**Status**: Documentation Complete ✅

---

## Overview

This directory contains the canonical documentation for the order lifecycle domain. These documents serve as the single source of truth for all order-related business logic, state management, and implementation details.

---

## Documentation Files

### 1. DOMAIN_SPEC.md (33 KB)
**The complete order lifecycle specification**

**Contents**:
- Executive Summary
- Status Definitions (12 statuses)
- Actor Roles (user, merchant, system, compliance)
- State Transition Matrix (44 valid transitions)
- Order Flows by Scenario (6 detailed scenarios)
- Timing & Expiration Rules
- Escrow Integration
- Invariants & Business Rules (Top 5)
- Extension System
- Dispute Resolution
- **Reconciliation & Canonical Decisions** ⭐

**Use this for**:
- Understanding the complete order domain
- Resolving ambiguities in requirements
- Onboarding new engineers
- Architectural decision references

**Key Sections**:
- Section 11: Reconciliation findings and canonical decisions
- Section 8: Top 5 invariants (critical security rules)
- Section 5: Scenario walkthroughs (happy path + edge cases)

---

### 2. RECONCILIATION_SUMMARY.md (10 KB)
**Executive summary of reconciliation findings**

**Contents**:
- Key Findings (8 areas analyzed)
- Canonical Decisions (5 major decisions)
- Top 5 Invariants (enforced rules)
- Migration Checklist
- Testing Verification
- Code Quality Assessment

**Use this for**:
- Quick reference during code reviews
- Understanding what was validated
- Identifying any remaining work items
- Communicating findings to stakeholders

**Key Findings**:
- ✅ System is largely consistent (no critical bugs)
- ⚠️ Minor actor type enum mismatch (low priority fix)
- ⚠️ Landing page uses demo status types (documentation issue)

---

### 3. ORDER_STATE_DIAGRAM.md (17 KB)
**Visual state machine diagrams**

**Contents**:
- Full State Machine (ASCII diagram)
- Buy Order Flow (user → merchant)
- Sell Order Flow (escrow-first)
- M2M Trade Flow (merchant → merchant)
- Timeout Flows (cancellation vs. dispute)
- Dispute Resolution Paths
- Extension Request Flow
- Actor Permissions Matrix
- Critical Decision Points
- Quick Reference Table

**Use this for**:
- Visualizing order flows during design
- Debugging state transition issues
- Training support staff on order progression
- Creating user-facing help documentation

**Visual Highlights**:
- ASCII state diagram with all 44 transitions
- Flow diagrams for 3 primary order types
- Timeout decision tree (when to cancel vs. dispute)

---

## Quick Navigation

### By Role

**Product Manager**:
1. Read RECONCILIATION_SUMMARY.md (10 min)
2. Review scenarios in DOMAIN_SPEC.md Section 5 (20 min)
3. Check ORDER_STATE_DIAGRAM.md for user flows (10 min)

**Backend Engineer**:
1. Read DOMAIN_SPEC.md Section 8 (Invariants) (15 min)
2. Study STATE_TRANSITION_MATRIX in Section 4 (20 min)
3. Review RECONCILIATION_SUMMARY.md for code quality notes (10 min)

**Frontend Engineer**:
1. Review ORDER_STATE_DIAGRAM.md (full) (30 min)
2. Read DOMAIN_SPEC.md Section 2 (Status Definitions) (10 min)
3. Check DOMAIN_SPEC.md Section 5 (Scenarios) for UI flow (20 min)

**QA Engineer**:
1. Read RECONCILIATION_SUMMARY.md Testing Verification section (10 min)
2. Review all scenarios in DOMAIN_SPEC.md Section 5 (30 min)
3. Use ORDER_STATE_DIAGRAM.md flows for test case creation (20 min)

**Support Staff**:
1. Study ORDER_STATE_DIAGRAM.md (primary reference) (30 min)
2. Read DOMAIN_SPEC.md Section 2 (Status Definitions) (10 min)
3. Review timeout rules in DOMAIN_SPEC.md Section 6 (10 min)

---

## Key Implementation Files

These source files implement the domain logic:

### Core State Machine
```
settle/src/lib/orders/stateMachine.ts
```
- Defines 12 statuses
- 44 transition rules
- Actor permission checks
- Timeout durations

### Order Repository
```
settle/src/lib/db/repositories/orders.ts
```
- Database operations (1146 lines)
- `updateOrderStatus()` - main state transition function
- `expireOldOrders()` - timeout handling
- Merchant reassignment logic (M2M)

### Next Step Logic
```
settle/src/lib/orders/getNextStep.ts
```
- Pure function (no side effects)
- Computes what user should do next
- Role determination (buyer vs. seller)
- Handles all 12 statuses

### Database Schema
```
settle/database/schema.sql
```
- PostgreSQL enum definitions (lines 16-39)
- Orders table (lines 151-235)
- Timestamp fields for audit trail

### Type Definitions
```
settle/src/lib/types/database.ts
```
- TypeScript types (lines 9-21)
- Order interface (lines 101-153)
- Actor type enum (line 22)

### API Validation
```
settle/src/lib/validation/schemas.ts
```
- Zod schemas (lines 29-42)
- Request validation
- Status enum validation

---

## Critical Invariants (Enforced)

These rules MUST NEVER be violated:

### 1. Escrow Integrity Invariant
```typescript
// orders.ts lines 476-488
if (newStatus === 'completed' && order.escrow_tx_hash && !order.release_tx_hash) {
  throw new Error('Cannot complete: escrow not released on-chain');
}
```
**Impact**: Prevents crypto theft

---

### 2. Terminal Status Finality Invariant
```typescript
// stateMachine.ts lines 154-159
if (TERMINAL_STATUSES.includes(currentStatus)) {
  throw new Error('Cannot transition from terminal status');
}
```
**Impact**: Ensures accounting integrity

---

### 3. Role-Based Transition Invariant
```typescript
// stateMachine.ts lines 180-186
if (!transitionRule.allowedActors.includes(actorType)) {
  throw new Error('Actor not allowed to perform this transition');
}
```
**Impact**: Prevents privilege escalation

---

### 4. Single Merchant Claim Invariant
```typescript
// orders.ts lines 445-448
const currentResult = await client.query(
  'SELECT * FROM orders WHERE id = $1 FOR UPDATE', // Row lock
  [orderId]
);
```
**Impact**: Prevents double-booking

---

### 5. Escrow-Locked Timeout → Dispute Invariant
```typescript
// orders.ts lines 1004-1020
const updateResult = await query(`
  UPDATE orders SET status = CASE
    WHEN status IN ('escrowed', 'payment_pending', ...) THEN 'disputed'
    ELSE 'cancelled'
  END
  ...
`);
```
**Impact**: Protects both parties when money is locked

---

## Testing Checklist

Before deploying changes based on this spec:

**Automated Tests**:
- [ ] State machine transitions (44 valid + 100+ invalid)
- [ ] Escrow integrity checks
- [ ] Timeout handling (2-tier system: 15 min + 120 min)
- [ ] M2M merchant reassignment
- [ ] Extension request approval flow
- [ ] Dispute creation and resolution
- [ ] Balance update atomicity
- [ ] Liquidity restoration

**Manual Testing Scenarios**:
- [ ] Happy path buy order (8 status transitions)
- [ ] Escrow-first sell order (7 status transitions)
- [ ] M2M trade (both buy and sell)
- [ ] Timeout cancellation (pending → expired)
- [ ] Timeout dispute (escrowed → disputed)
- [ ] Extension request (approved and declined)
- [ ] Dispute resolution (favor buyer and favor seller)
- [ ] Concurrent merchant acceptance (row lock test)

**Integration Tests**:
- [ ] Pusher notifications for all status changes
- [ ] Chat system messages appear correctly
- [ ] Reputation events recorded
- [ ] Solana escrow lock/release (devnet)
- [ ] Balance updates reflected in real-time

---

## Migration Path

### Required Migrations

#### Migration 023: Add Compliance Actor Type
```sql
ALTER TYPE actor_type ADD VALUE IF NOT EXISTS 'compliance';
```
**Priority**: Low (no runtime errors, compliance features not deployed)
**Impact**: Zero downtime (enum extension is additive)

---

### Recommended Updates (No Migration)

1. **Landing Page Comment** (`src/app/page.tsx` line 87):
   ```typescript
   // DEMO ONLY: Simplified for landing page mockup
   type LandingPageOrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed";
   ```

2. **State Machine Deprecation Comment** (`src/lib/orders/stateMachine.ts` line 29):
   ```typescript
   // DEPRECATED: Per-status timeouts replaced by 2-tier system (15 min + 120 min)
   export const STATUS_TIMEOUTS: Partial<Record<OrderStatus, number>> = {
     // Kept for reference only
   };
   ```

3. **JSDoc for Merchant Reassignment** (`src/lib/db/repositories/orders.ts` line 491):
   ```typescript
   /**
    * Merchant reassignment logic for M2M trades:
    * - If buyer_merchant_id already set: acceptor becomes merchant_id (seller)
    * - If buyer_merchant_id null: acceptor becomes buyer_merchant_id (buyer)
    */
   ```

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-12 | Agent D | Initial documentation created |

---

## Contact & Maintenance

**Documentation Owner**: Engineering Team
**Last Reviewed**: 2026-02-12
**Review Frequency**: Quarterly (or when major changes occur)

**Update Triggers**:
- New status added to enum
- State transition rules change
- Invariants modified
- Timeout rules adjusted
- Extension system updated

---

## Related Documentation

- `settle/TRANSACTION_LOGIC.md` - General transaction flow overview
- `settle/TX_FLOW.md` - Transaction processing details
- `settle/API_INTEGRATION.md` - API endpoint documentation
- `settle/docs/MEMPOOL_SYSTEM.md` - Mempool and AED quote system
- `settle/database/schema.sql` - Database schema reference

---

## FAQ

### Q: Which document should I read first?
**A**: Start with RECONCILIATION_SUMMARY.md (10 min read) to understand the current state, then dive into specific sections of DOMAIN_SPEC.md as needed.

---

### Q: Where is the state machine defined?
**A**: `settle/src/lib/orders/stateMachine.ts` is the source of truth. DOMAIN_SPEC.md Section 4 documents it.

---

### Q: How do I determine what action a user should take next?
**A**: Use `getNextStep()` function in `settle/src/lib/orders/getNextStep.ts`. See DOMAIN_SPEC.md Section 5 for scenarios.

---

### Q: What happens if an order times out after escrow is locked?
**A**: It goes to `disputed` status (NOT `cancelled`). See ORDER_STATE_DIAGRAM.md "Post-Escrow Timeout" section.

---

### Q: Can I merge the `expired` status into `cancelled`?
**A**: No. See RECONCILIATION_SUMMARY.md Decision 2 for rationale (analytics, reputation tracking).

---

### Q: Where are balance updates performed?
**A**: During escrow operations (lock/release), NOT during status changes. See DOMAIN_SPEC.md Section 7.

---

### Q: How many extensions can an order have?
**A**: 3 maximum. See DOMAIN_SPEC.md Section 9.

---

### Q: Who can resolve disputes?
**A**: Only `system` and `compliance` actors. See ORDER_STATE_DIAGRAM.md "Actor Permissions Matrix".

---

### Q: Is the system consistent across codebase?
**A**: Yes, with 2 minor documentation issues (see RECONCILIATION_SUMMARY.md Key Findings).

---

### Q: Where should I add a new status transition?
**A**:
1. Update `ALLOWED_TRANSITIONS` in `stateMachine.ts`
2. Add logic in `updateOrderStatus()` in `orders.ts`
3. Update `getNextStep()` in `getNextStep.ts`
4. Update this documentation

---

## Documentation Integrity

All documentation generated by Agent D (Consistency Enforcer) on 2026-02-12.

**Sources Analyzed**:
- Database schema (`schema.sql`)
- State machine implementation (`stateMachine.ts`)
- Order repository (`orders.ts`, 1146 lines)
- Next-step logic (`getNextStep.ts`)
- Type definitions (`database.ts`)
- Validation schemas (`schemas.ts`)
- 100+ grep matches across TypeScript files

**Cross-Reference Validation**: ✅ Passed
**Invariant Checks**: ✅ All enforced in code
**Status Enum Consistency**: ✅ Verified across 6 files
**Transition Matrix**: ✅ Matches implementation

---

**End of Index**
