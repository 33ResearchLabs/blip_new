/**
 * Synthetic AED Conversion — Atomic USDT ↔ sAED conversion
 *
 * Atomically converts between USDT and synthetic AED (sAED) using
 * merchant-specific exchange rates. All balance updates, ledger entries,
 * and transaction logs happen in a single DB transaction.
 *
 * Key guarantees:
 * - Atomic: All changes in single transaction
 * - Idempotent: Same idempotency_key returns same result
 * - Deterministic: Floor rounding prevents money creation
 * - Exposure-limited: Caps sAED minting based on USDT backing
 */

import { transaction } from '@/lib/db';
import { createTransactionInTx } from '@/lib/db/repositories/transactions';
import { logger } from '@/lib/logger';

export type ConversionDirection = 'usdt_to_sinr' | 'sinr_to_usdt';
export type AccountType = 'merchant' | 'user';

export interface ConversionInput {
  accountType: AccountType;
  accountId: string;
  direction: ConversionDirection;
  amountIn: number; // In smallest units (micro-USDT or fils)
  idempotencyKey?: string;
}

export interface ConversionResult {
  success: boolean;
  conversion?: {
    id: string;
    amountIn: number;
    amountOut: number;
    rate: number;
    usdtBalanceAfter: number;
    sinrBalanceAfter: number;
  };
  error?: string;
}

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Calculate maximum allowed sAED balance based on USDT backing.
 *
 * Formula: max_sinr = usdt_balance * rate * 100 * 0.9
 *
 * Example: 1000 USDT * 3.67 rate * 100 fils/AED * 0.9 = 330,300 fils (3,303 AED)
 *
 * The 0.9 factor provides a 10% safety buffer to prevent unbacked synthetic currency.
 */
function calculateDefaultExposureLimit(usdtBalance: number, rate: number): number {
  // USDT balance is in USDT units (e.g., 1000.50)
  // rate is AED per USDT (e.g., 3.67)
  // Result in fils (100 fils = 1 AED)
  return Math.floor(usdtBalance * rate * 100 * 0.9);
}

/**
 * Validate conversion request before executing.
 */
function validateConversion(
  direction: ConversionDirection,
  amountIn: number,
  usdtBalance: number,
  sinrBalance: number,
  rate: number,
  maxExposure: number | null
): { valid: boolean; error?: string } {
  if (amountIn <= 0) {
    return { valid: false, error: 'INVALID_AMOUNT' };
  }

  if (direction === 'usdt_to_sinr') {
    // Converting USDT → sAED
    // amountIn is in micro-USDT (6 decimals), convert to USDT units
    const usdtAmount = amountIn / 1_000_000;

    if (usdtAmount > usdtBalance) {
      return { valid: false, error: 'INSUFFICIENT_BALANCE' };
    }

    // Calculate output amount (floor rounding)
    const amountOut = Math.floor(amountIn * rate / 100);
    const newSinrBalance = sinrBalance + amountOut;

    // Check exposure limit
    const effectiveLimit = maxExposure ?? calculateDefaultExposureLimit(usdtBalance, rate);
    if (newSinrBalance > effectiveLimit) {
      return { valid: false, error: 'EXPOSURE_LIMIT_EXCEEDED' };
    }
  } else {
    // Converting sAED → USDT
    // amountIn is in fils
    if (amountIn > sinrBalance) {
      return { valid: false, error: 'INSUFFICIENT_SAED_BALANCE' };
    }
  }

  return { valid: true };
}

/**
 * Calculate conversion output using floor rounding.
 *
 * USDT → sAED: amount_out = floor(amount_in_micro_usdt * rate / 100)
 * sAED → USDT: amount_out = floor(amount_in_fils * 100 / rate)
 *
 * Floor rounding ensures we never create value - there's always a tiny loss
 * on each conversion, preventing arbitrage loops.
 */
function calculateConversion(
  direction: ConversionDirection,
  amountIn: number,
  rate: number
): number {
  if (direction === 'usdt_to_sinr') {
    // Input: micro-USDT (6 decimals)
    // Output: fils (100 fils = 1 AED)
    // Example: 1,000,000 micro-USDT (1 USDT) * 92 rate / 100 = 920,000 fils (9,200 AED)
    return Math.floor(amountIn * rate / 100);
  } else {
    // Input: fils
    // Output: micro-USDT
    // Example: 920,000 fils * 100 / 92 rate = 1,000,000 micro-USDT (1 USDT)
    return Math.floor(amountIn * 100 / rate);
  }
}

/**
 * Atomically convert between USDT and sAED.
 *
 * All operations happen in a single database transaction:
 * 1. Lock account row (FOR UPDATE)
 * 2. Check idempotency (if key exists, return previous result)
 * 3. Read balances and rate
 * 4. Validate conversion (sufficient balance, exposure limits)
 * 5. Calculate output amount (floor rounding)
 * 6. Update both balances atomically
 * 7. Insert synthetic_conversions record
 * 8. Insert ledger_entries record
 * 9. Insert merchant_transactions record
 *
 * @param input - Conversion parameters
 * @returns Conversion result with new balances
 */
