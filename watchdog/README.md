# Blip watchdog

Permissionless watcher for the Blip V2.3 Anchor escrow program. Closes the two remaining stuck-funds paths:

- **PaymentSent stale** → sends `open_dispute` after `payment_confirmed_at + PAYMENT_STALE_THRESHOLD_SEC` (default 24h).
- **Dispute timeout** → sends `resolve_dispute_timeout` after `disputed_at + DISPUTE_WINDOW_SEC` (default 72h).

The watchdog keypair has **no privileged role** on-chain — it only pays tx fees.
Both instructions it calls are permissionless on-chain once their time condition is satisfied.

## Setup

```bash
cd watchdog
pnpm install    # or npm install / yarn install
cp .env.example .env
# edit .env — fill RPC_URL, PROGRAM_ID, KEYPAIR_PATH, IDL_PATH

# Place your IDL (must include openDispute and resolveDisputeTimeout).
# Regenerate after the most recent on-chain build:
#   cd ../<anchor-workspace> && anchor build
#   cp target/idl/blip_protocol_v2.json ../BM/watchdog/idl/

# Place a funded keypair (solana-keygen new -o ./keys/watchdog.json)
# Fund it with a few SOL for tx fees.
```

## Run

```bash
pnpm start
# or
npx tsx src/index.ts
```

Production: run under a process supervisor (systemd, pm2, Railway worker).
Structured JSON logs are written to stdout.

## Environment variables

| Var | Required | Default | Meaning |
|---|---|---|---|
| `RPC_URL` | ✅ | — | Solana RPC endpoint |
| `PROGRAM_ID` | ✅ | — | Deployed Blip program ID |
| `KEYPAIR_PATH` | ✅ | — | Path to Solana keypair JSON (array of bytes) |
| `IDL_PATH` | ✅ | — | Path to Anchor IDL JSON |
| `COMMITMENT` | — | `confirmed` | `processed` \| `confirmed` \| `finalized` |
| `PAYMENT_STALE_THRESHOLD_SEC` | — | `86400` | Must equal on-chain `Trade::PAYMENT_STALE_THRESHOLD` |
| `DISPUTE_WINDOW_SEC` | — | `259200` | Must equal on-chain `Trade::DISPUTE_WINDOW` |
| `POLL_INTERVAL_MS` | — | `45000` | Tick cadence |
| `MAX_TX_PER_TICK` | — | `20` | Per-status cap |
| `CONCURRENCY` | — | `4` | In-flight tx limit |
| `CLOCK_SKEW_BUFFER_SEC` | — | `60` | Delay before triggering to avoid `PaymentNotStale` / `DisputeWindowActive` races |
| `TX_RETRIES` | — | `3` | Non-benign error retries (exponential backoff) |

## Safety properties

- **Idempotent.** If another actor (party, another watchdog instance, arbiter) acts first, the tx reverts with a benign error pattern (`CannotDispute`, `NotDisputed`, etc.) which is logged at `info` and skipped — no retry.
- **Rate-limited.** `MAX_TX_PER_TICK` caps the number of txs sent per status per tick.
- **Concurrency-bounded.** `CONCURRENCY` limits in-flight RPC requests.
- **Clock-skew resistant.** `CLOCK_SKEW_BUFFER_SEC` avoids the race where the client believes the window has elapsed but the on-chain `Clock::unix_timestamp` disagrees.
- **Graceful shutdown.** SIGINT/SIGTERM exit cleanly between ticks.

## Operational tips

- Fund the keypair with ≥0.1 SOL; each tx costs ~5000 lamports.
- Run exactly **one** instance per program-id to keep logs legible. Multiple instances are safe (idempotent) but produce redundant skips.
- Alert on `retry_exhausted` and sustained `tick_failed` events — these indicate RPC outage or program-state corruption.

## Accepted non-idempotent edge cases

- If the Anchor account layout changes (fields added/removed before `status`), `STATUS_OFFSET = 120` in `src/index.ts` must be updated. Regenerate the IDL and verify the offset against the on-chain `Trade` struct before deploying.
