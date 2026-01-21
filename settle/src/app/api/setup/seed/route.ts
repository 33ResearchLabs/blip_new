import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Seed test accounts for development
export async function GET() {
  const results: string[] = [];

  try {
    // 1. Create test users with balances
    const users = [
      { wallet: '0xAlice1234567890abcdef1234567890abcdef1234', name: 'Alice', email: 'alice@test.com', balance: 100000 },
      { wallet: '0xBob1234567890abcdef1234567890abcdef12345', name: 'Bob', email: 'bob@test.com', balance: 100000 },
      { wallet: '0xCharlie1234567890abcdef1234567890abcdef', name: 'Charlie', email: 'charlie@test.com', balance: 100000 },
    ];

    for (const user of users) {
      try {
        await query(`
          INSERT INTO users (wallet_address, name, email, kyc_status, kyc_level, total_trades, rating)
          VALUES ($1, $2, $3, 'verified', 1, 0, 5.0)
          ON CONFLICT (wallet_address) DO UPDATE SET name = $2, email = $3
          RETURNING id
        `, [user.wallet, user.name, user.email]);
        results.push(`✓ User ${user.name} created/updated`);
      } catch (e) {
        results.push(`Note: User ${user.name} - ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Add balance column to users if not exists and set balances
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS balance DECIMAL(20, 6) DEFAULT 0`);
      results.push('✓ Added balance column to users');
    } catch (e) {
      results.push(`Note: balance column - ${e instanceof Error ? e.message : String(e)}`);
    }

    // Update balances
    for (const user of users) {
      await query(`UPDATE users SET balance = $1 WHERE email = $2`, [user.balance, user.email]);
    }
    results.push('✓ Set user balances to 100,000 USDC each');

    // 3. Fix merchant email conflicts
    // The problem: schema.sql creates merchants with emails like merchant1@blip.money
    // But we want to login with quickswap@merchant.com
    // Old seeds may have created duplicate merchants with the test emails
    try {
      // First, clear the test emails from any duplicate merchants (old seeds)
      // This avoids unique constraint violations
      await query(`UPDATE merchants SET email = CONCAT('old_', wallet_address, '@deleted.com') WHERE wallet_address IN ('0xQuickSwap1234567890abcdef1234567890abcd', '0xDesertGold1234567890abcdef1234567890abc')`);
      results.push('✓ Cleared emails from duplicate merchants');

      // Update legacy merchants (old Ethereum-style addresses) to use test emails
      await query(`UPDATE merchants SET email = 'quickswap@merchant.com', is_online = true WHERE wallet_address = '0xMerchant1Address123456789'`);
      await query(`UPDATE merchants SET email = 'desertgold@merchant.com', is_online = true WHERE wallet_address = '0xMerchant2Address987654321'`);

      // Also update merchants with new Solana addresses
      await query(`UPDATE merchants SET email = 'quickswap@merchant.com', is_online = true WHERE wallet_address = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'`);
      await query(`UPDATE merchants SET email = 'desertgold@merchant.com', is_online = true WHERE wallet_address = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK'`);
      results.push('✓ Updated merchant emails');
    } catch (e) {
      results.push(`Note: Email update - ${e instanceof Error ? e.message : String(e)}`);
    }

    // 4. Ensure merchants exist (upsert based on wallet address)
    // Using valid Solana devnet addresses for merchants (base58 format)
    const merchants = [
      {
        wallet: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',  // Valid Solana address
        business: 'Quick Exchange LLC',
        display: 'QuickSwap',
        email: 'quickswap@merchant.com',
        balance: 500000
      },
      {
        wallet: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',  // Valid Solana address
        business: 'Desert Gold Trading',
        display: 'DesertGold',
        email: 'desertgold@merchant.com',
        balance: 500000
      },
    ];

    // Add balance column to merchants
    try {
      await query(`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS balance DECIMAL(20, 6) DEFAULT 0`);
      await query(`ALTER TABLE merchants ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)`);
      results.push('✓ Added balance and password columns to merchants');
    } catch (e) {
      results.push(`Note: merchant columns - ${e instanceof Error ? e.message : String(e)}`);
    }

    for (const merchant of merchants) {
      try {
        await query(`
          INSERT INTO merchants (wallet_address, business_name, display_name, email, status, is_online, rating, total_trades, balance)
          VALUES ($1, $2, $3, $4, 'active', true, 4.9, 0, $5)
          ON CONFLICT (wallet_address) DO UPDATE SET
            business_name = $2, display_name = $3, email = $4, balance = $5, status = 'active', is_online = true
          RETURNING id
        `, [merchant.wallet, merchant.business, merchant.display, merchant.email, merchant.balance]);
        results.push(`✓ Merchant ${merchant.display} created/updated with 500,000 USDC`);
      } catch (e) {
        results.push(`Note: Merchant ${merchant.display} - ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 4. Create merchant offers
    for (const merchant of merchants) {
      try {
        const merchantResult = await query(`SELECT id FROM merchants WHERE email = $1`, [merchant.email]);
        if (merchantResult.length > 0) {
          const merchantId = (merchantResult[0] as { id: string }).id;

          // Create sell offer (bank)
          await query(`
            INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban, is_active)
            VALUES ($1, 'sell', 'bank', 3.67, 100, 50000, 50000, 'Emirates NBD', $2, 'AE070331234567890123456', true)
            ON CONFLICT DO NOTHING
          `, [merchantId, merchant.business]);

          results.push(`✓ Created offer for ${merchant.display}`);
        }
      } catch (e) {
        results.push(`Note: Offer - ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 5. Update compliance team
    try {
      await query(`
        INSERT INTO compliance_team (email, name, role, is_active)
        VALUES
          ('support@settle.com', 'Support Agent', 'support', true),
          ('compliance@settle.com', 'Compliance Officer', 'compliance', true)
        ON CONFLICT (email) DO UPDATE SET is_active = true
      `);
      results.push('✓ Compliance team updated');
    } catch (e) {
      results.push(`Note: Compliance - ${e instanceof Error ? e.message : String(e)}`);
    }

    // 6. Get summary of accounts
    const userCount = await query(`SELECT COUNT(*) as count FROM users WHERE email LIKE '%@test.com'`);
    const merchantCount = await query(`SELECT COUNT(*) as count FROM merchants WHERE email LIKE '%@merchant.com'`);
    const complianceCount = await query(`SELECT COUNT(*) as count FROM compliance_team WHERE is_active = true`);

    results.push('');
    results.push('=== ACCOUNT SUMMARY ===');
    results.push(`Users: ${(userCount[0] as { count: string }).count}`);
    results.push(`Merchants: ${(merchantCount[0] as { count: string }).count}`);
    results.push(`Compliance: ${(complianceCount[0] as { count: string }).count}`);

    return NextResponse.json({
      success: true,
      message: 'Seed data created',
      results,
      accounts: {
        users: [
          { email: 'alice@test.com', password: 'user123', name: 'Alice', balance: '100,000 USDC' },
          { email: 'bob@test.com', password: 'user123', name: 'Bob', balance: '100,000 USDC' },
          { email: 'charlie@test.com', password: 'user123', name: 'Charlie', balance: '100,000 USDC' },
        ],
        merchants: [
          { email: 'quickswap@merchant.com', password: 'merchant123', name: 'QuickSwap', balance: '500,000 USDC' },
          { email: 'desertgold@merchant.com', password: 'merchant123', name: 'DesertGold', balance: '500,000 USDC' },
        ],
        compliance: [
          { email: 'support@settle.com', password: 'compliance123', name: 'Support Agent', role: 'support' },
          { email: 'compliance@settle.com', password: 'compliance123', name: 'Compliance Officer', role: 'compliance' },
        ],
      },
    });
  } catch (error) {
    console.error('Seed failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Seed failed',
      details: error instanceof Error ? error.message : String(error),
      results,
    }, { status: 500 });
  }
}
