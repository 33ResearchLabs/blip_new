/**
 * Setup Two Test Merchants for Testing BUY Order Flow
 *
 * Creates Merchant A and Merchant B, then creates BUY corridors for both
 */

async function createMerchant(email, password, businessName) {
  const apiUrl = 'http://localhost:3000/api/auth/merchant';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'register',
      email,
      password,
      business_name: businessName,
    }),
  });

  const data = await response.json();

  if (data.success) {
    return {
      id: data.data.merchant.id,
      email,
      password,
      username: data.data.merchant.username || businessName,
    };
  } else if (response.status === 409) {
    // Merchant already exists, try to get ID by logging in
    console.log(`   ⚠️  ${businessName} already exists, attempting login...`);

    const loginRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'login',
        email,
        password,
      }),
    });

    const loginData = await loginRes.json();
    if (loginData.success) {
      return {
        id: loginData.data.merchant.id,
        email,
        password,
        username: loginData.data.merchant.username || businessName,
      };
    }
  }

  throw new Error(`Failed to create ${businessName}: ${data.error}`);
}

async function createCorridor(merchantId, type, paymentMethod) {
  const apiUrl = 'http://localhost:3000/api/merchant/offers';

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      type,
      payment_method: paymentMethod,
      rate: 3.67,
      min_amount: 10,
      max_amount: 1000,
      available_amount: 5000,
      is_active: true,
      // Bank details for bank payment method
      bank_name: type === 'buy' ? 'Emirates NBD' : 'ADCB',
      bank_account_name: type === 'buy' ? 'Test Merchant Account' : 'Test Seller Account',
      bank_iban: type === 'buy' ? 'AE123456789012345678901' : 'AE987654321098765432109',
    }),
  });

  const data = await response.json();

  if (data.success) {
    return data.data;
  } else {
    throw new Error(`Failed to create ${type} corridor: ${data.error}`);
  }
}

async function setup() {
  console.log('\n🚀 Setting up Two Test Merchants for BUY Order Flow\n');
  console.log('=' .repeat(60));

  try {
    // Create Merchant A (will create BUY orders)
    console.log('\n1️⃣  Creating Merchant A (Buyer)...');
    const merchantA = await createMerchant(
      'merchant-a@test.com',
      'test123',
      'Merchant A - Buyer'
    );
    console.log('   ✅ Created:', merchantA.username);
    console.log('   📧 Email:', merchantA.email);
    console.log('   🔑 Password:', merchantA.password);
    console.log('   🆔 ID:', merchantA.id);

    // Create Merchant B (will accept and sell USDC)
    console.log('\n2️⃣  Creating Merchant B (Seller)...');
    const merchantB = await createMerchant(
      'merchant-b@test.com',
      'test123',
      'Merchant B - Seller'
    );
    console.log('   ✅ Created:', merchantB.username);
    console.log('   📧 Email:', merchantB.email);
    console.log('   🔑 Password:', merchantB.password);
    console.log('   🆔 ID:', merchantB.id);

    // Create corridors for Merchant A
    console.log('\n3️⃣  Creating BUY corridor for Merchant A...');
    const corridorA = await createCorridor(merchantA.id, 'buy', 'bank');
    console.log('   ✅ Corridor created:', corridorA.id);
    console.log('   📊 Type: BUY');
    console.log('   💳 Payment: Bank Transfer');
    console.log('   💰 Rate: 3.67 AED/USDC');

    // Create corridors for Merchant B
    console.log('\n4️⃣  Creating SELL corridor for Merchant B...');
    const corridorB = await createCorridor(merchantB.id, 'sell', 'bank');
    console.log('   ✅ Corridor created:', corridorB.id);
    console.log('   📊 Type: SELL');
    console.log('   💳 Payment: Bank Transfer');
    console.log('   💰 Rate: 3.67 AED/USDC');

    console.log('\n' + '='.repeat(60));
    console.log('\n✅ Setup Complete! Ready to test BUY order flow\n');

    console.log('📋 Testing Instructions:');
    console.log('─'.repeat(60));
    console.log('\nStep 1: Login as Merchant A');
    console.log('   🌐 URL: http://localhost:3000/merchant');
    console.log('   📧 Email: merchant-a@test.com');
    console.log('   🔑 Password: test123');
    console.log('   💼 Action: Create a BUY order (Click "Open Trade" → BUY → 100 USDC)');

    console.log('\nStep 2: Login as Merchant B (in incognito/different browser)');
    console.log('   🌐 URL: http://localhost:3000/merchant');
    console.log('   📧 Email: merchant-b@test.com');
    console.log('   🔑 Password: test123');
    console.log('   👀 Action: Look for Merchant A\'s order in "New Orders"');
    console.log('   ✅ Action: Accept the order and lock escrow');

    console.log('\nStep 3: Complete the Flow');
    console.log('   💸 Merchant A marks payment as sent');
    console.log('   ✓  Merchant B confirms payment received');
    console.log('   🔓 Escrow released to Merchant A');
    console.log('   🎉 Order completed!\n');

    console.log('📚 Full documentation: settle/scripts/test-buy-order-flow.md\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.log('\n💡 Make sure:');
    console.log('   1. Dev server is running (npm run dev in settle/)');
    console.log('   2. Database is running and migrated');
    console.log('   3. API endpoints are accessible\n');
  }
}

// Run the script
setup();
