#!/usr/bin/env tsx
/**
 * Orphan-Escrow Sweep — full historical recovery tool.
 *
 * Walks every recent signature for a given wallet, decodes the ones that
 * funded an escrow PDA, then cross-references each on-chain trade against
 * the `orders` table:
 *
 *   on-chain trade        | settle order            | classification
 *   ──────────────────────┼─────────────────────────┼──────────────────────────
 *   funded, > 0 USDT      | exists, escrow_* set    | NORMAL — already tracked
 *   funded, > 0 USDT      | exists, escrow_* NULL   | BACKFILL ME — settle didn't catch the on-chain
 *   funded, > 0 USDT      | does not exist          | SYNTHETIC ME — user-side flow never created the row
 *   empty (refunded)      | any                     | RESOLVED — escrow PDA closed/zeroed, nothing to do
 *
 * Default mode prints a report. With `--execute` it inserts/updates the
 * needed rows. Refunding the actual on-chain funds still requires the
 * depositor's signature (UI flow), but after this script runs the orders
 * table is consistent and the merchant-side auto-refund hook can pick up
 * the cancelled-with-escrow rows.
 *
 * Usage:
 *   tsx scripts/sweep-orphan-escrows.ts --wallet <pubkey> [--limit 100] [--execute]
 *
 * Cost: 1 RPC call per signature for full decode. With limit 100 and a
 * Helius rate-limited key this completes in ~30-60 s.
 */

import { config as dotenv } from 'dotenv';
import { resolve } from 'path';
dotenv({ path: resolve(__dirname, '..', '.env.local') });

type Args = {
  wallet?: string;
  limit: number;
  execute: boolean;
  dryRun: boolean;
};

function parseArgs(): Args {
  const a: Args = { limit: 100, execute: false, dryRun: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--wallet') { a.wallet = v; i++; }
    else if (k === '--limit') { a.limit = Math.min(1000, Math.max(1, parseInt(v, 10) || 100)); i++; }
    else if (k === '--execute') a.execute = true;
    else if (k === '--dry-run') a.dryRun = true;
  }
  if (!a.execute && !a.dryRun) a.dryRun = true;
  return a;
}

const RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  process.env.SOLANA_RPC_URL ||
  'https://api.devnet.solana.com';

async function rpc<T>(method: string, params: any): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result;
}

type Decoded = {
  signature: string;
  blockTime: number;
  tradeId: string;
  tradePda: string;
  escrowAta: string | null;
  creatorWallet: string;
  fundedAmount: number;
};

/**
 * Decode the on-chain tx to extract escrow funding details. Returns null
 * if it's not an escrow-funding tx (the wallet has many other tx kinds —
 * sends, receives, refunds, etc., and we only care about ones that
 * created/funded an escrow that may now be orphaned).
 */
async function decodeFundingTx(sig: string): Promise<Decoded | null> {
  let tx: any;
  try {
    tx = await rpc('getTransaction', [
      sig,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    ]);
  } catch {
    return null;
  }
  if (!tx || tx.meta?.err) return null;

  const logs: string[] = tx.meta?.logMessages || [];
  let tradeId: string | undefined;
  let tradePda: string | undefined;
  let fundedAmountU64: string | undefined;

  for (const l of logs) {
    const idMatch = l.match(/Trade created: id=(\d+)/);
    if (idMatch) tradeId = idMatch[1];
    const fundMatch = l.match(/Escrow funded.*trade=([1-9A-HJ-NP-Za-km-z]{32,44}),\s*amount=(\d+)/);
    if (fundMatch) {
      tradePda = fundMatch[1];
      fundedAmountU64 = fundMatch[2];
    }
    // Also catch lock_escrow flow which logs differently
    const lockMatch = l.match(/Escrow locked.*trade=([1-9A-HJ-NP-Za-km-z]{32,44}),\s*amount=(\d+)/);
    if (lockMatch) {
      tradePda = lockMatch[1];
      fundedAmountU64 = lockMatch[2];
    }
  }
  if (!tradePda || !tradeId) return null;

  // Find the wallet that paid into escrow (largest negative USDT delta)
  const pre = (tx.meta?.preTokenBalances || []) as any[];
  const post = (tx.meta?.postTokenBalances || []) as any[];
  let creatorWallet: string | undefined;
  let escrowAta: string | undefined;
  let maxDebit = 0;
  let maxCredit = 0;
  const accountKeys = (tx.transaction.message?.accountKeys || []) as any[];

  for (const b of post) {
    const beforeMatch = pre.find((p: any) => p.accountIndex === b.accountIndex);
    const beforeUi = parseFloat(beforeMatch?.uiTokenAmount?.uiAmountString || '0');
    const afterUi = parseFloat(b.uiTokenAmount?.uiAmountString || '0');
    const delta = afterUi - beforeUi;
    if (delta < -0.0001 && b.owner) {
      if (Math.abs(delta) > Math.abs(maxDebit)) {
        maxDebit = delta;
        creatorWallet = b.owner;
      }
    } else if (delta > 0.0001 && b.owner) {
      if (delta > maxCredit) {
        maxCredit = delta;
        const acctKey = accountKeys[b.accountIndex]?.pubkey;
        escrowAta = acctKey;
      }
    }
  }

  if (!creatorWallet) return null;
  return {
    signature: sig,
    blockTime: tx.blockTime,
    tradeId,
    tradePda,
    escrowAta: escrowAta ?? null,
    creatorWallet,
    fundedAmount: maxCredit,
  };
}

