/**
 * P2P Action Helpers for E2E Tests
 *
 * Wraps POST /api/orders/{id}/action calls against the Settle API
 * for backend-driven P2P trading flows.
 */

const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';

function settleHeaders(actorId?: string, merchantId?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.CORE_API_SECRET;
  if (secret) h['x-core-api-secret'] = secret;
  if (merchantId) h['x-merchant-id'] = merchantId;
  return h;
}

export interface ActionPayload {
  action: string;
  actor_id: string;
  actor_type: 'user' | 'merchant';
  reason?: string;
  tx_hash?: string;
  acceptor_wallet_address?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
}

export interface ActionResponse {
  success: boolean;
  order?: any;
  action?: string;
  previousStatus?: string;
  newStatus?: string;
  error?: string;
  code?: string;
  my_role?: string;
  primaryAction?: { type: string | null; label: string; enabled: boolean; disabledReason?: string };
  secondaryAction?: { type: string | null; label: string } | null;
  nextStepText?: string;
  isTerminal?: boolean;
  showChat?: boolean;
}

/**
 * Dispatch an action to the Settle order action endpoint.
 * Returns the full response for assertion.
 */
export async function dispatchAction(
  orderId: string,
  payload: ActionPayload,
): Promise<{ status: number; body: ActionResponse }> {
  const merchantId = payload.actor_type === 'merchant' ? payload.actor_id : undefined;
  const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}/action`, {
    method: 'POST',
    headers: settleHeaders(payload.actor_id, merchantId),
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({ success: false, error: 'Invalid JSON' }));
  return { status: res.status, body };
}

/**
 * Fetch a single order from Settle with enriched UI fields.
 */
export async function getSettleOrder(
  orderId: string,
  actorId: string,
  actorType: 'user' | 'merchant' = 'merchant',
): Promise<any> {
  const h = settleHeaders(actorId, actorType === 'merchant' ? actorId : undefined);
  const qs = `actor_id=${actorId}&actor_type=${actorType}`;
  const res = await fetch(`${SETTLE_URL}/api/orders/${orderId}?${qs}`, { headers: h });
  if (!res.ok) throw new Error(`getSettleOrder(${orderId}) failed: ${res.status}`);
  const data = await res.json();
  return data.order || data.data || data;
}

/**
 * Fetch merchant order list from Settle.
 */
export async function getMerchantOrders(merchantId: string): Promise<any[]> {
  const h = settleHeaders(merchantId, merchantId);
  const res = await fetch(`${SETTLE_URL}/api/merchant/orders?merchant_id=${merchantId}`, { headers: h });
  if (!res.ok) throw new Error(`getMerchantOrders failed: ${res.status}`);
  const data = await res.json();
  return data.orders || data.data || [];
}

/**
 * Retry helper — retries a function with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 1000 }: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}
