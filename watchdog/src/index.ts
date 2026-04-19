import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { AnchorProvider, BN, Idl, Program, Wallet } from "@coral-xyz/anchor";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import fs from "node:fs";
import { CONFIG, loadKeypair } from "./config.js";
import { log } from "./logger.js";

// ─── Trade account layout (Anchor discriminator + fields) ──────────────────
//  8 disc + 32 creator + 32 counterparty + 8 trade_id + 32 mint + 8 amount
// = 120 bytes before the `status` enum byte.
const STATUS_OFFSET        = 120;
const STATUS_PAYMENT_SENT  = 3;
const STATUS_DISPUTED      = 4;

// PDA seed constants — must match on-chain program.
const ESCROW_SEED          = Buffer.from("escrow-v2");
const VAULT_AUTHORITY_SEED = Buffer.from("vault-authority-v2");

// Anchor / program error substrings that indicate a benign race or
// precondition not yet met — we log + skip these, never retry.
const BENIGN_ERRORS = [
  "CannotDispute",
  "NotDisputed",
  "NotParty",
  "DisputeWindowActive",
  "PaymentNotStale",
  "MustUseDispute",
  "AccountNotInitialized",
  "already in use",
  "custom program error: 0x",
];

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function isBenign(msg: string): boolean {
  return BENIGN_ERRORS.some((m) => msg.includes(m));
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  let lastErr: unknown;
  for (let i = 0; i < CONFIG.txRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = errMsg(e);
      if (isBenign(msg)) {
        log("info", "skip_benign", { label, reason: msg.slice(0, 240) });
        return null;
      }
      const delay = 500 * 2 ** i;
      log("warn", "retry", { label, attempt: i + 1, delayMs: delay, err: msg.slice(0, 240) });
      await sleep(delay);
    }
  }
  log("error", "retry_exhausted", { label, err: errMsg(lastErr).slice(0, 400) });
  return null;
}

function escrowPda(programId: PublicKey, trade: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([ESCROW_SEED, trade.toBuffer()], programId)[0];
}
function vaultAuthorityPda(programId: PublicKey, escrow: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED, escrow.toBuffer()], programId)[0];
}

// ─── Fetch trades by status byte (memcmp on raw account data) ──────────────

type TradeAcct = {
  publicKey: PublicKey;
  account: {
    creator: PublicKey;
    counterparty: PublicKey;
    tradeId: BN;
    mint: PublicKey;
    amount: BN;
    paymentConfirmedAt: BN;
    disputedAt: BN;
    lockedAt: BN;
    createdAt: BN;
    settledAt: BN;
  } & Record<string, unknown>;
};

async function fetchTradesByStatus(
  program: Program,
  statusByte: number,
): Promise<TradeAcct[]> {
  // Anchor's `.all(filters)` passes memcmp to RPC getProgramAccounts;
  // `bytes` is base58-encoded.
  const rows = await (program.account as any).trade.all([
    {
      memcmp: {
        offset: STATUS_OFFSET,
        bytes: bs58.encode(Buffer.from([statusByte])),
      },
    },
  ]);
  return rows as TradeAcct[];
}

// ─── Handlers ──────────────────────────────────────────────────────────────

async function handlePaymentSent(
  program: Program,
  signer: PublicKey,
  trade: TradeAcct,
  now: number,
): Promise<void> {
  const pcAt = trade.account.paymentConfirmedAt.toNumber();
  if (pcAt <= 0) return;

  const deadline = pcAt + CONFIG.paymentStaleThresholdSec + CONFIG.clockSkewBufferSec;
  if (now < deadline) return;

  const tradePda = trade.publicKey;
  const escrow = escrowPda(program.programId, tradePda);
  const label = `open_dispute:${tradePda.toBase58().slice(0, 8)}`;

  await withRetry(label, async () => {
    const sig = await (program.methods as any)
      .openDispute()
      .accounts({
        initiator: signer,
        trade: tradePda,
        escrow,
      })
      .rpc({ commitment: CONFIG.commitment });

    log("info", "opened_dispute", {
      trade: tradePda.toBase58(),
      sig,
      stale_for_sec: now - pcAt,
    });
    return sig;
  });
}

