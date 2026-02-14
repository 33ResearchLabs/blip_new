/**
 * API Helpers for Playwright Tests
 *
 * These helpers call the core-api and settle endpoints
 * to seed data, transition orders, and perform test setup.
 */

const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4010';
const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.CORE_API_SECRET;
  if (secret) h['x-core-api-secret'] = secret;
  return h;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function resetDatabase(): Promise<void> {
  // Retry with backoff — the first call may hit before settle is fully warmed
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${SETTLE_URL}/api/test/reset`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ confirm: true }),
      });
      if (res.ok) return;
      const body = await res.text().catch(() => '');
      if (attempt < 4) {
        console.log(`[api] Reset attempt ${attempt + 1} failed (${res.status}), retrying...`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(`Reset failed after ${attempt + 1} attempts: ${res.status} ${body}`);
    } catch (err: any) {
      if (err.message?.startsWith('Reset failed after')) throw err;
      if (attempt < 4) {
        console.log(`[api] Reset attempt ${attempt + 1} error: ${err.message}, retrying...`);
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

export async function seedFixtures(): Promise<{
  users: Array<{ id: string; username: string }>;
  merchants: Array<{ id: string; username: string }>;
  offers: Array<{ id: string; type: string; merchant_id: string }>;
}> {
  const res = await fetch(`${SETTLE_URL}/api/test/seed`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ scenario: 'full' }),
  });
  if (!res.ok) throw new Error(`Seed failed: ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`Seed failed: ${data.error}`);
  return data.data;
}

export async function createOrder(params: {
  userId: string;
  merchantId: string;
  offerId: string;
  type: 'buy' | 'sell';
  amount: number;
  rate?: number;
}): Promise<{ id: string; order_number: string; status: string }> {
  const rate = params.rate || 3.67;
  const res = await fetch(`${CORE_API_URL}/v1/orders`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      user_id: params.userId,
      merchant_id: params.merchantId,
      offer_id: params.offerId,
      type: params.type,
      payment_method: 'bank',
      crypto_amount: params.amount,
      fiat_amount: params.amount * rate,
      rate,
      payment_details: { bank_name: 'Test Bank' },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`createOrder failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.data;
}

export async function transitionOrder(
  orderId: string,
  status: string,
  actorType: string,
  actorId: string,
): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ status, actor_type: actorType, actor_id: actorId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`transitionOrder(${orderId} -> ${status}) failed: ${res.status} ${body}`);
  }
}

export async function lockEscrow(
  orderId: string,
  actorType: string,
  actorId: string,
): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}/escrow`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      tx_hash: `mock_escrow_test_${orderId.slice(0, 8)}`,
      actor_type: actorType,
      actor_id: actorId,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`lockEscrow(${orderId}) failed: ${res.status} ${body}`);
  }
}

export async function releaseEscrow(orderId: string, actorType = 'system', actorId = 'test'): Promise<void> {
  const h = headers();
  h['x-actor-type'] = actorType;
  h['x-actor-id'] = actorId;
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}/events`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      event_type: 'release',
      tx_hash: `mock_release_test_${orderId.slice(0, 8)}`,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`releaseEscrow(${orderId}) failed: ${res.status} ${body}`);
  }
}

export async function disputeOrder(
  orderId: string,
  actorType: string,
  actorId: string,
): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}/dispute`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      reason: 'payment_not_received',
      description: 'Automated test dispute',
      initiated_by: actorType,
      actor_id: actorId,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`disputeOrder(${orderId}) failed: ${res.status} ${body}`);
  }
}

