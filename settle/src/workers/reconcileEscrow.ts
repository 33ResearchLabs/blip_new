/**
 * Escrow Reconciler
 *
 * Periodic scan that reconciles on-chain Blip V2 Trade PDAs against the
 * `orders` table and records every mismatch into
 * `escrow_reconciliation_findings` for admin review.
 *
 * This is an OBSERVABILITY + RECORD system. It never mutates orders,
 * escrow_debited_entity_id, merchant/user balances, or the ledger. It
 * never signs on-chain refunds autonomously. Auto-remediation on a
 * fintech system with a single bug is a worse outcome than a queued
 * finding that an admin reviews. The existing refund path (backend
 * signer keypair + merchant-initiated orphaned-escrow record) handles
 * the remediation side; this worker just surfaces the work.
 *
 * Idempotency:
 *   - Each "open" finding is UNIQUE by (kind, trade_pda, order_id).
 *   - Re-runs increment seen_count + last_seen_run on the same row
 *     rather than producing duplicates.
 *   - Resolved findings are not re-opened unless the underlying
 *     condition reappears (different trade_pda or same one flipped back).
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { query, queryOne, transaction } from '@/lib/db';
import { getConnection } from '@/lib/solana/escrow';
import { BLIP_V2_PROGRAM_ID } from '@/lib/solana/v2/config';
import { safeLog } from '@/lib/errorTracking/logger';
import { logger } from 'settlement-core';

const SOLANA_NETWORK: 'devnet' | 'mainnet-beta' =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';

// Order statuses that claim an on-chain escrow exists.
const DB_ESCROWED_STATUSES = [
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing',
];

// Terminal DB statuses that SHOULD match a terminal on-chain status.
const DB_TERMINAL_STATUSES = ['completed', 'cancelled', 'expired'];

// Trade.status enum (deployed program, verified empirically 2026-04-20 via
// a successful release: lock → byte 1, counterparty payment → byte 3,
// release → byte 5). Earlier audited versions used fewer variants; keep
// this list in sync with the *deployed* program, not the source repo I
// audited. Locking/release success is what the reconciler primarily
// cares about.
const ON_CHAIN_STATUS = {
  Created: 0,
  Locked: 1,
  // byte 2 observed as an intermediate (legacy `Released`?) — treat as
  // compatible with the same post-payment states.
  PaymentSent: 3,
  Disputed: 4,
  Released: 5,
  Refunded: 6,
} as const;

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

interface OnChainTrade {
  tradePda: string;
  creator: string;
  counterparty: string;
  tradeId: string;     // u64 as string
  mint: string;
  amountRaw: bigint;   // u64 base units
  status: number;      // 0..3
  lockedAt: number;
  createdAt: number;
}

interface DbOrderRow {
  id: string;
  status: string;
  type: 'buy' | 'sell';
  crypto_amount: string;        // numeric
  crypto_currency: string | null;
  escrow_tx_hash: string | null;
  escrow_trade_pda: string | null;
  escrow_debited_entity_id: string | null;
  escrow_debited_amount: string | null;
  merchant_id: string | null;
  user_id: string | null;
}

export type FindingKind =
  | 'orphaned_escrow'
  | 'ghost_db'
  | 'amount_mismatch'
  | 'status_mismatch';

export interface ReconcileOptions {
  /** If true, findings are recorded but no alerts are fired. */
  dryRun?: boolean;
  /** Max number of on-chain trades to scan per run. Protects RPC budget. */
  limit?: number;
  /** Only scan trades whose on-chain status is one of these bytes. */
  statusFilter?: number[];
}

