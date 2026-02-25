/**
 * Reviews Service — API communication for trade reviews
 *
 * Pure async functions. No React state.
 */

import api from '@/lib/api/client';

// ─── Types ────────────────────────────────────────────────────────────

export interface SubmitReviewParams {
  orderId: string;
  reviewer_type: 'user' | 'merchant';
  reviewer_id: string;
  reviewee_type: 'user' | 'merchant';
  reviewee_id: string;
  rating: number;
  comment?: string;
}

// ─── Service functions ────────────────────────────────────────────────

/** Submit a review for a completed trade */
export async function submitReview(params: SubmitReviewParams) {
  const { orderId, ...body } = params;
  return api.orders.submitReview(orderId, body);
}
