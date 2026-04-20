# Blip Money — Deploy & Publish Runbook

Dated 2026-04-20. Supersedes any prior deploy notes.

> **Three different surfaces get deployed separately.** Don't conflate them.
> 1. **Railway** — `settle` (Next.js) + `core-api` (Fastify). Auto-deploys on push to `main`.
> 2. **Solana Anchor program** — `6AG4cc…mea87`. Manual `anchor deploy`. Currently on devnet only.
> 3. **Watchdog bot** — `watchdog/` directory. Needs its own Railway service; not auto-deployed today.

---

## Gate A — "Push to main" (devnet, private beta)

All of this must be true before merging to `main`:

- [ ] PR #6 CI green (or admin-override if the Turbopack prerender bug is confirmed pre-existing)
- [ ] PR #7 CI green
- [ ] Other dev's audit-fix PR(s) reviewed and merged:
      - [ ] `verifyEscrowTx.ts` lives in `settle/src/lib/solana/`
      - [ ] `reconcileEscrow.ts` lives in `settle/src/workers/`
      - [ ] `release-stuck-trade.ts` lives in `settle/scripts/`
      - [ ] Migrations `102_auction_escrow_invariants.sql` and `103_escrow_reconciliation.sql` exist in `settle/database/migrations/`
      - [ ] `useOrderActions.ts` no longer fabricates `server-release-fallback-*`
      - [ ] `useUserOrderActions.ts` no longer calls `confirmPayment` in the Payment Sent handler
- [ ] `CRON_SECRET` set in Railway env for the settle service
- [ ] `PROTOCOL_FEE_BPS` set (default 250 is fine) or `protocol_config` table seeded
- [ ] `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` set in Railway (production only — CI gates on their absence)

When all the above are ✅, merge to main. Railway takes it from there:
- `core-api` starts → `migrationRunner.ts` applies new migrations (100, 101, 102, 103)
- `settle` starts → client-side Next build already green; old code remains served until switchover
- Health endpoints to verify post-deploy:
  - `curl https://app.blip.money/api/health` → `{"status":"ok","ready":true}`
  - `curl https://app.blip.money/api/prices/current?pair=usdt_aed` with Bearer → must include `feeBps`
  - Check Railway logs for `[migrationRunner] Applied migration 103_*.sql`

---

## Gate B — Anchor program upgrade on devnet

