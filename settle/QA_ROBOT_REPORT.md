# QA Robot Report

## Test Suite Overview

| Spec File | Tests | Description |
|-----------|-------|-------------|
| `trade-buy-flow.spec.ts` | 5 | Full buy lifecycle: pending -> accepted -> escrowed -> payment_sent -> completed |
| `cancel-flow.spec.ts` | 3 | Cancel from pending, cancel from accepted, seeded cancelled verification |
| `expiry-flow.spec.ts` | 2 | Seeded expired order, system-initiated expiry |
| `chat.spec.ts` | 3 | Open chat, message via API, chat input elements |
| `state-matrix.spec.ts` | 11 | All 8 states API validation, dashboard screenshot, 8 individual state screenshots, disputed info |

**Total: 24 tests across 5 spec files**

## Infrastructure Created

### A) TEST_MODE + Seeding
- **Existing endpoints reused**: `POST /api/test/reset` and `POST /api/test/seed` (already guarded by `NODE_ENV !== 'production'`)
- **Seed data**: 2 users, 2 merchants, 3 offers (from `settle/src/lib/test/seedData.ts`)
- **`seedFullScenario()`** helper creates one order per state (8 total) via core-api transitions
- **Deterministic**: All fixtures created fresh per test suite run via `beforeAll`

### B) Stable Selectors (data-testid)

| Selector | Component | Location |
|----------|-----------|----------|
| `merchant-dashboard` | Root dashboard | `page.tsx:3599` |
| `order-card-{orderId}` | Order card (pending) | `PendingOrdersPanel.tsx` |
| `order-card-{orderId}` | Order card (in-progress) | `InProgressPanel.tsx` |
| `order-status` | Status badge | `InProgressPanel.tsx`, `OrderDetailsPanel.tsx` |
| `order-primary-action` | Main action button | `InProgressPanel.tsx`, `OrderDetailsPanel.tsx` |
| `order-accept` | Accept button | `OrderDetailsPanel.tsx` |
| `order-complete` | Confirm receipt button | `OrderDetailsPanel.tsx` |
| `order-cancel` | Cancel button | `OrderDetailsPanel.tsx` |
| `order-dispute` | View dispute button | `OrderDetailsPanel.tsx` |
| `order-timer` | Timer display | `InProgressPanel.tsx`, `PendingOrdersPanel.tsx` |
| `chat-panel` | Chat container | `TradeChat.tsx` |
| `chat-input` | Chat text input | `TradeChat.tsx` |
| `chat-send` | Chat send button | `TradeChat.tsx` |
| `chat-msg-{msgId}` | Message bubble | `TradeChat.tsx` |

### C) Observability
- **`NetworkLogger`**: Records all HTTP requests/responses with URL, method, status, size
- **`ConsoleErrorCollector`**: Captures console errors/warnings, filters known-benign patterns (HMR, Pusher, hydration)
- **Screenshots**: Taken at every test step, saved to `e2e/results/`

### D) Runner
- **Command**: `pnpm qa:robot`
- **Script**: `scripts/qa-robot.sh`
- **Flow**: Start core-api + settle in TEST_MODE -> health check -> run Playwright -> output report
- **CI-ready**: Headless by default, JSON report at `settle/e2e/results/report.json`

## Issues Fixed

| # | Component | Issue | Fix |
|---|-----------|-------|-----|
| 1 | All components | No `data-testid` attributes for test automation | Added 14 stable test selectors across 4 components |

## Remaining Issues (Product Decisions Required)

| # | Area | Issue | Decision Needed |
|---|------|-------|-----------------|
| 1 | Auth | Merchant dashboard uses wallet-based auth in production; tests use cookie-based auth | Decide if debug auth mode (cookie-based) should be formalized for TEST_MODE |
| 2 | Timer | 15-minute global timeout means orders expire during long test runs | Consider a TEST_MODE flag to extend/disable expiry timers |
| 3 | Status labels | `expired` orders show as "cancelled" in UI (intentional?) | Confirm if expired should have distinct UI treatment |
| 4 | Chat | Chat depends on WebSocket/Pusher for real-time delivery | Tests use API polling; real-time chat tests would need WS mock |
| 5 | Escrow | On-chain escrow is mocked in tests (mock tx hashes) | Real on-chain tests need separate devnet setup |
| 6 | Order card visibility | Completed/cancelled/expired orders may not appear on main dashboard (filtered to history) | Tests fall back to full-page screenshots when cards aren't visible |
| 7 | M2M trading | M2M order flows not covered in current test suite | Add M2M-specific tests if M2M trading needs QA coverage |

## File Inventory

```
settle/
  playwright.config.ts          # Playwright configuration
  e2e/
    fixtures.ts                 # Test fixtures (network logger, console errors, navigation)
    helpers/
      api.ts                    # API helpers (seed, create, transition, cancel, dispute)
      network-logger.ts         # Network request recorder
      console-errors.ts         # Console error collector
    trade-buy-flow.spec.ts      # Buy flow tests
    cancel-flow.spec.ts         # Cancel flow tests
    expiry-flow.spec.ts         # Expiry flow tests
    chat.spec.ts                # Chat tests
    state-matrix.spec.ts        # State matrix + screenshot tests
    results/
      .gitkeep                  # Results directory placeholder

scripts/
  qa-robot.sh                   # One-command runner
```

## Running

```bash
# Full test suite
pnpm qa:robot

# Specific test
pnpm qa:robot -- --grep "State Matrix"

# Within settle directory
cd settle && npx playwright test

# With UI (debugging)
cd settle && npx playwright test --ui
```
