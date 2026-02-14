/**
 * Test Seed Endpoint
 *
 * Creates deterministic test data for flow tests:
 * - 2 test users (buyer, seller)
 * - 2 test merchants (for user-merchant and M2M trades)
 * - 3 merchant offers (buy/sell for each merchant)
 *
 * Only available in development mode for safety.
 *
 * Usage:
 *   POST /api/test/seed
 *   Body: { "scenario": "full" }
 */

import { NextResponse } from 'next/server';
import { transaction } from '@/lib/db';
import { TEST_USERS, TEST_MERCHANTS, TEST_OFFERS } from '@/lib/test/seedData';
import { PoolClient } from 'pg';

export async function POST(request: Request) {
  // Guard: Only allow in non-production environments (or test harness)
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_ENDPOINTS !== '1') {
    return NextResponse.json(
      {
        success: false,
        error: 'Seed endpoint is disabled in production for safety',
      },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const scenario = body.scenario || 'full';

    if (scenario !== 'full') {
      return NextResponse.json(
        {
          success: false,
          error: 'Only "full" scenario is currently supported',
        },
        { status: 400 }
      );
    }

    // Execute all inserts in a single transaction for atomicity
    const result = await transaction(async (client: PoolClient) => {
      const users = [];
      const merchants = [];
      const offers = [];

      // Insert test users
      for (const user of TEST_USERS) {
        const res = await client.query(
          `INSERT INTO users (username, password_hash, wallet_address, balance, kyc_status, kyc_level)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, username, wallet_address, balance, kyc_status`,
          [
            user.username,
            user.password_hash,
            user.wallet_address,
            user.balance,
            user.kyc_status,
            user.kyc_level,
          ]
        );
        users.push(res.rows[0]);
      }

      // Insert test merchants
      for (const merchant of TEST_MERCHANTS) {
        const res = await client.query(
          `INSERT INTO merchants (
            wallet_address, username, business_name, display_name,
            email, password_hash, balance, status, is_online
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, username, display_name, wallet_address, balance, status`,
          [
            merchant.wallet_address,
            merchant.username,
            merchant.business_name,
            merchant.display_name,
            merchant.email,
            merchant.password_hash,
            merchant.balance,
            merchant.status,
            merchant.is_online,
          ]
        );
        merchants.push(res.rows[0]);
      }

      // Insert merchant offers
      // First 2 offers belong to Merchant1, 3rd offer belongs to Merchant2
      for (let i = 0; i < TEST_OFFERS.length; i++) {
        const offer = TEST_OFFERS[i];
        const merchantId = i < 2 ? merchants[0].id : merchants[1].id;

        const res = await client.query(
          `INSERT INTO merchant_offers (
            merchant_id, type, payment_method, rate,
            min_amount, max_amount, available_amount,
            bank_name, bank_account_name, bank_iban, is_active
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id, merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount`,
          [
            merchantId,
            offer.type,
            offer.payment_method,
            offer.rate,
            offer.min_amount,
            offer.max_amount,
            offer.available_amount,
            offer.bank_name,
            offer.bank_account_name,
            offer.bank_iban,
            offer.is_active,
          ]
        );
        offers.push(res.rows[0]);
      }

      return { users, merchants, offers };
    });

    return NextResponse.json({
      success: true,
      data: result,
      summary: {
        users_created: result.users.length,
        merchants_created: result.merchants.length,
        offers_created: result.offers.length,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Seed failed:', error);

    // Provide helpful error messages for common issues
    let errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage.includes('duplicate key')) {
      errorMessage =
        'Test data already exists. Run POST /api/test/reset first to clear existing data.';
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}

// Only allow POST method
export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: 'Use POST method with { scenario: "full" } to seed test data',
    },
    { status: 405 }
  );
}