export async function atomicConvert(input: ConversionInput): Promise<ConversionResult> {
  const { accountType, accountId, direction, amountIn, idempotencyKey } = input;

  try {
    const result = await transaction(async (client) => {
      const table = accountType === 'merchant' ? 'merchants' : 'users';

      // 1. Check idempotency first (before locking)
      if (idempotencyKey) {
        const existingResult = await client.query(
          `SELECT id, amount_in, amount_out, rate, usdt_balance_after, sinr_balance_after
           FROM synthetic_conversions
           WHERE idempotency_key = $1`,
          [idempotencyKey]
        );

        if (existingResult.rows.length > 0) {
          const existing = existingResult.rows[0];
          logger.info('[SyntheticConversion] Idempotent request - returning existing conversion', {
            conversionId: existing.id,
            idempotencyKey,
          });

          return {
            success: true,
            conversion: {
              id: String(existing.id),
              amountIn: Number(existing.amount_in),
              amountOut: Number(existing.amount_out),
              rate: Number(existing.rate),
              usdtBalanceAfter: Number(existing.usdt_balance_after),
              sinrBalanceAfter: Number(existing.sinr_balance_after),
            },
          };
        }
      }

      // 2. Lock account row and read current state
      const lockResult = await client.query(
        `SELECT balance, sinr_balance, synthetic_rate, max_sinr_exposure
         FROM ${table}
         WHERE id = $1
         FOR UPDATE`,
        [accountId]
      );

      if (lockResult.rows.length === 0) {
        throw new Error('ACCOUNT_NOT_FOUND');
      }

      const account = lockResult.rows[0];
      const usdtBalance = parseFloat(String(account.balance));
      const sinrBalance = Number(account.sinr_balance);
      const rate = parseFloat(String(account.synthetic_rate));
      const maxExposure = account.max_sinr_exposure !== null
        ? Number(account.max_sinr_exposure)
        : null;

      // 3. Validate conversion
      const validation = validateConversion(
        direction,
        amountIn,
        usdtBalance,
        sinrBalance,
        rate,
        maxExposure
      );

      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // 4. Calculate output amount (floor rounding)
      const amountOut = calculateConversion(direction, amountIn, rate);

      // 5. Calculate new balances
      let newUsdtBalance: number;
      let newSinrBalance: number;

      if (direction === 'usdt_to_sinr') {
        const usdtAmount = amountIn / 1_000_000; // Convert micro-USDT to USDT
        newUsdtBalance = usdtBalance - usdtAmount;
        newSinrBalance = sinrBalance + amountOut;
      } else {
        const usdtAmount = amountOut / 1_000_000; // Convert micro-USDT to USDT
        newUsdtBalance = usdtBalance + usdtAmount;
        newSinrBalance = sinrBalance - amountIn;
      }

      // 6. Update balances atomically
      await client.query(
        `UPDATE ${table}
         SET balance = $1, sinr_balance = $2
         WHERE id = $3`,
        [newUsdtBalance, newSinrBalance, accountId]
      );

      // 7. Insert synthetic_conversions record
      const conversionResult = await client.query(
        `INSERT INTO synthetic_conversions
         (account_type, account_id, direction, amount_in, amount_out, rate,
          usdt_balance_before, usdt_balance_after, sinr_balance_before, sinr_balance_after,
          idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          accountType,
          accountId,
          direction,
          amountIn,
          amountOut,
          rate,
          usdtBalance,
          newUsdtBalance,
          sinrBalance,
          newSinrBalance,
          idempotencyKey || null,
        ]
      );

      const conversionId = String(conversionResult.rows[0].id);

      // 8. Insert ledger_entries record
      const ledgerAmount = direction === 'usdt_to_sinr' ? -amountIn / 1_000_000 : amountIn / 1_000_000;
      await client.query(
        `INSERT INTO ledger_entries
         (account_type, account_id, entry_type, amount, asset, description, balance_before, balance_after)
         VALUES ($1, $2, 'SYNTHETIC_CONVERSION', $3, 'USDT', $4, $5, $6)`,
        [
          accountType,
          accountId,
          ledgerAmount,
          `${direction === 'usdt_to_sinr' ? 'Converted USDT to sAED' : 'Converted sAED to USDT'}`,
          usdtBalance,
          newUsdtBalance,
        ]
      );

      // 9. Insert merchant_transactions record
      await createTransactionInTx(client, {
        ...(accountType === 'merchant' ? { merchant_id: accountId } : { user_id: accountId }),
        type: 'synthetic_conversion',
        amount: ledgerAmount,
        description: direction === 'usdt_to_sinr'
          ? `Converted ${(amountIn / 1_000_000).toFixed(6)} USDT to ${(amountOut / 100).toFixed(2)} sAED`
          : `Converted ${(amountIn / 100).toFixed(2)} sAED to ${(amountOut / 1_000_000).toFixed(6)} USDT`,
      });

      logger.info('[SyntheticConversion] Conversion completed', {
        conversionId,
        accountType,
        accountId,
        direction,
        amountIn,
        amountOut,
        rate,
        usdtBalanceBefore: usdtBalance,
        usdtBalanceAfter: newUsdtBalance,
        sinrBalanceBefore: sinrBalance,
        sinrBalanceAfter: newSinrBalance,
      });

      return {
        success: true,
        conversion: {
          id: conversionId,
          amountIn,
          amountOut,
          rate,
          usdtBalanceAfter: newUsdtBalance,
          sinrBalanceAfter: newSinrBalance,
        },
      };
    });

    return result;
  } catch (error) {
    const errMsg = (error as Error).message;

    logger.error('[SyntheticConversion] Conversion failed', {
      accountType,
      accountId,
      direction,
      amountIn,
      error: errMsg,
    });

    return {
      success: false,
      error: errMsg,
    };
  }
}