export interface ReconcileSummary {
  runId: string;
  tradesScanned: number;
  ordersScanned: number;
  findingsNew: number;
  findingsExisting: number;
  byKind: Record<FindingKind, number>;
  dryRun: boolean;
  durationMs: number;
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

/**
 * Trade account layout (8-byte Anchor discriminator + struct).
 * Mirrors `state/trade.rs`. Kept as explicit offsets so this scanner is
 * independent of Anchor client version (the 0.30+ IDL breaks
 * `program.account.trade.all()` under anchor@0.29, so we decode the
 * raw account data ourselves).
 */
const TRADE_DISC_LEN = 8;
/**
 * Anchor account discriminator for the `Trade` account:
 * sha256("account:Trade")[..8] = [132, 139, 123, 31, 157, 196, 244, 190].
 * Base58-encoded here so it can be used directly as a getProgramAccounts
 * memcmp filter (Solana RPC expects base58 for memcmp bytes).
 *
 * Using a discriminator filter at offset 0 is more robust than filtering
 * by `dataSize` — the Trade struct changed size across program versions
 * (audited version = 150 bytes, currently-deployed version = 206 bytes),
 * and a size filter silently excludes accounts of the other version.
 * The discriminator is derived from the account name + "account:" prefix
 * and never changes for the same account type.
 */
const TRADE_DISCRIMINATOR_BS58 = 'PArMwd2r6Ff';
const TRADE_OFFSET = {
  CREATOR: 8,
  COUNTERPARTY: 40,
  TRADE_ID: 72,
  MINT: 80,
  AMOUNT: 112,
  STATUS: 120,
  CREATED_AT: 125,
  LOCKED_AT: 133,
} as const;

/** Base58-encode a single status byte for RPC memcmp filter. */
const BS58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function bs58EncodeStatusByte(b: number): string {
  if (b < 58) return BS58_ALPHABET[b];
  return BS58_ALPHABET[Math.floor(b / 58)] + BS58_ALPHABET[b % 58];
}

/**
 * JSON replacer that serialises BigInt values as strings. The chain
 * snapshot for on-chain trades contains a `u64` amount that decodes as
 * BigInt; JSON.stringify blows up on BigInt by default.
 */
function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

function humanToRawUsdt(amount: string | number): bigint {
  const s = typeof amount === 'number' ? amount.toString() : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return BigInt(0);
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fracPadded || '0');
}

function statusCompatibility(dbStatus: string, chainStatus: number): 'ok' | 'mismatch' {
  // DB has more states than chain. Accept the superset of chain states
  // that could legitimately correspond to each DB status. In-flight trades
  // show up as `Locked` OR `PaymentSent` on-chain; those should both be
  // "ok" for escrowed/payment_sent/payment_confirmed/releasing DB statuses.
  const inFlightChain: number[] = [
    ON_CHAIN_STATUS.Locked,
    ON_CHAIN_STATUS.PaymentSent,
    ON_CHAIN_STATUS.Disputed,
  ];
  if (DB_ESCROWED_STATUSES.includes(dbStatus)) {
    return inFlightChain.includes(chainStatus) ? 'ok' : 'mismatch';
  }
  if (dbStatus === 'completed') {
    // Accept legacy byte 2 as well in case old program instances linger.
    return chainStatus === ON_CHAIN_STATUS.Released || chainStatus === 2 ? 'ok' : 'mismatch';
  }
  if (dbStatus === 'cancelled' || dbStatus === 'expired') {
    return chainStatus === ON_CHAIN_STATUS.Refunded ? 'ok' : 'mismatch';
  }
  return 'ok';
}

// ───────────────────────────────────────────────────────────────────────
// On-chain scan
// ───────────────────────────────────────────────────────────────────────

/**
 * Decode a Trade account buffer at the known layout offsets.
 * Byte layout mirrors `state/trade.rs`; kept in sync with TRADE_OFFSET
 * at the top of the file.
 */
function decodeTrade(pubkey: PublicKey, data: Buffer): OnChainTrade {
  const creator = new PublicKey(data.subarray(TRADE_OFFSET.CREATOR, TRADE_OFFSET.CREATOR + 32));
  const counterparty = new PublicKey(
    data.subarray(TRADE_OFFSET.COUNTERPARTY, TRADE_OFFSET.COUNTERPARTY + 32),
  );
  const tradeId = data.readBigUInt64LE(TRADE_OFFSET.TRADE_ID).toString();
  const mint = new PublicKey(data.subarray(TRADE_OFFSET.MINT, TRADE_OFFSET.MINT + 32));
  const amountRaw = data.readBigUInt64LE(TRADE_OFFSET.AMOUNT);
  const status = data.readUInt8(TRADE_OFFSET.STATUS);
  const createdAt = Number(data.readBigInt64LE(TRADE_OFFSET.CREATED_AT));
  const lockedAt = Number(data.readBigInt64LE(TRADE_OFFSET.LOCKED_AT));
  return {
    tradePda: pubkey.toBase58(),
    creator: creator.toBase58(),
    counterparty: counterparty.toBase58(),
    tradeId,
    mint: mint.toBase58(),
    amountRaw,
    status,
    lockedAt,
    createdAt,
  };
}

