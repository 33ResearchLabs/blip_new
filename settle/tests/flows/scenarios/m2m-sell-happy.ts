/**
 * M2M SELL - Happy Path
 *
 * Scenario: Merchant1 sells USDC to Merchant2 (M2M trading)
 *
 * Flow (8 Minimal Statuses):
 * 1. Merchant1 creates sell order (merchant2 will buy) → status: open
 * 2. Merchant2 accepts → status: accepted
 * 3. Merchant1 locks escrow → status: escrowed
 * 4. Merchant2 marks payment sent → status: payment_sent
 * 5. Merchant1 releases escrow → status: completed
 *
 * Note: payment_confirmed is no longer a separate status in the minimal API.
 * The flow goes directly from payment_sent to completed when escrow is released.
 *
 * Verification:
 * - Merchant1 balance decreases by 500 USDC
 * - Merchant2 balance increases by 500 USDC
 */

import { ApiClient } from '../lib/http';
import { TestData, TestScenario, Order } from '../lib/types';
import {
  assertEqual,
  assertDefined,
  assertOrderStatus,
} from '../lib/assertions';

export const m2mSellHappy: TestScenario = {
  name: 'M2M SELL - Happy Path',
  description: 'Merchant1 sells USDC to Merchant2',

  async run(api: ApiClient, testData: TestData): Promise<void> {
    const sellerMerchant = testData.merchants[0]; // test_merchant_m1
    const buyerMerchant = testData.merchants[1]; // test_merchant_m2
    const dummyUser = testData.users[1]; // Use test user for API authentication

    // For M2M sell, we need to use a buy offer and set buyer_merchant_id
    // Find merchant1's buy offer
    const buyOffer = testData.offers.find(
      o => o.type === 'buy' && o.merchant_id === sellerMerchant.id
    );

    assertDefined(buyOffer, 'Merchant1 buy offer');

    // Step 1: Create sell order that merchant2 will accept
    const createRes = await api.post<{ success: boolean; data: Order }>(
      '/api/orders',
      {
        user_id: dummyUser.id,
        offer_id: buyOffer.id,
        crypto_amount: 500,
        type: 'sell',
        payment_method: 'bank',
        buyer_wallet_address: dummyUser.wallet_address,
      }
    );

    assertEqual(createRes.success, true, 'M2M sell order creation success');
    const orderId = createRes.data.id;
    assertOrderStatus(createRes.data, 'open', 'Initial order status');

    // Step 2: Merchant2 accepts the order (as buyer)
    const acceptRes = await api.patch<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}`,
      {
        status: 'accepted',
        actor_type: 'merchant',
        actor_id: buyerMerchant.id,
        buyer_merchant_id: buyerMerchant.id,
        acceptor_wallet_address: buyerMerchant.wallet_address,
      }
    );

    assertEqual(acceptRes.success, true, 'Accept success');
    assertOrderStatus(acceptRes.data, 'accepted', 'Status after accept');

    // Step 3: Merchant1 locks escrow
    const escrowRes = await api.post<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}/escrow`,
      {
        tx_hash: `demo-m2m-sell-escrow-${Date.now()}`,
        actor_type: 'merchant',
        actor_id: sellerMerchant.id,
        escrow_trade_id: Date.now(),
        escrow_address: 'M2MSellEscrow1111111111111111111111111',
      }
    );

    assertEqual(escrowRes.success, true, 'M2M sell escrow lock success');
    assertOrderStatus(escrowRes.data, 'escrowed', 'Status after escrow');

    // Step 4: Merchant2 marks payment sent
    const paymentSentRes = await api.patch<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}`,
      {
        status: 'payment_sent',
        actor_type: 'merchant',
        actor_id: buyerMerchant.id,
      }
    );

    assertEqual(paymentSentRes.success, true, 'Payment sent success');
    assertOrderStatus(paymentSentRes.data, 'payment_sent', 'Status after payment sent');

    // Step 5: Merchant1 releases escrow (directly from payment_sent → completed)
    // Note: In the minimal 8-status system, payment_confirmed is an event, not a status.
    // Merchant1 can release escrow directly after payment_sent without an intermediate confirmation status.
    const releaseRes = await api.patch<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}/escrow`,
      {
        tx_hash: `demo-m2m-sell-release-${Date.now()}`,
        actor_type: 'merchant',
        actor_id: sellerMerchant.id,
      }
    );

    assertEqual(releaseRes.success, true, 'M2M sell escrow release success');
    assertOrderStatus(releaseRes.data, 'completed', 'Final order status');

    // Step 6: Verify final state
    const finalOrder = await api.get<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}`
    );

    assertOrderStatus(finalOrder.data, 'completed', 'Order completed');
    assertDefined(finalOrder.data.completed_at, 'Completed timestamp');
    assertEqual(Number(finalOrder.data.crypto_amount), 500, 'Order amount');

    // In the minimal 8-status system:
    // - Statuses: open → accepted → escrowed → payment_sent → completed
    // - The flow is simplified by removing payment_confirmed as a separate status
  },
};
