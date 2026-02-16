/**
 * Core API Conversion Routes
 *
 * POST /v1/convert/usdt-to-sinr - Convert USDT to synthetic INR
 * POST /v1/convert/sinr-to-usdt - Convert synthetic INR to USDT
 *
 * Handles atomic conversion with balance updates, ledger logging, and idempotency.
 */
import type { FastifyPluginAsync } from 'fastify';
import { transaction, logger, MOCK_MODE } from 'settlement-core';

interface ConvertPayload {
  account_type: 'merchant' | 'user';
  account_id: string;
  amount: number; // Amount to convert (in smallest units: micro-USDT or paisa)
  idempotency_key?: string;
}

type PgClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * Calculate conversion output using floor rounding.
 * Floor rounding prevents value creation - there's always a tiny loss.
 */
function calculateConversion(
  direction: 'usdt_to_sinr' | 'sinr_to_usdt',
  amountIn: number,
  rate: number
): number {
  if (direction === 'usdt_to_sinr') {
    // Input: micro-USDT (1,000,000 = 1 USDT)
    // Output: fils (100 fils = 1 AED)
    // Rate: 1 USDT = X AED (e.g., 3.67)
    // Formula: micro-USDT * rate * 100 / 1,000,000 = fils
    // Example: 1,000,000 micro-USDT * 3.67 rate * 100 / 1,000,000 = 367 fils (3.67 AED)
    return Math.floor(amountIn * rate * 100 / 1_000_000);
  } else {
    // Input: fils (100 fils = 1 AED)
    // Output: micro-USDT (1,000,000 = 1 USDT)
    // Formula: fils * 1,000,000 / (rate * 100) = micro-USDT
    // Example: 367 fils * 1,000,000 / (3.67 * 100) = 1,000,000 micro-USDT
    return Math.floor(amountIn * 1_000_000 / (rate * 100));
  }
}

/**
 * Calculate default exposure limit (90% of USDT backing).
 */
function calculateDefaultExposureLimit(usdtBalance: number, rate: number): number {
  return Math.floor(usdtBalance * rate * 100 * 0.9);
}

/**
 * Create ledger entry for conversion.
 */