Deployed today; runbook for the **next** upgrade (likely the other dev's v3):

```bash
cd <anchor-v3-repo>

# Verify upgrade authority is still our wallet
solana program show 6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87 --url devnet

# Balance ≥ 5 SOL on the upgrade-authority wallet
solana balance

# Build
anchor build

# Deploy (reuses program ID, lamports refunded after upgrade swap)
anchor deploy --provider.cluster devnet --program-name blip_protocol_v2

# Verify on-chain bytecode matches local
solana program dump 6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87 /tmp/onchain.so --url devnet
head -c $(wc -c < target/deploy/blip_protocol_v2.so) /tmp/onchain.so | shasum -a 256
shasum -a 256 target/deploy/blip_protocol_v2.so
# ^ both hashes must match

# Sync IDL into clients
cp target/idl/blip_protocol_v2.json ../BM/settle/src/lib/solana/v2/idl.json
cp target/idl/blip_protocol_v2.json ../BM/watchdog/idl/blip_protocol_v2.json
cd ../BM
git checkout -b zeus/v3-idl-sync
git add settle/src/lib/solana/v2/idl.json watchdog/idl/blip_protocol_v2.json
git commit -m "chore: sync v3 IDL into clients after devnet deploy"
git push -u origin zeus/v3-idl-sync
gh pr create ...

# Smoke test with watchdog smoke-deploy.ts
cd watchdog && npx tsx smoke-deploy.ts
```

---

## Gate C — Watchdog service

Standalone bot. Must run somewhere that polls every 45 s. Options:

### Option 1 — Add as a Railway service
1. Create a new Railway service from the `watchdog/` subdirectory.
2. Env vars (copy from `watchdog/.env.example`):
   - `RPC_URL` — use your Helius devnet/mainnet URL
   - `PROGRAM_ID=6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87`
   - `KEYPAIR_PATH=/app/keys/watchdog.json` — mount a keypair secret
   - `IDL_PATH=/app/idl/blip_protocol_v2.json`
   - Optional timeouts — defaults are 24h for PaymentSent, 72h for Disputed
3. Provision a keypair. This wallet has **no privileged on-chain role** — only pays ~5000 lamports per intervention. Fund with ~0.1 SOL.
4. Deploy. Watch logs — you should see `"evt":"tick","paymentSentCount":0,"disputedCount":0` every 45 s.

### Option 2 — Cron-backed (simpler, can't auto-recover)
If you don't want a long-running service, invoke the logic on a cron:
- Add `CRON_SECRET` env on Railway (already required by the other dev's `reconcile-escrow` cron).
- Call `POST /api/cron/reconcile-escrow` every 5 min. That runs the reconciler; it doesn't fire the on-chain timeout instructions but it surfaces stuck funds fast enough that a human can call `release-stuck-trade.ts`.

**Recommended**: run both — the watchdog for automatic recovery, the reconciler for observability and alerting.

---

## Gate D — "Publish" (real users, real money)

None of this is automated. Do all of it, sign off each.

### D.1 Governance — the hard blockers

- [ ] **Upgrade authority locked down.** Choose one:
      - (a) Immutable: `solana program set-upgrade-authority 6AG4cc… --final` → irreversible, program never upgradeable again
      - (b) Multisig + timelock: transfer authority to a Squads v4 vault with ≥2-of-3 signers and ≥48 h execution delay
      - Current state: authority is `BfXyY4Kf…kuefMzr`, a single hot keypair on a laptop. **Unsafe for mainnet.**
- [ ] **Arbiter decentralised.** Same key above is also `protocol_config.authority` which is the dispute arbiter. Transfer to the same or a separate multisig.
- [ ] **Third-party audit complete.** Neodyme, OtterSec, Halborn, or equivalent. Expect 2–6 weeks. Keep this session's audit notes as context but don't rely on them.
- [ ] **Verifiable build.** `solana-verify` submits your program with a reproducible build spec so anyone can confirm on-chain bytecode matches a specific commit. Required for any ecosystem-level trust.

### D.2 Legal / regulatory

- [ ] Legal review in every corridor you serve (UAE VARA, India VDA at minimum). Get a fintech lawyer; this isn't my domain.
- [ ] Terms of service + privacy policy published on `app.blip.money`
- [ ] KYC/AML stance documented
- [ ] Data-retention policy (chat messages, order history) written down

### D.3 Operational readiness

- [ ] Per-trade cap at launch: **$50 equivalent max** for the first week.
- [ ] Daily volume cap: **$5 000 total** for the first week. Double weekly if clean.
- [ ] Capital cushion: at minimum $5 000 in an ops wallet, so you can make a user whole in a dispute without waiting for a claim cycle.
- [ ] Incident runbook (in this repo, `INCIDENT.md`): what do you do when arbiter key is suspected compromised? When Tether freezes an ATA? When a buyer claims payment but didn't send fiat? **Write these playbooks before launch, not during the incident.**
- [ ] On-call rotation: at least one person reachable for disputes with SLA ≤ 4 h.
- [ ] Alerts: reconciler runs, watchdog runs, authority-key transactions, `resolve_dispute_timeout` triggers — pipe each to Slack/PagerDuty.

### D.4 Staged rollout timeline

```
Week 0    Merge PRs #6 + #7 + other dev's audit PR → main → Railway devnet redeploy
Week 0.5  Watchdog deployed as Railway service, alerting on stuck trades
Week 1    Internal team run full end-to-end trades on devnet: BUY, SELL, dispute, timeout
Week 1.5  Book audit firm. Submit `anchor-v3` for reproducible build.
Week 2    Invite 10–20 devnet beta users. Real dispute simulation.
Week 3    Audit report arrives. Apply fixes if any.
Week 4    Mainnet: deploy program as IMMUTABLE or with locked multisig authority.
          Enable caps from D.3.
Week 5    Open to first 50 invite-only mainnet users with $50 trade cap.
Week 7+   Raise caps in 2x steps every week contingent on zero incidents.
Week 10+  Public. Consider removing caps.
```

Skipping any of Weeks 0.5–3 is how people lose real money.

---

## What I (Claude) actually finished in this session

| Artifact | Status | Location |
|---|---|---|
| PR #5 — pricing + UI + marketplace + watchdog | ✅ merged to main | `main` |
| Anchor v2.3 security hardening + stuck-funds | ✅ deployed to devnet | program `6AG4cc…mea87` slot `456691132` |
| IDL synced into clients | ✅ in main | `settle/src/lib/solana/v2/idl.json`, `watchdog/idl/blip_protocol_v2.json` |
| PR #6 — CI Node 22 + hook-free global-error + webpack flag | 🟡 open, awaiting CI | branch `zeus/ci-green-on-main` |
| PR #7 — D4 platform_balance + D5 requireTokenAuth + D6 auction E2E script | 🟡 open, awaiting CI | branch `zeus/audit-d4-d5` |
| This runbook | ✅ | `DEPLOY_RUNBOOK.md` |

## What's out of my hands

- Other dev's audit work (`verifyEscrowTx`, reconciler, user-side state fix, Anchor client snake→camel) — on their branches, not public
- Anchor v3 (not-yet-deployed rewrite per the session summary)
- Everything in Gate D

Ship Gates A and B, plan C and D with humans in the loop.