async function scanOnChainTrades(
  connection: Connection,
  opts: ReconcileOptions,
): Promise<OnChainTrade[]> {
  // Use getProgramAccounts directly: the V2.3 IDL's 0.30+ shape breaks
  // anchor@0.29's `program.account.trade.all()` path (accounts array
  // must be empty to let `new Program()` succeed, which strips the
  // .account client). Manual decode keeps this scanner independent of
  // Anchor client version.
  // Filter by the Anchor account discriminator at offset 0 — matches any
  // Trade account regardless of struct size (the currently-deployed program
  // has 206-byte Trade accounts; an earlier version had 150-byte). A size
  // filter would miss either set. Discriminator is stable.
  //
  // Solana RPC AND-combines all filters, so we cannot express "status IN
  // (1, 3)" in a single call — that would require status byte to be both
  // values simultaneously. Instead we issue one RPC per requested status
  // byte and merge. When no statusFilter is supplied, a single call with
  // just the discriminator returns every Trade account.
  type GpaFilter =
    | { dataSize: number }
    | { memcmp: { offset: number; bytes: string } };
  const baseFilter: GpaFilter = {
    memcmp: { offset: 0, bytes: TRADE_DISCRIMINATOR_BS58 },
  };

  const requests: Array<GpaFilter[]> =
    opts.statusFilter && opts.statusFilter.length > 0
      ? opts.statusFilter.map((byte) => [
          baseFilter,
          { memcmp: { offset: TRADE_OFFSET.STATUS, bytes: bs58EncodeStatusByte(byte) } },
        ])
      : [[baseFilter]];

  const results = await Promise.all(
    requests.map((filters) =>
      connection.getProgramAccounts(BLIP_V2_PROGRAM_ID, {
        commitment: 'confirmed',
        filters,
      }),
    ),
  );

  // Merge + dedupe by pubkey (safe even if the same account appeared in
  // two status groups due to an RPC race during a state change).
  const seen = new Set<string>();
  const accounts: { pubkey: PublicKey; account: { data: Buffer } }[] = [];
  for (const batch of results) {
    for (const entry of batch) {
      const k = entry.pubkey.toBase58();
      if (seen.has(k)) continue;
      seen.add(k);
      accounts.push(entry as { pubkey: PublicKey; account: { data: Buffer } });
    }
  }

  const mapped: OnChainTrade[] = [];
  for (const { pubkey, account } of accounts) {
    const data = account.data as Buffer;
    // Defensive: skip anything whose discriminator/size doesn't match.
    if (!Buffer.isBuffer(data) || data.length < TRADE_DISC_LEN + 150 - TRADE_DISC_LEN) continue;
    try {
      mapped.push(decodeTrade(pubkey, data));
    } catch {
      // malformed account — skip rather than abort the run
    }
  }

  if (opts.limit && opts.limit > 0 && mapped.length > opts.limit) {
    return mapped.slice(0, opts.limit);
  }
  return mapped;
}

// ───────────────────────────────────────────────────────────────────────
// DB scan
// ───────────────────────────────────────────────────────────────────────

async function scanDbOrders(tradePdas: string[]): Promise<{
  byTradePda: Map<string, DbOrderRow>;
  escrowClaimants: DbOrderRow[];
}> {
  // Pull in two sets:
  //   (a) every order whose status claims an escrow exists OR whose
  //       escrow_trade_pda is non-null (→ escrowClaimants),
  //   (b) every order that matches a trade_pda we observed on-chain
  //       (→ byTradePda for exact-match lookup).
  //
  // Both come from a single query with WHERE ... UNION semantics via
  // OR. The pda list can get large; chunk if needed, but 5k is fine.
  const placeholders = tradePdas.map((_, i) => `$${i + 1}`).join(',');
  const filterSql =
    tradePdas.length > 0
      ? `escrow_trade_pda IN (${placeholders})
         OR status::text = ANY($${tradePdas.length + 1}::text[])`
      : `status::text = ANY($1::text[])`;

  const params: unknown[] =
    tradePdas.length > 0
      ? [...tradePdas, [...DB_ESCROWED_STATUSES, ...DB_TERMINAL_STATUSES]]
      : [[...DB_ESCROWED_STATUSES, ...DB_TERMINAL_STATUSES]];

  const rows = await query<DbOrderRow>(
    `SELECT id, status, type, crypto_amount, crypto_currency,
            escrow_tx_hash, escrow_trade_pda,
            escrow_debited_entity_id, escrow_debited_amount,
            merchant_id, user_id
       FROM orders
      WHERE ${filterSql}`,
    params,
  );

  const byTradePda = new Map<string, DbOrderRow>();
  const escrowClaimants: DbOrderRow[] = [];
  for (const r of rows) {
    if (r.escrow_trade_pda) byTradePda.set(r.escrow_trade_pda, r);
    if (DB_ESCROWED_STATUSES.includes(r.status)) escrowClaimants.push(r);
  }
  return { byTradePda, escrowClaimants };
}