async function logLedgerEntry(
  client: PgClient,
  accountType: string,
  accountId: string,
  direction: string,
  usdtAmount: number,
  usdtBalanceBefore: number,
  usdtBalanceAfter: number
): Promise<void> {
  const ledgerAmount = direction === 'usdt_to_sinr' ? -usdtAmount : usdtAmount;
  const description = direction === 'usdt_to_sinr'
    ? 'Converted USDT to sINR'
    : 'Converted sINR to USDT';

  await client.query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, description, balance_before, balance_after)
     VALUES ($1, $2, 'SYNTHETIC_CONVERSION', $3, 'USDT', $4, $5, $6)`,
    [accountType, accountId, ledgerAmount, description, usdtBalanceBefore, usdtBalanceAfter]
  );
}

/**
 * Create merchant transaction entry for conversion.
 */
async function logMerchantTransaction(
  client: PgClient,
  accountType: string,
  accountId: string,
  direction: string,
  usdtAmount: number,
  amountIn: number,
  amountOut: number,
  usdtBalanceBefore: number
): Promise<void> {
  const table = accountType === 'merchant' ? 'merchants' : 'users';
  const merchantId = accountType === 'merchant' ? accountId : null;
  const userId = accountType === 'user' ? accountId : null;

  const transactionAmount = direction === 'usdt_to_sinr' ? -usdtAmount : usdtAmount;
  const balanceAfter = usdtBalanceBefore + transactionAmount;

  const description = direction === 'usdt_to_sinr'
    ? `Converted ${(amountIn / 1_000_000).toFixed(6)} USDT to ${(amountOut / 100).toFixed(2)} sINR`
    : `Converted ${(amountIn / 100).toFixed(2)} sINR to ${(amountOut / 1_000_000).toFixed(6)} USDT`;

  await client.query(
    `INSERT INTO merchant_transactions
     (merchant_id, user_id, type, amount, balance_before, balance_after, description)
     VALUES ($1, $2, 'manual_adjustment', $3, $4, $5, $6)`,
    [merchantId, userId, transactionAmount, usdtBalanceBefore, balanceAfter, description]
  );
}

export const conversionRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/convert/usdt-to-sinr
  fastify.post<{
    Body: ConvertPayload;
  }>('/convert/usdt-to-sinr', async (request, reply) => {
    const { account_type, account_id, amount, idempotency_key } = request.body;

    if (!account_type || !account_id || !amount) {
      return reply.status(400).send({
        success: false,
        error: 'account_type, account_id, and amount are required',
      });
    }

    if (amount <= 0) {
      return reply.status(400).send({
        success: false,
        error: 'Amount must be positive',
      });
    }

    try {
      const result = await transaction(async (client) => {
        const table = account_type === 'merchant' ? 'merchants' : 'users';

        // 1. Check idempotency
        if (idempotency_key) {
          const existing = await client.query(
            `SELECT id, amount_in, amount_out, rate, usdt_balance_after, sinr_balance_after
             FROM synthetic_conversions
             WHERE idempotency_key = $1`,
            [idempotency_key]
          );

          if (existing.rows.length > 0) {
            const conv = existing.rows[0];
            return {
              conversion_id: String(conv.id),
              amount_in: Number(conv.amount_in),
              amount_out: Number(conv.amount_out),
              rate: Number(conv.rate),
              usdt_balance_after: Number(conv.usdt_balance_after),
              sinr_balance_after: Number(conv.sinr_balance_after),
            };
          }
        }

        // 2. Lock account and read state
        const lockResult = await client.query(
          `SELECT balance, sinr_balance, synthetic_rate, max_sinr_exposure
           FROM ${table}
           WHERE id = $1
           FOR UPDATE`,
          [account_id]
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

        // 3. Validate
        const usdtAmount = amount / 1_000_000;
        if (usdtAmount > usdtBalance) {
          throw new Error('INSUFFICIENT_BALANCE');
        }

        const amountOut = calculateConversion('usdt_to_sinr', amount, rate);
        const newSinrBalance = sinrBalance + amountOut;
        const effectiveLimit = maxExposure ?? calculateDefaultExposureLimit(usdtBalance, rate);

        if (newSinrBalance > effectiveLimit) {
          throw new Error('EXPOSURE_LIMIT_EXCEEDED');
        }

        // 4. Update balances
        const newUsdtBalance = usdtBalance - usdtAmount;
        await client.query(
          `UPDATE ${table}
           SET balance = $1, sinr_balance = $2
           WHERE id = $3`,
          [newUsdtBalance, newSinrBalance, account_id]
        );

        // 5. Insert conversion record
        const convResult = await client.query(
          `INSERT INTO synthetic_conversions
           (account_type, account_id, direction, amount_in, amount_out, rate,
            usdt_balance_before, usdt_balance_after, sinr_balance_before, sinr_balance_after,
            idempotency_key)
           VALUES ($1, $2, 'usdt_to_sinr', $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [account_type, account_id, amount, amountOut, rate,
           usdtBalance, newUsdtBalance, sinrBalance, newSinrBalance, idempotency_key || null]
        );

        const conversionId = String(convResult.rows[0].id);

        // 6. Log ledger entry
        await logLedgerEntry(client, account_type, account_id, 'usdt_to_sinr',
          usdtAmount, usdtBalance, newUsdtBalance);

        // 7. Log merchant transaction
        await logMerchantTransaction(client, account_type, account_id, 'usdt_to_sinr',
          usdtAmount, amount, amountOut, usdtBalance);

        logger.info('[Conversion] USDT→sINR completed', {
          conversionId,
          accountType: account_type,
          accountId: account_id,
          amountIn: amount,
          amountOut,
          rate,
        });

        return {
          conversion_id: conversionId,
          amount_in: amount,
          amount_out: amountOut,
          rate,
          usdt_balance_after: newUsdtBalance,
          sinr_balance_after: newSinrBalance,
        };
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const errMsg = (error as Error).message;

      if (errMsg === 'INSUFFICIENT_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: 'Insufficient USDT balance',
        });
      }
      if (errMsg === 'EXPOSURE_LIMIT_EXCEEDED') {
        return reply.status(400).send({
          success: false,
          error: 'Conversion would exceed synthetic exposure limit',
        });
      }
      if (errMsg === 'ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: 'Account not found',
        });
      }

      fastify.log.error({ error, accountId: request.body.account_id }, 'Error converting USDT to sINR');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });

  // POST /v1/convert/sinr-to-usdt
  fastify.post<{
    Body: ConvertPayload;
  }>('/convert/sinr-to-usdt', async (request, reply) => {
    const { account_type, account_id, amount, idempotency_key } = request.body;

    if (!account_type || !account_id || !amount) {
      return reply.status(400).send({
        success: false,
        error: 'account_type, account_id, and amount are required',
      });
    }

    if (amount <= 0) {
      return reply.status(400).send({
        success: false,
        error: 'Amount must be positive',
      });
    }

    try {
      const result = await transaction(async (client) => {
        const table = account_type === 'merchant' ? 'merchants' : 'users';

        // 1. Check idempotency
        if (idempotency_key) {
          const existing = await client.query(
            `SELECT id, amount_in, amount_out, rate, usdt_balance_after, sinr_balance_after
             FROM synthetic_conversions
             WHERE idempotency_key = $1`,
            [idempotency_key]
          );

          if (existing.rows.length > 0) {
            const conv = existing.rows[0];
            return {
              conversion_id: String(conv.id),
              amount_in: Number(conv.amount_in),
              amount_out: Number(conv.amount_out),
              rate: Number(conv.rate),
              usdt_balance_after: Number(conv.usdt_balance_after),
              sinr_balance_after: Number(conv.sinr_balance_after),
            };
          }
        }

        // 2. Lock account and read state
        const lockResult = await client.query(
          `SELECT balance, sinr_balance, synthetic_rate
           FROM ${table}
           WHERE id = $1
           FOR UPDATE`,
          [account_id]
        );

        if (lockResult.rows.length === 0) {
          throw new Error('ACCOUNT_NOT_FOUND');
        }

        const account = lockResult.rows[0];
        const usdtBalance = parseFloat(String(account.balance));
        const sinrBalance = Number(account.sinr_balance);
        const rate = parseFloat(String(account.synthetic_rate));

        // 3. Validate
        if (amount > sinrBalance) {
          throw new Error('INSUFFICIENT_SINR_BALANCE');
        }

        const amountOut = calculateConversion('sinr_to_usdt', amount, rate);
        const usdtAmount = amountOut / 1_000_000;

        // 4. Update balances
        const newUsdtBalance = usdtBalance + usdtAmount;
        const newSinrBalance = sinrBalance - amount;

        await client.query(
          `UPDATE ${table}
           SET balance = $1, sinr_balance = $2
           WHERE id = $3`,
          [newUsdtBalance, newSinrBalance, account_id]
        );

        // 5. Insert conversion record
        const convResult = await client.query(
          `INSERT INTO synthetic_conversions
           (account_type, account_id, direction, amount_in, amount_out, rate,
            usdt_balance_before, usdt_balance_after, sinr_balance_before, sinr_balance_after,
            idempotency_key)
           VALUES ($1, $2, 'sinr_to_usdt', $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [account_type, account_id, amount, amountOut, rate,
           usdtBalance, newUsdtBalance, sinrBalance, newSinrBalance, idempotency_key || null]
        );

        const conversionId = String(convResult.rows[0].id);

        // 6. Log ledger entry
        await logLedgerEntry(client, account_type, account_id, 'sinr_to_usdt',
          usdtAmount, usdtBalance, newUsdtBalance);

        // 7. Log merchant transaction
        await logMerchantTransaction(client, account_type, account_id, 'sinr_to_usdt',
          usdtAmount, amount, amountOut, usdtBalance);

        logger.info('[Conversion] sINR→USDT completed', {
          conversionId,
          accountType: account_type,
          accountId: account_id,
          amountIn: amount,
          amountOut,
          rate,
        });

        return {
          conversion_id: conversionId,
          amount_in: amount,
          amount_out: amountOut,
          rate,
          usdt_balance_after: newUsdtBalance,
          sinr_balance_after: newSinrBalance,
        };
      });

      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const errMsg = (error as Error).message;

      if (errMsg === 'INSUFFICIENT_SINR_BALANCE') {
        return reply.status(400).send({
          success: false,
          error: 'Insufficient sINR balance',
        });
      }
      if (errMsg === 'ACCOUNT_NOT_FOUND') {
        return reply.status(404).send({
          success: false,
          error: 'Account not found',
        });
      }

      fastify.log.error({ error, accountId: request.body.account_id }, 'Error converting sINR to USDT');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error',
      });
    }
  });
};
