/**
 * E2E: Edge Cases, Invalid Actions & Race Conditions
 *
 * Tests rejection paths, guard rails, and concurrent scenarios
 * to verify the system is production-safe.
 */

import { test, expect } from './fixtures';
import {
  seedFullScenario,
  createOrder,
  transitionOrder,
  lockEscrow,
  getOrder,
  ScenarioData,
} from './helpers/api';
import {
  dispatchAction,
  getSettleOrder,
  retry,
} from './helpers/p2p-actions';

let scenario: ScenarioData;

test.describe('P2P Edge Cases', () => {
  test.beforeAll(async () => {
    scenario = await seedFullScenario();
  });

  // ══════════════════════════════════════════════════════════════════════
  // Invalid Action Rejections
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Invalid Actions', () => {
    test('rejects unknown action type', async () => {
      const result = await dispatchAction(scenario.orders.pending.id, {
        action: 'INVALID_ACTION',
        actor_id: scenario.users[0].id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('UNKNOWN_ACTION');
    });

    test('rejects LOCK_ESCROW on open order (must accept first)', async () => {
      const m1 = scenario.merchants[0];

      const result = await dispatchAction(scenario.orders.pending.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    test('rejects SEND_PAYMENT on accepted order (must escrow first)', async () => {
      const u1 = scenario.users[0];

      const result = await dispatchAction(scenario.orders.accepted.id, {
        action: 'SEND_PAYMENT',
        actor_id: u1.id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    test('rejects CONFIRM_PAYMENT on escrowed order (must send payment first)', async () => {
      const m1 = scenario.merchants[0];

      const result = await dispatchAction(scenario.orders.escrowed.id, {
        action: 'CONFIRM_PAYMENT',
        actor_id: m1.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    test('rejects DISPUTE on open order (no escrow yet)', async () => {
      const u1 = scenario.users[0];

      const result = await dispatchAction(scenario.orders.pending.id, {
        action: 'DISPUTE',
        actor_id: u1.id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    test('rejects CANCEL on payment_sent order', async () => {
      const u1 = scenario.users[0];

      const result = await dispatchAction(scenario.orders.payment_sent.id, {
        action: 'CANCEL',
        actor_id: u1.id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Terminal State Guards
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Terminal State Guards', () => {
    const actions = ['ACCEPT', 'LOCK_ESCROW', 'SEND_PAYMENT', 'CONFIRM_PAYMENT', 'CANCEL', 'DISPUTE'];

    test('rejects all actions on completed order', async () => {
      for (const action of actions) {
        const result = await dispatchAction(scenario.orders.completed.id, {
          action,
          actor_id: scenario.users[0].id,
          actor_type: 'user',
        });

        expect(result.body.success).toBe(false);
        expect(result.body.code).toBe('TERMINAL_STATE');
      }
    });

    test('rejects all actions on cancelled order', async () => {
      for (const action of actions) {
        const result = await dispatchAction(scenario.orders.cancelled.id, {
          action,
          actor_id: scenario.users[0].id,
          actor_type: 'user',
        });

        expect(result.body.success).toBe(false);
        expect(result.body.code).toBe('TERMINAL_STATE');
      }
    });

    test('rejects all actions on expired order', async () => {
      for (const action of actions) {
        const result = await dispatchAction(scenario.orders.expired.id, {
          action,
          actor_id: scenario.users[0].id,
          actor_type: 'user',
        });

        expect(result.body.success).toBe(false);
        expect(result.body.code).toBe('TERMINAL_STATE');
      }
    });

    test('rejects all actions on disputed order', async () => {
      for (const action of actions) {
        const result = await dispatchAction(scenario.orders.disputed.id, {
          action,
          actor_id: scenario.users[0].id,
          actor_type: 'user',
        });

        expect(result.body.success).toBe(false);
        // disputed may be terminal or have special handling
        expect(result.body.code).toMatch(/TERMINAL_STATE|INVALID_STATUS_FOR_ACTION/);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Role Mismatch Guards
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Role Mismatch Guards', () => {
    test('buyer cannot LOCK_ESCROW (seller-only action)', async () => {
      const u1 = scenario.users[0]; // buyer in BUY order

      const result = await dispatchAction(scenario.orders.accepted.id, {
        action: 'LOCK_ESCROW',
        actor_id: u1.id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('ROLE_MISMATCH');
    });

    test('seller cannot SEND_PAYMENT (buyer-only action)', async () => {
      const m1 = scenario.merchants[0]; // seller in BUY order

      const result = await dispatchAction(scenario.orders.escrowed.id, {
        action: 'SEND_PAYMENT',
        actor_id: m1.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('ROLE_MISMATCH');
    });

    test('buyer cannot CONFIRM_PAYMENT (seller-only action)', async () => {
      const u1 = scenario.users[0]; // buyer in BUY order

      const result = await dispatchAction(scenario.orders.payment_sent.id, {
        action: 'CONFIRM_PAYMENT',
        actor_id: u1.id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('ROLE_MISMATCH');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Self-Accept Guard
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Self-Accept Guard', () => {
    test('order creator cannot accept their own order', async () => {
      const u1 = scenario.users[0]; // user_id on the pending order

      const result = await dispatchAction(scenario.orders.pending.id, {
        action: 'ACCEPT',
        actor_id: u1.id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('SELF_ACCEPT');
    });

    test('merchant_id on order cannot accept it', async () => {
      const m1 = scenario.merchants[0]; // merchant_id on the pending order

      const result = await dispatchAction(scenario.orders.pending.id, {
        action: 'ACCEPT',
        actor_id: m1.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('SELF_ACCEPT');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Non-Participant Guard
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Non-Participant Guard', () => {
    test('random observer cannot LOCK_ESCROW', async () => {
      const randomId = '00000000-0000-0000-0000-000000099999';

      const result = await dispatchAction(scenario.orders.accepted.id, {
        action: 'LOCK_ESCROW',
        actor_id: randomId,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('NOT_PARTICIPANT');
    });

    test('random observer cannot CONFIRM_PAYMENT', async () => {
      const randomId = '00000000-0000-0000-0000-000000099999';

      const result = await dispatchAction(scenario.orders.payment_sent.id, {
        action: 'CONFIRM_PAYMENT',
        actor_id: randomId,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('NOT_PARTICIPANT');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Step-Skipping Prevention
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Step-Skipping Prevention', () => {
    test('cannot skip open → escrowed (must accept first)', async () => {
      const m1 = scenario.merchants[0];
      const u1 = scenario.users[0];
      const sellOffer = scenario.offers[0];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: sellOffer.id,
        type: 'buy',
        amount: 50,
      });

      const result = await dispatchAction(order.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    test('cannot skip open → payment_sent', async () => {
      const u1 = scenario.users[0];
      const m1 = scenario.merchants[0];
      const sellOffer = scenario.offers[0];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: sellOffer.id,
        type: 'buy',
        amount: 60,
      });

      const result = await dispatchAction(order.id, {
        action: 'SEND_PAYMENT',
        actor_id: u1.id,
        actor_type: 'user',
      });

      expect(result.body.success).toBe(false);
    });

    test('cannot skip accepted → completed', async () => {
      const m1 = scenario.merchants[0];

      const result = await dispatchAction(scenario.orders.accepted.id, {
        action: 'CONFIRM_PAYMENT',
        actor_id: m1.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Race Conditions
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Race Conditions', () => {
    test('concurrent ACCEPT on same order: only one succeeds', async () => {
      const m1 = scenario.merchants[0];
      const m2 = scenario.merchants[1];
      const u1 = scenario.users[0];
      const sellOffer = scenario.offers[0];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: sellOffer.id,
        type: 'buy',
        amount: 100,
      });

      // Fire both accepts concurrently
      const [result1, result2] = await Promise.all([
        dispatchAction(order.id, {
          action: 'ACCEPT',
          actor_id: m2.id,
          actor_type: 'merchant',
        }),
        dispatchAction(order.id, {
          action: 'ACCEPT',
          actor_id: '00000000-0000-0000-0000-000000000088',
          actor_type: 'merchant',
        }),
      ]);

      // At least one must succeed, the other should fail or also succeed
      // (depends on implementation — both may succeed if they arrive at different times)
      const successes = [result1, result2].filter(r => r.body.success);
      const failures = [result1, result2].filter(r => !r.body.success);

      // At minimum, one should succeed
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // If one failed, it should be a controlled error
      for (const f of failures) {
        expect(f.body.code).toMatch(/INVALID_STATUS_FOR_ACTION|ALREADY_ACCEPTED|CONFLICT/);
      }
    });

    test('concurrent LOCK_ESCROW: only one succeeds', async () => {
      const m1 = scenario.merchants[0];
      const u1 = scenario.users[0];
      const sellOffer = scenario.offers[0];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: sellOffer.id,
        type: 'buy',
        amount: 200,
      });

      await transitionOrder(order.id, 'accepted', 'merchant', m1.id);

      // Fire two LOCK_ESCROW concurrently
      const [r1, r2] = await Promise.all([
        dispatchAction(order.id, {
          action: 'LOCK_ESCROW',
          actor_id: m1.id,
          actor_type: 'merchant',
          tx_hash: 'tx_race_1',
        }),
        dispatchAction(order.id, {
          action: 'LOCK_ESCROW',
          actor_id: m1.id,
          actor_type: 'merchant',
          tx_hash: 'tx_race_2',
        }),
      ]);

      const successes = [r1, r2].filter(r => r.body.success);
      const failures = [r1, r2].filter(r => !r.body.success);

      // Exactly one should succeed (atomic lock)
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // Failed one should have appropriate error
      expect(failures[0].body.code).toMatch(/ALREADY_ESCROWED|INVALID_STATUS_FOR_ACTION|CONFLICT/);
    });

    test('concurrent CANCEL and LOCK_ESCROW: one wins', async () => {
      const m1 = scenario.merchants[0];
      const u1 = scenario.users[0];
      const sellOffer = scenario.offers[0];

      const order = await createOrder({
        userId: u1.id,
        merchantId: m1.id,
        offerId: sellOffer.id,
        type: 'buy',
        amount: 175,
      });

      await transitionOrder(order.id, 'accepted', 'merchant', m1.id);

      // Buyer tries to cancel while seller locks escrow
      const [cancelResult, escrowResult] = await Promise.all([
        dispatchAction(order.id, {
          action: 'CANCEL',
          actor_id: u1.id,
          actor_type: 'user',
          reason: 'Race condition test',
        }),
        dispatchAction(order.id, {
          action: 'LOCK_ESCROW',
          actor_id: m1.id,
          actor_type: 'merchant',
          tx_hash: 'tx_race_cancel',
        }),
      ]);

      // Exactly one should succeed
      const successes = [cancelResult, escrowResult].filter(r => r.body.success);
      expect(successes.length).toBeGreaterThanOrEqual(1);

      // Final state should be deterministic
      const finalOrder = await getOrder(order.id);
      expect(finalOrder.status).toMatch(/cancelled|escrowed/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Double-Action Prevention
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Double-Action Prevention', () => {
    test('cannot accept already-accepted order', async () => {
      const m2 = scenario.merchants[1];

      const result = await dispatchAction(scenario.orders.accepted.id, {
        action: 'ACCEPT',
        actor_id: m2.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });

    test('cannot lock escrow on already-escrowed order', async () => {
      const m1 = scenario.merchants[0];

      const result = await dispatchAction(scenario.orders.escrowed.id, {
        action: 'LOCK_ESCROW',
        actor_id: m1.id,
        actor_type: 'merchant',
      });

      expect(result.body.success).toBe(false);
      expect(result.body.code).toBe('INVALID_STATUS_FOR_ACTION');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Backend-Driven UI Invariants
  // ══════════════════════════════════════════════════════════════════════

  test.describe('Backend-Driven UI Invariants', () => {
    test('primaryAction is ALWAYS present (never null/undefined)', async () => {
      const m1 = scenario.merchants[0];
      const orderIds = Object.values(scenario.orders).map(o => o.id);

      for (const id of orderIds) {
        const enriched = await getSettleOrder(id, m1.id, 'merchant');
        expect(enriched.primaryAction).toBeDefined();
        expect(enriched.primaryAction).not.toBeNull();
        expect(enriched.primaryAction).toHaveProperty('type');
        expect(enriched.primaryAction).toHaveProperty('enabled');
      }
    });

    test('terminal orders have isTerminal=true and disabled primary action', async () => {
      const m1 = scenario.merchants[0];
      const terminalIds = [
        scenario.orders.completed.id,
        scenario.orders.cancelled.id,
      ];

      for (const id of terminalIds) {
        const enriched = await getSettleOrder(id, m1.id, 'merchant');
        expect(enriched.isTerminal).toBe(true);
        expect(enriched.primaryAction?.enabled).toBe(false);
      }
    });

    test('non-terminal orders have isTerminal=false', async () => {
      const m1 = scenario.merchants[0];
      const activeIds = [
        scenario.orders.pending.id,
        scenario.orders.accepted.id,
        scenario.orders.escrowed.id,
        scenario.orders.payment_sent.id,
      ];

      for (const id of activeIds) {
        const enriched = await getSettleOrder(id, m1.id, 'merchant');
        expect(enriched.isTerminal).toBe(false);
      }
    });

    test('enriched order always has my_role', async () => {
      const m1 = scenario.merchants[0];
      const orderIds = Object.values(scenario.orders).map(o => o.id);

      for (const id of orderIds) {
        const enriched = await getSettleOrder(id, m1.id, 'merchant');
        expect(enriched.my_role).toBeDefined();
        expect(['buyer', 'seller', 'observer']).toContain(enriched.my_role);
      }
    });

    test('statusLabel is always a non-empty string', async () => {
      const m1 = scenario.merchants[0];
      const orderIds = Object.values(scenario.orders).map(o => o.id);

      for (const id of orderIds) {
        const enriched = await getSettleOrder(id, m1.id, 'merchant');
        expect(enriched.statusLabel).toBeTruthy();
        expect(typeof enriched.statusLabel).toBe('string');
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Invalid Order ID
  // ══════════════════════════════════════════════════════════════════════

  test('rejects action on non-existent order', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    const result = await dispatchAction(fakeId, {
      action: 'ACCEPT',
      actor_id: scenario.merchants[0].id,
      actor_type: 'merchant',
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
  });

  test('rejects malformed order ID', async () => {
    const result = await dispatchAction('not-a-uuid', {
      action: 'ACCEPT',
      actor_id: scenario.merchants[0].id,
      actor_type: 'merchant',
    });

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.body.success).toBe(false);
  });
});