// ───────────────────────────────────────────────────────────────────────
// Finding upsert
// ───────────────────────────────────────────────────────────────────────

async function upsertFinding(args: {
  runId: string;
  kind: FindingKind;
  tradePda: string | null;
  orderId: string | null;
  escrowTxHash: string | null;
  chain: unknown;
  db: unknown;
  suggestedAction: string;
  severity?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
}): Promise<'new' | 'existing'> {
  // The partial UNIQUE index on (kind, COALESCE(trade_pda,''), COALESCE(order_id::text,''))
  // WHERE resolved_at IS NULL ensures one open row per key. ON CONFLICT
  // requires naming that exact expression tuple — use a CTE instead.
  const result = await transaction(async (client) => {
    const existing = await client.query<{ id: string; seen_count: number }>(
      `SELECT id, seen_count
         FROM escrow_reconciliation_findings
        WHERE kind = $1
          AND COALESCE(trade_pda, '') = COALESCE($2, '')
          AND COALESCE(order_id::text, '') = COALESCE($3, '')
          AND resolved_at IS NULL
        FOR UPDATE`,
      [args.kind, args.tradePda, args.orderId],
    );

    if (existing.rows.length > 0) {
      await client.query(
        `UPDATE escrow_reconciliation_findings
            SET seen_count = seen_count + 1,
                last_seen_run = $2,
                updated_at = now()
          WHERE id = $1`,
        [existing.rows[0].id, args.runId],
      );
      return 'existing' as const;
    }

    await client.query(
      `INSERT INTO escrow_reconciliation_findings
         (first_seen_run, last_seen_run, kind, trade_pda, order_id,
          escrow_tx_hash, chain_snapshot, db_snapshot,
          suggested_action, severity)
       VALUES ($1, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        args.runId,
        args.kind,
        args.tradePda,
        args.orderId,
        args.escrowTxHash,
        JSON.stringify(args.chain ?? null, bigintSafeReplacer),
        JSON.stringify(args.db ?? null, bigintSafeReplacer),
        args.suggestedAction,
        args.severity ?? 'CRITICAL',
      ],
    );
    return 'new' as const;
  });
  return result;
}

// ───────────────────────────────────────────────────────────────────────
// Main entry point
// ───────────────────────────────────────────────────────────────────────

export async function runReconciliation(
  opts: ReconcileOptions = {},
): Promise<ReconcileSummary> {
  const startedAt = Date.now();
  const dryRun = opts.dryRun === true;

  const runRow = await queryOne<{ id: string }>(
    `INSERT INTO escrow_reconciliation_runs (dry_run) VALUES ($1) RETURNING id`,
    [dryRun],
  );
  if (!runRow) throw new Error('failed_to_create_reconciliation_run');
  const runId = runRow.id;

  const byKind: Record<FindingKind, number> = {
    orphaned_escrow: 0,
    ghost_db: 0,
    amount_mismatch: 0,
    status_mismatch: 0,
  };

  let tradesScanned = 0;
  let ordersScanned = 0;
  let findingsNew = 0;
  let findingsExisting = 0;

  try {
    const connection = getConnection(SOLANA_NETWORK);
    const onChain = await scanOnChainTrades(connection, opts);
    tradesScanned = onChain.length;

    const { byTradePda, escrowClaimants } = await scanDbOrders(
      onChain.map((t) => t.tradePda),
    );
    ordersScanned = byTradePda.size + escrowClaimants.length;

    // ---- Pass 1: orphaned escrows (on-chain without DB) -------------
    for (const t of onChain) {
      const db = byTradePda.get(t.tradePda);
      if (!db) {
        // Only Locked escrows can be funds-at-risk. Created = PDA but
        // no vault funded; Released/Refunded = already settled. We
        // still record non-Locked orphans at a lower severity because
        // they suggest the backend failed to record a trade lifecycle.
        const severity = t.status === ON_CHAIN_STATUS.Locked ? 'CRITICAL' : 'WARN';
        const res = await upsertFinding({
          runId,
          kind: 'orphaned_escrow',
          tradePda: t.tradePda,
          orderId: null,
          escrowTxHash: null,
          chain: t,
          db: null,
          suggestedAction:
            t.status === ON_CHAIN_STATUS.Locked
              ? 'admin_refund_depositor'
              : 'admin_review',
          severity,
        });
        res === 'new' ? findingsNew++ : findingsExisting++;
        byKind.orphaned_escrow++;
        continue;
      }

      // ---- Pass 2: amount + status mismatches (both sides exist) ----
      const dbRawAmount = humanToRawUsdt(db.crypto_amount);
      if (dbRawAmount !== t.amountRaw) {
        const res = await upsertFinding({
          runId,
          kind: 'amount_mismatch',
          tradePda: t.tradePda,
          orderId: db.id,
          escrowTxHash: db.escrow_tx_hash,
          chain: { amountRaw: t.amountRaw.toString() },
          db: { crypto_amount: db.crypto_amount, rawEquivalent: dbRawAmount.toString() },
          suggestedAction: 'admin_review',
          severity: 'CRITICAL',
        });
        res === 'new' ? findingsNew++ : findingsExisting++;
        byKind.amount_mismatch++;
      }

      const compat = statusCompatibility(db.status, t.status);
      if (compat === 'mismatch') {
        const res = await upsertFinding({
          runId,
          kind: 'status_mismatch',
          tradePda: t.tradePda,
          orderId: db.id,
          escrowTxHash: db.escrow_tx_hash,
          chain: { status: t.status },
          db: { status: db.status },
          suggestedAction: 'admin_review',
          severity: 'CRITICAL',
        });
        res === 'new' ? findingsNew++ : findingsExisting++;
        byKind.status_mismatch++;
      }
    }

    // ---- Pass 3: ghost DB entries (DB without on-chain) -------------
    const onChainSet = new Set(onChain.map((t) => t.tradePda));
    for (const db of escrowClaimants) {
      if (!db.escrow_trade_pda) {
        // DB claims escrowed but has no tradePda — must have been
        // locked via mock path or a pre-V2 flow. Flag separately.
        const res = await upsertFinding({
          runId,
          kind: 'ghost_db',
          tradePda: null,
          orderId: db.id,
          escrowTxHash: db.escrow_tx_hash,
          chain: null,
          db,
          suggestedAction: 'admin_review_no_trade_pda',
          severity: 'WARN',
        });
        res === 'new' ? findingsNew++ : findingsExisting++;
        byKind.ghost_db++;
        continue;
      }

      if (!onChainSet.has(db.escrow_trade_pda)) {
        const res = await upsertFinding({
          runId,
          kind: 'ghost_db',
          tradePda: db.escrow_trade_pda,
          orderId: db.id,
          escrowTxHash: db.escrow_tx_hash,
          chain: null,
          db,
          suggestedAction: 'admin_review_missing_on_chain',
          severity: 'CRITICAL',
        });
        res === 'new' ? findingsNew++ : findingsExisting++;
        byKind.ghost_db++;
      }
    }

    // ---- Finalize run row ------------------------------------------
    await query(
      `UPDATE escrow_reconciliation_runs
          SET finished_at = now(),
              status = 'completed',
              trades_scanned = $1,
              orders_scanned = $2,
              findings_new = $3,
              findings_existing = $4,
              metadata = $5::jsonb
        WHERE id = $6`,
      [
        tradesScanned,
        ordersScanned,
        findingsNew,
        findingsExisting,
        JSON.stringify({ byKind }),
        runId,
      ],
    );

    // ---- Alerting --------------------------------------------------
    if (!dryRun && findingsNew > 0) {
      // One error_log entry per kind with aggregate counts. Individual
      // findings are already queued in escrow_reconciliation_findings.
      for (const [kind, count] of Object.entries(byKind) as Array<
        [FindingKind, number]
      >) {
        if (count === 0) continue;
        safeLog({
          type: `reconcile.${kind}`,
          message: `Escrow reconciliation found ${count} ${kind} finding(s) in run ${runId}`,
          severity: kind === 'orphaned_escrow' || kind === 'amount_mismatch' || kind === 'status_mismatch' ? 'CRITICAL' : 'WARN',
          source: 'worker',
          metadata: { runId, kind, count, tradesScanned, ordersScanned },
        });
      }
    }

    logger.info('[Reconcile] Run complete', {
      runId,
      tradesScanned,
      ordersScanned,
      findingsNew,
      findingsExisting,
      byKind,
    });

    return {
      runId,
      tradesScanned,
      ordersScanned,
      findingsNew,
      findingsExisting,
      byKind,
      dryRun,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    await query(
      `UPDATE escrow_reconciliation_runs
          SET finished_at = now(), status = 'failed', error_message = $1
        WHERE id = $2`,
      [msg.slice(0, 2000), runId],
    );
    safeLog({
      type: 'reconcile.failed',
      message: `Escrow reconciliation run ${runId} failed: ${msg}`,
      severity: 'ERROR',
      source: 'worker',
      metadata: { runId, err: msg.slice(0, 400) },
    });
    throw err;
  }
}
