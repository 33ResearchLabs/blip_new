# Gap Analysis - Settle P2P Crypto Settlement App

**Date**: 2024-01-16
**Status**: Initial Analysis

## Executive Summary

The Settle app has a solid foundation with PostgreSQL database, API routes, and frontend components. However, several critical gaps need to be addressed before production deployment.

---

## 1. Security Gaps (CRITICAL)

### 1.1 No Authorization Middleware
- **Issue**: All API routes lack proper authorization checks
- **Impact**: Any user can access any order, any merchant's data
- **Fix**: Add wallet-based authorization to all protected routes
- **Priority**: P0

### 1.2 No Input Validation
- **Issue**: API endpoints accept any input without validation
- **Impact**: Potential for malformed data, injection attacks
- **Fix**: Add Zod schemas for all request bodies and query params
- **Priority**: P0

### 1.3 No Rate Limiting
- **Issue**: No protection against spam/abuse
- **Impact**: Order spam, message spam, API abuse
- **Fix**: Add basic rate limiting middleware
- **Priority**: P1

### 1.4 Data Leakage Risk
- **Issue**: Bank details may be returned to unauthorized parties
- **Impact**: Privacy violation, potential fraud
- **Fix**: Filter sensitive data based on actor role
- **Priority**: P0

### 1.5 XSS in Chat Messages
- **Issue**: Chat messages not sanitized
- **Impact**: XSS attacks via malicious messages
- **Fix**: Sanitize message content before storage and display
- **Priority**: P1

---

## 2. Functional Gaps

### 2.1 Missing API Endpoints
| Endpoint | Purpose | Priority |
|----------|---------|----------|
| `POST /api/orders/[id]/dispute` | Raise dispute | P1 |
| `GET /api/disputes/[id]` | Get dispute details | P1 |
| `PATCH /api/disputes/[id]` | Update dispute (admin) | P2 |
| `PATCH /api/merchant/offers/[id]` | Update offer | P1 |
| `DELETE /api/merchant/offers/[id]` | Disable/delete offer | P1 |
| `DELETE /api/users/[id]/bank-accounts/[accountId]` | Delete bank account | P2 |

### 2.2 Order State Machine Not Enforced
- **Issue**: Status transitions not validated server-side
- **Impact**: Orders can be corrupted via invalid transitions
- **Fix**: Create centralized state machine with allowed transitions
- **Priority**: P0

### 2.3 Idempotency Not Guaranteed
- **Issue**: Repeated accept/complete calls may double-apply
- **Impact**: Data corruption, duplicate events
- **Fix**: Add idempotency checks in status update logic
- **Priority**: P0

### 2.4 Review Duplicate Prevention Incomplete
- **Issue**: Reviews table has UNIQUE on order_id but no server check
- **Impact**: DB error instead of graceful handling
- **Fix**: Check for existing review before insert
- **Priority**: P2

### 2.5 Order Expiry Not Automated
- **Issue**: `expireOldOrders()` exists but never called
- **Impact**: Stale pending orders never expire
- **Fix**: Add cron job or API route for cleanup
- **Priority**: P1

---

## 3. Database Gaps

### 3.1 Missing Constraints
- `wallet_address` should be UNIQUE on users and merchants tables
- `order_number` should be UNIQUE (has trigger but no constraint)

### 3.2 Missing Indexes
- `idx_orders_expires_at` for expiry queries
- `idx_chat_messages_is_read` for unread count queries

### 3.3 No Migration Strategy
- Only raw schema.sql, no versioned migrations
- Manual application required

### 3.4 Seed Data Hardcoded
- Seed data in schema.sql, not separate

---

## 4. Reliability Gaps

### 4.1 Polling Without Backoff
- **Issue**: Fixed 2-5 second polling intervals
- **Impact**: Unnecessary load, no error recovery
- **Fix**: Add exponential backoff on failures
- **Priority**: P2

### 4.2 No Error UI
- **Issue**: API errors not shown to users
- **Impact**: Silent failures, poor UX
- **Fix**: Add error boundaries, toast notifications
- **Priority**: P2

### 4.3 Chat Polling Inefficient
- **Issue**: Fetches all messages on every poll
- **Impact**: Unnecessary data transfer
- **Fix**: Use `since` parameter for incremental fetches
- **Priority**: P2

---

## 5. Observability Gaps

### 5.1 No Structured Logging
- **Issue**: Only console.error for errors
- **Impact**: Hard to debug production issues
- **Fix**: Add structured logging with context
- **Priority**: P1

### 5.2 No Admin/Debug Tools
- **Issue**: No way to inspect orders/events
- **Impact**: Support/debugging difficulty
- **Fix**: Add protected admin routes
- **Priority**: P2

---

## 6. Testing Gaps

### 6.1 No Test Setup
- **Issue**: No test framework configured
- **Impact**: No automated testing
- **Fix**: Add Jest, test scripts, test DB config
- **Priority**: P1

### 6.2 No Unit Tests
- No tests for state machine, repositories
- **Priority**: P1

### 6.3 No API Tests
- No integration tests for routes
- **Priority**: P1

---

## 7. Deployment Gaps

### 7.1 No Deploy Documentation
- No step-by-step deployment guide
- **Priority**: P1

### 7.2 Build/Typecheck Status Unknown
- Need to verify clean build
- **Priority**: P0

---

## Implementation Order

### Phase 1: Critical Security & Correctness (This Sprint)
1. Order state machine with strict transitions
2. Zod validation on all API routes
3. Authorization checks on protected routes
4. Idempotency for status changes

### Phase 2: Functional Completeness
5. Missing API endpoints (disputes, offer management)
6. Order expiry automation
7. Database constraints

### Phase 3: Reliability & Testing
8. Structured logging
9. Unit tests for state machine
10. API integration tests
11. Polling improvements

### Phase 4: Documentation & Deploy
12. Test plan documentation
13. Deployment documentation
14. Admin debug tools

---

## Files to Create/Modify

### New Files
- `/src/lib/orders/stateMachine.ts` - Order state machine
- `/src/lib/validation/schemas.ts` - Zod schemas
- `/src/lib/middleware/auth.ts` - Authorization helpers
- `/src/lib/middleware/rateLimit.ts` - Rate limiting
- `/src/lib/logger.ts` - Structured logging
- `/src/app/api/orders/[id]/dispute/route.ts` - Dispute endpoint
- `/src/app/api/disputes/[id]/route.ts` - Dispute management
- `/tests/` - Test directory
- `/docs/definition-of-done.md`
- `/docs/test-plan.md`
- `/docs/deploy.md`

### Modified Files
- All API routes - Add validation, auth, logging
- `/database/schema.sql` - Add constraints
- `/package.json` - Add test scripts, zod dependency
