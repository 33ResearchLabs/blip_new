/**
 * Script to complete a stuck order and test Telegram notifications
 * Usage: node complete_order.js <order_id> <merchant_id>
 */

const { Client } = require('pg');

const ORDER_ID = process.argv[2] || '4ec75da7-6186-4e64-8b1e-b1290911b24f';
const MERCHANT_ID = process.argv[3] || 'c7d75151-6c40-4d5a-830f-11b3087f8808';

async function completeOrder() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost/settle'
  });

  await client.connect();

  try {
    console.log('\n🔄 Starting order completion process...\n');

    // 1. Get current order status
    const orderResult = await client.query(
      'SELECT id, order_number, status, type, merchant_id, user_id, crypto_amount FROM orders WHERE id = $1',
      [ORDER_ID]
    );

    if (orderResult.rows.length === 0) {
      console.log('❌ Order not found');
      return;
    }

    const order = orderResult.rows[0];
    console.log('📦 Order Details:');
    console.log(`   ID: ${order.id}`);
    console.log(`   Number: ${order.order_number}`);
    console.log(`   Status: ${order.status}`);
    console.log(`   Type: ${order.type}`);
    console.log(`   Amount: ${order.crypto_amount} USDT\n`);

    // 2. Update to payment_sent
    if (order.status === 'escrowed' || order.status === 'accepted') {
      console.log('💸 Marking payment as sent...');
      await client.query(
        `UPDATE orders
         SET status = 'payment_sent',
             payment_sent_at = NOW(),
             order_version = order_version + 1
         WHERE id = $1`,
        [ORDER_ID]
      );

      // Insert notification
      await client.query(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status)
         VALUES ($1, 'ORDER_PAYMENT_SENT', $2, 'pending')`,
        [ORDER_ID, JSON.stringify({
          orderId: ORDER_ID,
          userId: order.user_id,
          merchantId: order.merchant_id,
          status: 'payment_sent',
          minimal_status: 'payment_sent',
          previousStatus: order.status,
          updatedAt: new Date().toISOString(),
        })]
      );

      console.log('✅ Payment sent\n');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. Update to payment_confirmed
    console.log('✅ Confirming payment receipt...');
    await client.query(
      `UPDATE orders
       SET status = 'payment_confirmed',
           payment_confirmed_at = NOW(),
           order_version = order_version + 1
       WHERE id = $1`,
      [ORDER_ID]
    );

    // Insert notification
    await client.query(
      `INSERT INTO notification_outbox (order_id, event_type, payload, status)
       VALUES ($1, 'ORDER_PAYMENT_CONFIRMED', $2, 'pending')`,
      [ORDER_ID, JSON.stringify({
        orderId: ORDER_ID,
        userId: order.user_id,
        merchantId: order.merchant_id,
        status: 'payment_confirmed',
        minimal_status: 'payment_confirmed',
        previousStatus: 'payment_sent',
        updatedAt: new Date().toISOString(),
      })]
    );

    console.log('✅ Payment confirmed\n');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Complete the order
    console.log('🎉 Completing order...');
    await client.query(
      `UPDATE orders
       SET status = 'completed',
           completed_at = NOW(),
           order_version = order_version + 1
       WHERE id = $1`,
      [ORDER_ID]
    );

    // Add balance to recipient (for mock mode)
    const amount = parseFloat(order.crypto_amount);
    const isBuyOrder = order.type === 'buy';

    // For buy orders in mock mode, credit the user/buyer_merchant
    if (isBuyOrder) {
      const recipientResult = await client.query(
        'SELECT buyer_merchant_id FROM orders WHERE id = $1',
        [ORDER_ID]
      );

      const buyerMerchantId = recipientResult.rows[0]?.buyer_merchant_id;

      if (buyerMerchantId) {
        // Credit buyer merchant
        await client.query(
          'UPDATE merchants SET balance = balance + $1 WHERE id = $2',
          [amount, buyerMerchantId]
        );
        console.log(`💰 Credited ${amount} USDT to buyer merchant ${buyerMerchantId}`);
      } else {
        // Credit user
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2',
          [amount, order.user_id]
        );
        console.log(`💰 Credited ${amount} USDT to user ${order.user_id}`);
      }
    }

    // Insert completion notification
    await client.query(
      `INSERT INTO notification_outbox (order_id, event_type, payload, status)
       VALUES ($1, 'ORDER_COMPLETED', $2, 'pending')`,
      [ORDER_ID, JSON.stringify({
        orderId: ORDER_ID,
        userId: order.user_id,
        merchantId: order.merchant_id,
        status: 'completed',
        minimal_status: 'completed',
        previousStatus: 'payment_confirmed',
        updatedAt: new Date().toISOString(),
      })]
    );

    // Update stats
    await client.query(
      `UPDATE users SET total_trades = total_trades + 1 WHERE id = $1`,
      [order.user_id]
    );
    await client.query(
      `UPDATE merchants SET total_trades = total_trades + 1 WHERE id = $1`,
      [order.merchant_id]
    );

    console.log('✅ Order completed!\n');

    // 5. Check notifications
    const notifications = await client.query(
      `SELECT id, event_type, status, created_at
       FROM notification_outbox
       WHERE order_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [ORDER_ID]
    );

    console.log('📬 Notifications created:');
    notifications.rows.forEach((n, i) => {
      console.log(`   ${i + 1}. ${n.event_type} - ${n.status} (${n.created_at})`);
    });

    console.log('\n✨ Done! The notification worker will send Telegram messages.');
    console.log('   Make sure the worker is running: cd apps/core-api && npm run worker:outbox\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

completeOrder().catch(console.error);