async function handleDisputed(
  program: Program,
  signer: PublicKey,
  trade: TradeAcct,
  now: number,
): Promise<void> {
  const dAt = trade.account.disputedAt.toNumber();
  if (dAt <= 0) return;

  const deadline = dAt + CONFIG.disputeWindowSec + CONFIG.clockSkewBufferSec;
  if (now < deadline) return;

  const tradePda = trade.publicKey;
  const escrow = escrowPda(program.programId, tradePda);
  const label = `resolve_dispute_timeout:${tradePda.toBase58().slice(0, 8)}`;

  // We need escrow.depositor + escrow.vault_ata to build the accounts struct.
  const escrowAcc = (await (program.account as any).escrow.fetch(escrow)) as {
    depositor: PublicKey;
    vaultAta: PublicKey;
  };
  const vaultAuthority = vaultAuthorityPda(program.programId, escrow);
  const mint = trade.account.mint;
  const creator = trade.account.creator;
  const depositorAta = await getAssociatedTokenAddress(mint, escrowAcc.depositor);

  await withRetry(label, async () => {
    const sig = await (program.methods as any)
      .resolveDisputeTimeout()
      .accounts({
        signer,
        trade: tradePda,
        escrow,
        vaultAuthority,
        vaultAta: escrowAcc.vaultAta,
        depositorAta,
        creator,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc({ commitment: CONFIG.commitment });

    log("info", "resolved_timeout", {
      trade: tradePda.toBase58(),
      sig,
      stale_for_sec: now - dAt,
      depositor: escrowAcc.depositor.toBase58(),
    });
    return sig;
  });
}

// ─── Concurrency-limited runner (no external deps) ─────────────────────────

async function runParallel<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const runners = Array.from(
    { length: Math.min(Math.max(1, limit), items.length || 1) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        try {
          await worker(item);
        } catch (e) {
          log("error", "worker_unhandled", { err: errMsg(e).slice(0, 240) });
        }
      }
    },
  );
  await Promise.all(runners);
}

// ─── Main tick ─────────────────────────────────────────────────────────────

async function tick(program: Program, signer: PublicKey): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const [paySent, disputed] = await Promise.all([
    withRetry("fetch_payment_sent", () => fetchTradesByStatus(program, STATUS_PAYMENT_SENT)).then(
      (v) => v ?? [],
    ),
    withRetry("fetch_disputed", () => fetchTradesByStatus(program, STATUS_DISPUTED)).then(
      (v) => v ?? [],
    ),
  ]);

  log("info", "tick", {
    now,
    paymentSentCount: paySent.length,
    disputedCount: disputed.length,
  });

  const pSlice = paySent.slice(0, CONFIG.maxTxPerTick);
  const dSlice = disputed.slice(0, CONFIG.maxTxPerTick);

  await runParallel(pSlice, CONFIG.concurrency, (t) => handlePaymentSent(program, signer, t, now));
  await runParallel(dSlice, CONFIG.concurrency, (t) => handleDisputed(program, signer, t, now));
}

// ─── Boot ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const kp: Keypair = loadKeypair(CONFIG.keypairPath);
  const connection = new Connection(CONFIG.rpcUrl, CONFIG.commitment);
  const provider = new AnchorProvider(connection, new Wallet(kp), {
    commitment: CONFIG.commitment,
  });
  const idl = JSON.parse(fs.readFileSync(CONFIG.idlPath, "utf8")) as Idl;
  const program = new Program(idl, CONFIG.programId, provider);

  const balance = await connection.getBalance(kp.publicKey).catch(() => 0);
  log("info", "boot", {
    programId: CONFIG.programId.toBase58(),
    signer: kp.publicKey.toBase58(),
    signerBalanceSol: balance / 1e9,
    rpc: CONFIG.rpcUrl.replace(/api-key=[^&]+/, "api-key=****"),
    paymentStaleSec: CONFIG.paymentStaleThresholdSec,
    disputeWindowSec: CONFIG.disputeWindowSec,
    pollMs: CONFIG.pollIntervalMs,
    maxTxPerTick: CONFIG.maxTxPerTick,
    concurrency: CONFIG.concurrency,
  });

  let stopping = false;
  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log("info", "shutdown", { sig });
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Main loop — bounded per-tick work, never throws up.
  while (!stopping) {
    try {
      await tick(program, kp.publicKey);
    } catch (e) {
      log("error", "tick_failed", { err: errMsg(e).slice(0, 400) });
    }
    await sleep(CONFIG.pollIntervalMs);
  }
}

main().catch((e) => {
  log("error", "fatal", { err: errMsg(e).slice(0, 800) });
  process.exit(1);
});
