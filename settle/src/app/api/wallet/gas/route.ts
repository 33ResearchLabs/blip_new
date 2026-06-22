/**
 * POST /api/wallet/gas — platform-sponsored SOL "gas station".
 *
 * New users have an embedded wallet with 0 SOL, so the first on-chain action
 * (lock escrow, accept, release) would fail with "insufficient SOL". This
 * route tops the caller's wallet up to a small ceiling from the platform
 * BACKEND_SIGNER_KEYPAIR so they never have to think about gas. Most of the
 * SOL it sends is rent that the escrow program RETURNS to the user when a
 * trade settles, so steady-state cost is just the per-tx fee.
 *
 * SAFETY / anti-drain guards (this route SENDS real SOL):
 *   - Auth required (user or merchant token).
 *   - Ceiling top-up only — never funds a wallet ABOVE `CEILING`, so a funded
 *     wallet gets nothing.
 *   - Per-wallet cooldown + per-wallet daily lamport cap.
 *   - Global hourly lamport budget protecting the sponsor.
 *   - Sponsor self-reserve check before every transfer.
 *
 * NOTE: the caps below are in-memory (per server instance). That's fine for
 * the current devnet throwaway sponsor. Before mainnet, move the cooldown /
 * daily / global counters to Redis or a DB table so they're distributed and
 * survive restarts. Tracked in CLAUDE.md.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getBackendKeypair, getBackendConnection } from "@/lib/solana/backendSigner";
import {
  requireAuth,
  successResponse,
  errorResponse,
  validationErrorResponse,
} from "@/lib/middleware/auth";
import { isValidSolanaAddress } from "@/lib/validation/solana";

export const dynamic = "force-dynamic";

// ── Tunables (lamports; 1 SOL = 1_000_000_000) ──────────────────────────
const CEILING = 20_000_000; // 0.02 SOL — covers escrow rent (~0.0065) + fees + buffer
const TRIGGER = 12_000_000; // only top up wallets below 0.012 SOL
const MIN_TOPUP = 2_000_000; // skip dust transfers (< 0.002 SOL)
const COOLDOWN_MS = 20_000; // one top-up per wallet per 20s
const DAILY_CAP = 100_000_000; // 0.1 SOL / wallet / day
const HOURLY_GLOBAL_CAP = 2_000_000_000; // 2 SOL / hour across all wallets
const FEE_BUFFER = 10_000; // leave the sponsor enough for the transfer fee

// ── In-memory rate state (see NOTE above re: mainnet) ───────────────────
const lastTopUp = new Map<string, number>();
const dailyByWallet = new Map<string, { day: number; lamports: number }>();
let globalWindow = { start: 0, lamports: 0 };

function dayIndex(now: number) {
  return Math.floor(now / 86_400_000);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const wallet = String(body?.wallet_address ?? "").trim();
    if (!isValidSolanaAddress(wallet)) {
      return validationErrorResponse(["Invalid wallet_address"]);
    }

    const keypair = getBackendKeypair();
    if (!keypair) {
      // Sponsor not configured — not an error, just nothing to do. Callers
      // treat funded:false as "fall back to the user's own SOL".
      return successResponse({ funded: false, reason: "sponsor_unconfigured" });
    }

    const connection: Connection = getBackendConnection();
    const recipient = new PublicKey(wallet);

    const balance = await connection.getBalance(recipient);
    if (balance >= TRIGGER) {
      return successResponse({ funded: false, reason: "sufficient", balance });
    }

    const now = Date.now();

    // Per-wallet cooldown
    if (now - (lastTopUp.get(wallet) ?? 0) < COOLDOWN_MS) {
      return successResponse({ funded: false, reason: "cooldown", balance });
    }

    let topUp = CEILING - balance;
    if (topUp < MIN_TOPUP) {
      return successResponse({ funded: false, reason: "min_topup", balance });
    }

    // Per-wallet daily cap
    const today = dayIndex(now);
    const rec = dailyByWallet.get(wallet);
    const usedToday = rec && rec.day === today ? rec.lamports : 0;
    if (usedToday >= DAILY_CAP) {
      return successResponse({ funded: false, reason: "daily_cap", balance });
    }
    topUp = Math.min(topUp, DAILY_CAP - usedToday);

    // Global hourly budget
    if (now - globalWindow.start > 3_600_000) globalWindow = { start: now, lamports: 0 };
    if (globalWindow.lamports >= HOURLY_GLOBAL_CAP) {
      return successResponse({ funded: false, reason: "global_cap", balance });
    }
    topUp = Math.min(topUp, HOURLY_GLOBAL_CAP - globalWindow.lamports);

    if (topUp < MIN_TOPUP) {
      return successResponse({ funded: false, reason: "capped", balance });
    }

    // Sponsor self-reserve — never spend below what's needed for the fee.
    const sponsorBal = await connection.getBalance(keypair.publicKey);
    if (sponsorBal < topUp + FEE_BUFFER) {
      return errorResponse("Gas sponsor balance too low");
    }

    // Reserve the cooldown slot BEFORE sending so two racing requests for the
    // same wallet can't both fund it.
    lastTopUp.set(wallet, now);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipient,
        lamports: topUp,
      }),
    );

    let signature: string;
    try {
      signature = await sendAndConfirmTransaction(connection, tx, [keypair], {
        commitment: "confirmed",
      });
    } catch (sendErr) {
      // Roll back the cooldown reservation so a transient failure doesn't
      // lock the user out for the full window.
      lastTopUp.delete(wallet);
      throw sendErr;
    }

    dailyByWallet.set(wallet, { day: today, lamports: usedToday + topUp });
    globalWindow.lamports += topUp;

    return successResponse({
      funded: true,
      lamports: topUp,
      signature,
      balance: balance + topUp,
    });
  } catch {
    return errorResponse("Gas top-up failed");
  }
}
