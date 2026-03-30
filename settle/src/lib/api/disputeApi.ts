import { fetchWithAuth } from './fetchWithAuth';

/**
 * Fetch dispute info for an order.
 * Shared between useDisputeHandlers (merchant) and useUserOrderActions (user).
 * Returns the dispute data or null if not found/error.
 */
export async function fetchDisputeInfoFromApi(orderId: string): Promise<{
  id: string;
  status: string;
  reason: string;
  proposed_resolution?: string;
  resolution_notes?: string;
  user_confirmed?: boolean;
  merchant_confirmed?: boolean;
} | null> {
  try {
    const res = await fetchWithAuth(`/api/orders/${orderId}/dispute`);
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.data) {
        return data.data;
      }
    }
    return null;
  } catch (err) {
    console.error('Failed to fetch dispute info:', err);
    return null;
  }
}
