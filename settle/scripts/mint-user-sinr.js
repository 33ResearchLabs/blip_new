#!/usr/bin/env node

/**
 * Mint sINR for a User
 *
 * Usage: node mint-user-sinr.js <user-id> <usdt-amount>
 * Example: node mint-user-sinr.js "abc-123-def" 10.5
 */

const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4010';
const CORE_API_SECRET = process.env.CORE_API_SECRET;

if (!CORE_API_SECRET) {
  console.error('❌ Error: CORE_API_SECRET environment variable not set');
  console.error('   Run: export CORE_API_SECRET="your-secret"');
  process.exit(1);
}

const userId = process.argv[2];
const usdtAmount = parseFloat(process.argv[3]);

if (!userId || !usdtAmount || isNaN(usdtAmount)) {
  console.error('Usage: node mint-user-sinr.js <user-id> <usdt-amount>');
  console.error('Example: node mint-user-sinr.js "abc-123-def" 10.5');
  process.exit(1);
}

async function mintSINRForUser(userId, usdtAmount) {
  const amountMicroUSDT = Math.floor(usdtAmount * 1_000_000);

  console.log(`🔄 Minting ${usdtAmount} USDT → sINR for user ${userId}...`);
  console.log(`   Amount in micro-USDT: ${amountMicroUSDT}`);

  try {
    const response = await fetch(`${CORE_API_URL}/v1/convert/usdt-to-sinr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-core-api-secret': CORE_API_SECRET,
      },
      body: JSON.stringify({
        account_type: 'user', // User, not merchant
        account_id: userId,
        amount: amountMicroUSDT,
        idempotency_key: `user-mint-${userId}-${Date.now()}`,
      }),
    });

    const data = await response.json();

    if (data.success) {
      const result = data.data;
      const sinrAmount = result.amount_out / 100; // Convert paisa to INR

      console.log('\n✅ SUCCESS! Minted sINR for user');
      console.log('━'.repeat(50));
      console.log(`   Conversion ID: ${result.conversion_id}`);
      console.log(`   Amount In:     ${(result.amount_in / 1_000_000).toFixed(6)} USDT`);
      console.log(`   Amount Out:    ₹${sinrAmount.toFixed(2)} (${result.amount_out.toLocaleString()} paisa)`);
      console.log(`   Rate:          1 USDT = ₹${result.rate}`);
      console.log(`   USDT Balance:  ${result.usdt_balance_after.toFixed(6)}`);
      console.log(`   sINR Balance:  ₹${(result.sinr_balance_after / 100).toFixed(2)}`);
      console.log('━'.repeat(50));
    } else {
      console.error('\n❌ FAILED to mint sINR');
      console.error(`   Error: ${data.error}`);

      if (data.error.includes('INSUFFICIENT_BALANCE')) {
        console.error('   → User does not have enough USDT balance');
      } else if (data.error.includes('EXPOSURE_LIMIT')) {
        console.error('   → Conversion would exceed exposure limit');
      } else if (data.error.includes('NOT_FOUND')) {
        console.error('   → User account not found');
      }
    }
  } catch (error) {
    console.error('\n❌ Network Error');
    console.error(`   ${error.message}`);
    console.error('\n   Make sure:');
    console.error('   1. Core-API is running (port 4010)');
    console.error('   2. CORE_API_SECRET is correct');
  }
}

mintSINRForUser(userId, usdtAmount);