export async function cancelOrder(
  orderId: string,
  actorType: string,
  actorId: string,
): Promise<void> {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}?actor_type=${actorType}&actor_id=${actorId}&reason=Test+cancel`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`cancelOrder(${orderId}) failed: ${res.status} ${body}`);
  }
}

export async function getOrder(orderId: string): Promise<any> {
  const res = await fetch(`${CORE_API_URL}/v1/orders/${orderId}`, {
    headers: headers(),
  });
  if (!res.ok) throw new Error(`getOrder(${orderId}) failed: ${res.status}`);
  const data = await res.json();
  return data.data;
}

export type ScenarioData = Awaited<ReturnType<typeof seedFullScenario>>;

/**
 * Seed a complete test scenario with orders in all states.
 * Returns deterministic order references for test assertions.
 */
export async function seedFullScenario(): Promise<{
  users: Array<{ id: string; username: string }>;
  merchants: Array<{ id: string; username: string }>;
  offers: Array<{ id: string; type: string; merchant_id: string }>;
  orders: {
    pending: { id: string; order_number: string };
    accepted: { id: string; order_number: string };
    escrowed: { id: string; order_number: string };
    payment_sent: { id: string; order_number: string };
    completed: { id: string; order_number: string };
    cancelled: { id: string; order_number: string };
    expired: { id: string; order_number: string };
    disputed: { id: string; order_number: string };
  };
}> {
  await resetDatabase();
  const fixtures = await seedFixtures();

  const u1 = fixtures.users[0].id;
  const m1 = fixtures.merchants[0].id;
  const m2 = fixtures.merchants[1].id;
  const sellOffer = fixtures.offers[0].id;
  const buyOffer = fixtures.offers[1].id;
  const m2SellOffer = fixtures.offers[2].id;

  // Create one order per state
  const pendingOrder = await createOrder({ userId: u1, merchantId: m1, offerId: sellOffer, type: 'buy', amount: 100 });

  const acceptedOrder = await createOrder({ userId: u1, merchantId: m1, offerId: sellOffer, type: 'buy', amount: 200 });
  await transitionOrder(acceptedOrder.id, 'accepted', 'merchant', m1);

  const escrowedOrder = await createOrder({ userId: u1, merchantId: m1, offerId: sellOffer, type: 'buy', amount: 300 });
  await transitionOrder(escrowedOrder.id, 'accepted', 'merchant', m1);
  await lockEscrow(escrowedOrder.id, 'merchant', m1);

  const paymentSentOrder = await createOrder({ userId: u1, merchantId: m1, offerId: sellOffer, type: 'buy', amount: 400 });
  await transitionOrder(paymentSentOrder.id, 'accepted', 'merchant', m1);
  await lockEscrow(paymentSentOrder.id, 'merchant', m1);
  await transitionOrder(paymentSentOrder.id, 'payment_sent', 'user', u1);

  const completedOrder = await createOrder({ userId: u1, merchantId: m2, offerId: m2SellOffer, type: 'buy', amount: 500 });
  await transitionOrder(completedOrder.id, 'accepted', 'merchant', m2);
  await lockEscrow(completedOrder.id, 'merchant', m2);
  await transitionOrder(completedOrder.id, 'payment_sent', 'user', u1);
  // Skip payment_confirmed (transient status) — releaseEscrow auto-sets it
  await releaseEscrow(completedOrder.id, 'merchant', m2);

  const cancelledOrder = await createOrder({ userId: u1, merchantId: m1, offerId: sellOffer, type: 'buy', amount: 150 });
  await cancelOrder(cancelledOrder.id, 'user', u1);

  const expiredOrder = await createOrder({ userId: u1, merchantId: m1, offerId: buyOffer, type: 'sell', amount: 175 });
  await transitionOrder(expiredOrder.id, 'expired', 'system', m1);

  const disputedOrder = await createOrder({ userId: u1, merchantId: m1, offerId: sellOffer, type: 'buy', amount: 600 });
  await transitionOrder(disputedOrder.id, 'accepted', 'merchant', m1);
  await lockEscrow(disputedOrder.id, 'merchant', m1);
  await transitionOrder(disputedOrder.id, 'payment_sent', 'user', u1);
  await disputeOrder(disputedOrder.id, 'merchant', m1);

  return {
    users: fixtures.users,
    merchants: fixtures.merchants,
    offers: fixtures.offers,
    orders: {
      pending: { id: pendingOrder.id, order_number: pendingOrder.order_number },
      accepted: { id: acceptedOrder.id, order_number: acceptedOrder.order_number },
      escrowed: { id: escrowedOrder.id, order_number: escrowedOrder.order_number },
      payment_sent: { id: paymentSentOrder.id, order_number: paymentSentOrder.order_number },
      completed: { id: completedOrder.id, order_number: completedOrder.order_number },
      cancelled: { id: cancelledOrder.id, order_number: cancelledOrder.order_number },
      expired: { id: expiredOrder.id, order_number: expiredOrder.order_number },
      disputed: { id: disputedOrder.id, order_number: disputedOrder.order_number },
    },
  };
}