async function getEscrowAtaBalance(escrowAta: string | null): Promise<number | null> {
  if (!escrowAta) return null;
  try {
    const r = (await rpc('getTokenAccountBalance', [escrowAta, { commitment: 'confirmed' }])) as
      | { value?: { uiAmount?: number } }
      | null;
    return r?.value?.uiAmount ?? 0;
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs();
  if (!args.wallet) {
    console.error('missing --wallet <pubkey>');
    process.exit(1);
  }

  console.log(`→ scanning last ${args.limit} signatures for ${args.wallet} via ${RPC}`);
  const sigs = (await rpc('getSignaturesForAddress', [
    args.wallet,
    { limit: args.limit },
  ])) as Array<{ signature: string; err: any; blockTime: number }>;

  const fundings: Decoded[] = [];
  for (const s of sigs) {
    if (s.err) continue;
    const d = await decodeFundingTx(s.signature);
    if (d) fundings.push(d);
  }
  console.log(`✓ found ${fundings.length} escrow-funding tx out of ${sigs.length} sigs`);

  // ── Cross-reference each funding tx with settle DB and on-chain state ──
  const { query } = await import('../src/lib/db');

  type Row = {
    decoded: Decoded;
    onChainBalance: number | null;
    settleOrder: {
      id: string;
      status: string;
      escrow_tx_hash: string | null;
      escrow_creator_wallet: string | null;
      escrow_trade_id: string | null;
      release_tx_hash: string | null;
    } | null;
    classification:
      | 'normal'
      | 'backfill_me'
      | 'synthetic_me'
      | 'resolved_already_refunded'
      | 'resolved_no_funds'
      | 'unknown';
  };

  const rows: Row[] = [];
  for (const d of fundings) {
    const balance = await getEscrowAtaBalance(d.escrowAta);

    // Look up the order by escrow_trade_id (most reliable) or escrow_tx_hash.
    const matches = await query<{
      id: string;
      status: string;
      escrow_tx_hash: string | null;
      escrow_creator_wallet: string | null;
      escrow_trade_id: string | null;
      release_tx_hash: string | null;
    }>(
      `SELECT id, status, escrow_tx_hash, escrow_creator_wallet,
              escrow_trade_id::text AS escrow_trade_id, release_tx_hash
         FROM orders
        WHERE escrow_trade_id::text = $1
           OR escrow_tx_hash = $2
        ORDER BY updated_at DESC LIMIT 1`,
      [d.tradeId, d.signature],
    );
    const order = matches[0] ?? null;

    let classification: Row['classification'] = 'unknown';
    if (balance === null) classification = 'unknown';
    else if (balance < 0.001) {
      classification = order?.release_tx_hash
        ? 'resolved_already_refunded'
        : 'resolved_no_funds';
    } else if (order && order.escrow_tx_hash) {
      classification = 'normal';
    } else if (order && !order.escrow_tx_hash) {
      classification = 'backfill_me';
    } else if (!order) {
      classification = 'synthetic_me';
    }

    rows.push({ decoded: d, onChainBalance: balance, settleOrder: order, classification });
  }

  // ── Report ─────────────────────────────────────────────────────────────
  const fmtTs = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const grouped: Record<string, Row[]> = {};
  for (const r of rows) {
    (grouped[r.classification] ??= []).push(r);
  }

  console.log('');
  console.log('═══ SUMMARY ═══════════════════════════════════════');
  for (const k of [
    'normal',
    'backfill_me',
    'synthetic_me',
    'resolved_already_refunded',
    'resolved_no_funds',
    'unknown',
  ] as const) {
    const list = grouped[k] || [];
    const totalUsdt = list.reduce((s, r) => s + (r.onChainBalance || 0), 0);
    console.log(
      `  ${k.padEnd(28)}  count=${String(list.length).padStart(3)}` +
        (totalUsdt > 0 ? `   stuck=${totalUsdt.toFixed(2)} USDT` : ''),
    );
  }
  console.log('');

  if (grouped.backfill_me?.length || grouped.synthetic_me?.length) {
    console.log('═══ ACTIONABLE ROWS ════════════════════════════════');
    for (const r of [
      ...(grouped.backfill_me || []),
      ...(grouped.synthetic_me || []),
    ]) {
      console.log('');
      console.log(`  [${r.classification}]   ${r.decoded.signature.slice(0, 32)}…`);
      console.log(`    blockTime    ${fmtTs(r.decoded.blockTime)} UTC`);
      console.log(`    creator      ${r.decoded.creatorWallet}`);
      console.log(`    trade_id     ${r.decoded.tradeId}`);
      console.log(`    trade_pda    ${r.decoded.tradePda}`);
      console.log(`    escrow_ata   ${r.decoded.escrowAta}`);
      console.log(`    on-chain     ${r.onChainBalance?.toFixed(2)} USDT (still funded)`);
      if (r.settleOrder) {
        console.log(
          `    settle row   ${r.settleOrder.id} status=${r.settleOrder.status}` +
            ` escrow_tx_hash=${r.settleOrder.escrow_tx_hash ? 'set' : 'NULL'}`,
        );
      } else {
        console.log(`    settle row   (none — needs synthetic insert)`);
      }
    }
  }

  if (args.dryRun) {
    console.log('');
    console.log('Dry-run only. Re-run with --execute to apply backfills (synthetic inserts skipped).');
    process.exit(0);
  }

  // ── Execute (backfills only — synthetic inserts left manual) ───────────
  let updated = 0;
  for (const r of grouped.backfill_me || []) {
    if (!r.settleOrder) continue;
    const result = await query(
      `UPDATE orders SET
         escrow_tx_hash             = $2,
         escrow_address             = COALESCE(escrow_address, $3),
         escrow_trade_pda           = COALESCE(escrow_trade_pda, $4),
         escrow_trade_id            = COALESCE(escrow_trade_id, $5),
         escrow_creator_wallet      = COALESCE(escrow_creator_wallet, $6),
         escrow_debited_entity_type = COALESCE(escrow_debited_entity_type, 'merchant'),
         escrow_debited_amount      = COALESCE(escrow_debited_amount, $7),
         escrow_debited_at          = COALESCE(escrow_debited_at, $8::timestamptz),
         escrowed_at                = COALESCE(escrowed_at, $8::timestamptz),
         order_version              = order_version + 1,
         updated_at                 = NOW()
       WHERE id = $1
       RETURNING id`,
      [
        r.settleOrder.id,
        r.decoded.signature,
        r.decoded.escrowAta ?? '',
        r.decoded.tradePda,
        r.decoded.tradeId,
        r.decoded.creatorWallet,
        r.decoded.fundedAmount,
        new Date(r.decoded.blockTime * 1000).toISOString(),
      ],
    );
    if (result.length > 0) {
      updated++;
      console.log(`  ✓ backfilled order ${r.settleOrder.id} (trade_id=${r.decoded.tradeId})`);
    }
  }
  console.log('');
  console.log(`✓ executed: ${updated} backfill(s)`);
  if ((grouped.synthetic_me?.length || 0) > 0) {
    console.log(
      `⚠ ${grouped.synthetic_me!.length} synthetic insert(s) NOT applied — they need an offer/merchant context`,
    );
    console.log(
      '  (use the per-order recover-orphan-escrow.ts script to handle those, OR build a synth inserter that accepts a default merchant/rate)',
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('✗ error:', (err as Error).message);
  process.exit(1);
});
