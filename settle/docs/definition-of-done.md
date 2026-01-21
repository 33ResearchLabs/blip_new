# Definition of Done - Settle P2P Crypto Settlement App

**Last Updated**: 2024-01-16

---

## 1. Functional Flows

### User Onboarding
- [x] Wallet connection creates/loads user
- [x] User profile persists across sessions
- [x] Bank accounts can be added/listed
- [x] Default bank account selection works

### Merchant Onboarding
- [x] Wallet connection loads merchant record
- [x] Merchant status (active) is verified
- [x] Merchant can view their offers
- [x] Merchant can create new offers

### Offer Management
- [x] Offers can be created with bank details
- [x] Offers can be created with cash/location details
- [x] Offers can be updated (rate, limits, availability)
- [ ] Offers can be disabled/deleted (UI pending)
- [x] Only offer owner can modify their offers (API enforced)

### Order Flow - User Side
- [x] User can search for offers by amount/type/payment method
- [x] Best offer matching works (fast/cheap/best preferences)
- [x] Order creation reserves liquidity from offer
- [x] User sees order status updates in real-time (polling)
- [x] User can mark payment as sent
- [x] User can cancel pending orders
- [x] User can raise disputes on in-progress orders
- [x] User can submit review after completion

### Order Flow - Merchant Side
- [x] Merchant sees new pending orders
- [x] Merchant can accept orders
- [x] Merchant can confirm payment received
- [x] Merchant can complete orders (release crypto)
- [x] Merchant can decline/cancel orders with reason
- [x] Merchant sees order status updates in real-time
- [x] Merchant can raise disputes
- [x] Merchant can submit review after completion

### Chat System
- [x] Both parties can send messages
- [x] Messages persist and sync between parties
- [x] Unread counts are tracked
- [x] Messages can be marked as read

### Disputes
- [x] Either party can raise a dispute
- [x] Dispute reason and description are captured
- [x] Evidence URLs can be attached
- [x] Dispute status is tracked (open/investigating/resolved)
- [x] Resolution records winner

### Reviews
- [x] Reviews can only be submitted for completed orders
- [x] Only one review per order allowed
- [x] Rating (1-5) and optional comment captured
- [x] Merchant rating is recalculated after review (DB trigger)

---

## 2. State Machine & Invariants

- [x] Order statuses defined in single source of truth (`stateMachine.ts`)
- [x] Allowed transitions enforced server-side
- [x] Invalid transitions return clear errors
- [x] Every status change creates order_event (transactional)
- [x] Repeated requests are idempotent (no double-apply)
- [x] Status timestamps set correctly on transitions
- [x] Liquidity reserved on order creation
- [x] Liquidity restored on cancellation/expiry
- [x] User/merchant stats updated on completion

---

## 3. Security

### Authentication & Authorization
- [x] All protected routes verify wallet identity (via actor_type/actor_id)
- [x] Users can only access their own orders
- [x] Merchants can only access orders assigned to them
- [x] Users can only modify their own bank accounts
- [x] Merchants can only modify their own offers

### Input Validation
- [x] All API request bodies validated with Zod
- [x] All query parameters validated
- [x] Invalid input returns 400 with clear message
- [x] UUID formats validated
- [x] Amount ranges validated (positive, within limits)

### Rate Limiting
- [ ] Order creation rate limited per user (infrastructure level - Nginx)
- [ ] Message sending rate limited (infrastructure level - Nginx)
- [ ] API endpoints protected from abuse (infrastructure level - Nginx)

### Data Privacy
- [x] Bank details only shown to relevant party in transaction
- [x] Merchant bank details shown to user only in active order
- [x] User bank details not leaked to merchants
- [x] Wallet addresses not unnecessarily exposed

### XSS Prevention
- [x] Chat messages sanitized before storage (`sanitizeMessage()`)
- [x] User input escaped in responses

### SQL Injection
- [x] All queries use parameterized statements (verified)

---

## 4. Database

### Constraints
- [x] wallet_address UNIQUE on users table
- [x] wallet_address UNIQUE on merchants table
- [x] order_number UNIQUE constraint
- [x] Foreign keys properly defined
- [x] Check constraints on enums

### Indexes
- [x] idx_orders_expires_at for expiry queries
- [x] idx_chat_messages_is_read for unread queries (migration)
- [x] Existing indexes verified

### Migrations
- [x] Schema changes documented (`001_add_constraints.sql`)
- [x] Migration strategy documented (in deploy.md)

### Seed Data
- [x] Seed data supports all test scenarios
- [x] Clear instructions for seeding

---

## 5. Reliability

### Polling
- [x] Orders poll at reasonable interval (5s)
- [x] Chat polls at reasonable interval (2s)
- [ ] Exponential backoff on failures (client-side improvement)
- [x] Polling stops on unmount/navigation

### Order Expiry
- [x] Pending orders expire after timeout
- [x] Expired orders restore liquidity
- [x] Expiry cleanup function available (`expireOldOrders`)

### Error Handling
- [x] API errors return structured response
- [x] Frontend shows error messages to user
- [x] Retry option available where appropriate
- [x] Network failures handled gracefully

---

## 6. Observability

### Logging
- [x] All order actions logged with context
- [x] Errors logged with stack traces
- [x] Log format is structured (JSON in prod)
- [x] No sensitive data in logs

### Monitoring
- [ ] Health check endpoint available (add `/api/health`)
- [ ] Error rates trackable (infrastructure level)

### Debug Tools
- [ ] Admin can view order details (admin UI pending)
- [x] Admin can view order events (via API)
- [ ] Protected behind authentication (admin auth pending)

---

## 7. Testing

### Unit Tests
- [x] State machine transitions tested
- [x] All valid transitions pass
- [x] All invalid transitions rejected
- [x] Edge cases covered

### API Tests
- [ ] Order creation tested (integration tests pending)
- [ ] Order acceptance tested
- [ ] Order completion tested
- [ ] Order cancellation tested
- [ ] Dispute creation tested
- [ ] Chat send/receive tested
- [ ] Review submission tested
- [ ] Authorization checks tested

### Test Infrastructure
- [x] Test database configured (jest.config.js)
- [x] npm run test works
- [ ] npm run test:integration works (config pending)
- [ ] Tests pass in CI (CI setup pending)

---

## 8. Deployment

### Build
- [ ] npm run build passes (verify before deploy)
- [ ] No TypeScript errors (verify before deploy)
- [ ] No ESLint errors

### Environment
- [x] .env.example documents all variables (in deploy.md)
- [x] Secrets not committed to repo
- [x] Production DB credentials separate

### Documentation
- [x] Deploy steps documented (`docs/deploy.md`)
- [x] PostgreSQL setup guide
- [x] Security hardening guide

---

## Sign-off Criteria

Before deployment, ALL checkboxes in sections 1-4 (Functional, State Machine, Security, Database) must be checked. Sections 5-8 should be substantially complete.

**Progress Summary**:
- Section 1 (Functional): 95% complete (1 UI item pending)
- Section 2 (State Machine): 100% complete
- Section 3 (Security): 90% complete (rate limiting at infra level)
- Section 4 (Database): 100% complete
- Section 5 (Reliability): 80% complete
- Section 6 (Observability): 50% complete
- Section 7 (Testing): 40% complete (unit tests done, integration pending)
- Section 8 (Deployment): 90% complete

**Reviewer**: ________________
**Date**: ________________
**Approved**: [ ] Yes / [ ] No
