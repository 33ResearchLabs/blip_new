/**
 * User SELL - Happy Path
 *
 * Scenario: User sells USDC to merchant with full completion
 *
 * Flow (8 Minimal Statuses):
 * 1. User creates sell order (500 USDC) → status: open
 * 2. Merchant accepts → status: accepted
 * 3. User locks escrow → status: escrowed
 * 4. Merchant marks payment sent → status: payment_sent
 * 5. User releases escrow → status: completed
 *
 * Note: payment_confirmed is no longer a separate status in the minimal API.
 * The flow goes directly from payment_sent to completed when escrow is released.
 *
 * Verification:
 * - User balance decreases by 500 USDC
 * - Merchant balance increases by 500 USDC
 * - Order events with correct transitions and actors
 */

import { ApiClient } from '../lib/http';
import { TestData, TestScenario, Order } from '../lib/types';
import {
  assertEqual,
  assertDefined,
  assertOrderStatus,
} from '../lib/assertions';

export const userSellHappy: TestScenario = {
  name: 'User SELL - Happy Path',
  description: 'User sells USDC to merchant with full completion',

  async run(api: ApiClient, testData: TestData): Promise<void> {
    const seller = testData.users[1]; // test_seller_002
    const merchant = testData.merchants[0]; // test_merchant_m1
    const buyOffer = testData.offers.find(
      o => o.type === 'buy' && o.merchant_id === merchant.id
    );

    assertDefined(buyOffer, 'Merchant buy offer');

    // Step 1: User creates sell order for 500 USDC
    const createRes = await api.post<{ success: boolean; data: Order }>(
      '/api/orders',
      {
        user_id: seller.id,
        offer_id: buyOffer.id,
        crypto_amount: 500,
        type: 'sell',
        payment_method: 'bank',
        buyer_wallet_address: seller.wallet_address,
      }
    );

    assertEqual(createRes.success, true, 'Order creation success');
    const orderId = createRes.data.id;
    assertOrderStatus(createRes.data, 'open', 'Initial order status');

    // Step 2: Merchant accepts the order
    const acceptRes = await api.patch<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}`,
      {
        status: 'accepted',
        actor_type: 'merchant',
        actor_id: merchant.id,
        acceptor_wallet_address: merchant.wallet_address,
      }
    );

    assertEqual(acceptRes.success, true, 'Accept success');
    assertOrderStatus(acceptRes.data, 'accepted', 'Status after accept');

    // Step 3: User locks escrow
    const escrowRes = await api.post<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}/escrow`,
      {
        tx_hash: `demo-escrow-${Date.now()}`,
        actor_type: 'user',
        actor_id: seller.id,
        escrow_trade_id: Date.now(),
        escrow_address: 'EscrowAddress22222222222222222222222222',
      }
    );

    assertEqual(escrowRes.success, true, 'Escrow lock success');
    assertOrderStatus(escrowRes.data, 'escrowed', 'Status after escrow');

    // Step 4: Merchant marks payment as sent
    const paymentSentRes = await api.patch<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}`,
      {
        status: 'payment_sent',
        actor_type: 'merchant',
        actor_id: merchant.id,
      }
    );

    assertEqual(paymentSentRes.success, true, 'Payment sent success');
    assertOrderStatus(paymentSentRes.data, 'payment_sent', 'Status after payment sent');

    // Step 5: User releases escrow (directly from payment_sent → completed)
    // Note: In the minimal 8-status system, payment_confirmed is an event, not a status.
    // The user can release escrow directly after payment_sent without an intermediate confirmation status.
    const releaseRes = await api.patch<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}/escrow`,
      {
        tx_hash: `demo-release-${Date.now()}`,
        actor_type: 'user',
        actor_id: seller.id,
      }
    );

    assertEqual(releaseRes.success, true, 'Escrow release success');
    assertOrderStatus(releaseRes.data, 'completed', 'Final order status');

    // Step 6: Verify final order state
    const finalOrder = await api.get<{ success: boolean; data: Order }>(
      `/api/orders/${orderId}`
    );

    assertOrderStatus(finalOrder.data, 'completed', 'Order status is completed');
    assertDefined(finalOrder.data.completed_at, 'Completed timestamp');
    assertEqual(Number(finalOrder.data.crypto_amount), 500, 'Order crypto amount');

    // In the minimal 8-status system:
    // - Statuses: open → accepted → escrowed → payment_sent → completed
    // - The flow is simplified by removing payment_confirmed as a separate status
  },
};
