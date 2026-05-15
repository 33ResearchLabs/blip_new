import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { query, queryOne } from '@/lib/db';
import {
  requireAuth,
  successResponse,
  errorResponse,
  forbiddenResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';
import { getBackendConnection } from '@/lib/solana/backendSigner';
import { getUsdtMint } from '@/lib/solana/v2/config';
import { logger } from '@/lib/logger';

/**
 * POST /api/merchant/sync-balance
 *
 * Reconciles the merchant's DB `balance` column from the AUTHORITATIVE
 * source — the on-chain USDT ATA. The frontend can no longer hand us a
 * number to write; the previous design blindly trusted whatever the
 * client posted, which let DB balance drift arbitrarily from chain.
 *
 * Under the current architecture:
 *   - on-chain ATA = source of truth for funds
 *   - merchants.balance = cached snapshot of the ATA, written here
 *
 * Body: { merchant_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const { merchant_id } = body as { merchant_id?: string };

    if (!merchant_id || typeof merchant_id !== 'string') {
      return validationErrorResponse(['merchant_id is required']);
    }

    // Only the merchant themselves (or a system actor) can trigger a sync.
    const isOwner = auth.actorType === 'merchant' && auth.actorId === merchant_id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only sync your own balance');
    }

    const merchant = await queryOne<{ wallet_address: string | null; balance: string | number | null }>(
      'SELECT wallet_address, balance FROM merchants WHERE id = $1',
      [merchant_id]
    );

    if (!merchant) {
      return validationErrorResponse(['Merchant not found']);
    }

    if (!merchant.wallet_address) {
      // No wallet → nothing to reconcile. Leave DB balance as-is (likely 0).
      return successResponse({ synced: false, reason: 'no_wallet', balance: Number(merchant.balance ?? 0) });
    }

    const connection = getBackendConnection();
    const usdtMint = getUsdtMint();
    let onChainBalance = 0;
    try {
      const owner = new PublicKey(merchant.wallet_address);
      const ata = await getAssociatedTokenAddress(usdtMint, owner);
      const account = await getAccount(connection, ata);
      onChainBalance = Number(account.amount) / 1_000_000;
    } catch (rpcErr) {
      // ATA not yet initialized = 0 USDT on-chain. That's a valid result,
      // not an error — let the DB reflect it.
      const msg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      if (!/could not find account/i.test(msg) && !/account does not exist/i.test(msg)) {
        logger.warn('[sync-balance] RPC error reading ATA', {
          merchant_id,
          wallet: merchant.wallet_address,
          error: msg,
        });
        return errorResponse('Unable to read on-chain balance');
      }
      onChainBalance = 0;
    }

    const prev = Number(merchant.balance ?? 0);
    if (Math.abs(prev - onChainBalance) > 0.000001) {
      await query('UPDATE merchants SET balance = $1 WHERE id = $2', [onChainBalance, merchant_id]);
      logger.info('[sync-balance] Reconciled', {
        merchant_id,
        prev,
        onChain: onChainBalance,
        delta: onChainBalance - prev,
      });
    }

    return successResponse({ synced: true, balance: onChainBalance, previous: prev });
  } catch (error) {
    console.error('Error syncing balance:', error);
    return errorResponse('Internal server error');
  }
}
