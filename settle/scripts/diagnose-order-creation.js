/**
 * Diagnostic script to check why order creation might be failing
 * Usage: node scripts/diagnose-order-creation.js <merchant_id> <type> <payment_method>
 * Example: node scripts/diagnose-order-creation.js 123e4567-e89b-12d3-a456-426614174000 buy bank
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function diagnose() {
  const [merchantId, type, paymentMethod] = process.argv.slice(2);

  if (!merchantId || !type || !paymentMethod) {
    console.error('Usage: node scripts/diagnose-order-creation.js <merchant_id> <type> <payment_method>');
    console.error('Example: node scripts/diagnose-order-creation.js 123e4567-e89b-12d3-a456-426614174000 buy bank');
    process.exit(1);
  }

  console.log('\n🔍 Diagnosing Order Creation Issue\n');
  console.log('Parameters:');
  console.log(`  Merchant ID: ${merchantId}`);
  console.log(`  Type: ${type}`);
  console.log(`  Payment Method: ${paymentMethod}\n`);

  try {
    // Check if merchant exists
    console.log('1️⃣ Checking if merchant exists...');
    const merchantResult = await pool.query(
      'SELECT id, name, wallet_address, is_active FROM merchants WHERE id = $1',
      [merchantId]
    );

    if (merchantResult.rows.length === 0) {
      console.error('❌ Merchant not found!');
      process.exit(1);
    }

    const merchant = merchantResult.rows[0];
    console.log(`✅ Merchant found: ${merchant.name}`);
    console.log(`   Active: ${merchant.is_active}`);

    if (!merchant.is_active) {
      console.error('❌ Merchant is not active!');
      process.exit(1);
    }

    // Check for matching offers (corridors)
    console.log('\n2️⃣ Checking for matching offers/corridors...');
    const offersResult = await pool.query(
      `SELECT id, type, payment_method, is_active, min_amount, max_amount, available_amount, rate
       FROM merchant_offers
       WHERE merchant_id = $1`,
      [merchantId]
    );

    if (offersResult.rows.length === 0) {
      console.error('❌ No offers/corridors found for this merchant!');
      console.log('\n💡 Solution: The merchant needs to create a corridor first.');
      console.log('   Go to the merchant dashboard → Corridors → Create a new corridor');
      process.exit(1);
    }

    console.log(`✅ Found ${offersResult.rows.length} offer(s):`);
    offersResult.rows.forEach((offer, i) => {
      console.log(`\n   Offer ${i + 1}:`);
      console.log(`     ID: ${offer.id}`);
      console.log(`     Type: ${offer.type}`);
      console.log(`     Payment Method: ${offer.payment_method}`);
      console.log(`     Active: ${offer.is_active}`);
      console.log(`     Min Amount: ${offer.min_amount} USDC`);
      console.log(`     Max Amount: ${offer.max_amount} USDC`);
      console.log(`     Available: ${offer.available_amount} USDC`);
      console.log(`     Rate: ${offer.rate} AED/USDC`);
    });

    // Check for exact match
    console.log('\n3️⃣ Checking for exact match...');
    const matchingOffer = offersResult.rows.find(
      o => o.type === type && o.payment_method === paymentMethod && o.is_active
    );

    if (!matchingOffer) {
      console.error(`❌ No active ${type} offer with ${paymentMethod} payment method found!`);
      console.log('\n💡 Solution: Create a corridor with:');
      console.log(`   - Type: ${type.toUpperCase()}`);
      console.log(`   - Payment Method: ${paymentMethod.toUpperCase()}`);
      console.log('   - Make sure it\'s marked as active');

      const similarOffers = offersResult.rows.filter(o => o.type === type || o.payment_method === paymentMethod);
      if (similarOffers.length > 0) {
        console.log('\n📝 You have similar offers that might need adjustment:');
        similarOffers.forEach(offer => {
          console.log(`   - ${offer.type}/${offer.payment_method} (${offer.is_active ? 'active' : 'inactive'})`);
        });
      }

      process.exit(1);
    }

    console.log(`✅ Found matching offer: ${matchingOffer.id}`);
    console.log(`   Type: ${matchingOffer.type}`);
    console.log(`   Payment Method: ${matchingOffer.payment_method}`);
    console.log(`   Available: ${matchingOffer.available_amount} USDC`);
    console.log(`   Range: ${matchingOffer.min_amount} - ${matchingOffer.max_amount} USDC`);

    if (matchingOffer.available_amount === 0) {
      console.error('\n⚠️ WARNING: Available amount is 0! No liquidity available.');
      console.log('💡 Solution: Add liquidity to this corridor or increase the available amount.');
    }

    console.log('\n✅ All checks passed! Order creation should work.');
    console.log(`\n💡 Valid order amount range: ${matchingOffer.min_amount} - ${matchingOffer.max_amount} USDC`);
    console.log(`   Must be ≤ ${matchingOffer.available_amount} USDC (available liquidity)`);

  } catch (error) {
    console.error('\n❌ Error during diagnosis:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

diagnose();
