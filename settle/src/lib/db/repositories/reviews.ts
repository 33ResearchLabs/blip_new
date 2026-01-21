import { query, queryOne } from '../index';
import { Review, Dispute, ActorType, DisputeReason } from '../../types/database';
import { updateMerchantRating } from './merchants';
import { recordReputationEvent, updateReputationScore } from '../../reputation';

// Reviews
export async function getReviewByOrderId(orderId: string): Promise<Review | null> {
  return queryOne<Review>('SELECT * FROM reviews WHERE order_id = $1', [orderId]);
}

export async function getUserReviews(userId: string): Promise<Review[]> {
  return query<Review>(
    'SELECT * FROM reviews WHERE reviewee_id = $1 AND reviewee_type = $2 ORDER BY created_at DESC',
    [userId, 'user']
  );
}

export async function getMerchantReviews(merchantId: string): Promise<Review[]> {
  return query<Review>(
    'SELECT * FROM reviews WHERE reviewee_id = $1 AND reviewee_type = $2 ORDER BY created_at DESC',
    [merchantId, 'merchant']
  );
}

export async function createReview(data: {
  order_id: string;
  reviewer_type: ActorType;
  reviewer_id: string;
  reviewee_type: ActorType;
  reviewee_id: string;
  rating: number;
  comment?: string;
}): Promise<Review> {
  const result = await queryOne<Review>(
    `INSERT INTO reviews (order_id, reviewer_type, reviewer_id, reviewee_type, reviewee_id, rating, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.order_id,
      data.reviewer_type,
      data.reviewer_id,
      data.reviewee_type,
      data.reviewee_id,
      data.rating,
      data.comment || null,
    ]
  );

  // Update merchant rating if reviewee is merchant
  if (data.reviewee_type === 'merchant') {
    await updateMerchantRating(data.reviewee_id);
  }

  // Record reputation event for the reviewee
  try {
    const entityType = data.reviewee_type === 'merchant' ? 'merchant' : 'user';
    await recordReputationEvent(
      data.reviewee_id,
      entityType,
      'review_received',
      `Received ${data.rating}-star review`,
      { rating: data.rating, orderId: data.order_id }
    );
  } catch (err) {
    console.error('Failed to record reputation event for review:', err);
  }

  return result!;
}

// Disputes
export async function getDisputeByOrderId(orderId: string): Promise<Dispute | null> {
  return queryOne<Dispute>('SELECT * FROM disputes WHERE order_id = $1', [orderId]);
}

export async function createDispute(data: {
  order_id: string;
  raised_by: ActorType;
  raiser_id: string;
  reason: DisputeReason;
  description?: string;
  evidence_urls?: string[];
}): Promise<Dispute> {
  const result = await queryOne<Dispute>(
    `INSERT INTO disputes (order_id, raised_by, raiser_id, reason, description, evidence_urls)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.order_id,
      data.raised_by,
      data.raiser_id,
      data.reason,
      data.description || null,
      data.evidence_urls || null,
    ]
  );

  // Update order status to disputed
  await query(
    `UPDATE orders SET status = 'disputed' WHERE id = $1`,
    [data.order_id]
  );

  // Record reputation event for dispute
  try {
    const entityType = data.raised_by === 'merchant' ? 'merchant' : 'user';
    await recordReputationEvent(
      data.raiser_id,
      entityType,
      'order_disputed',
      `Raised dispute: ${data.reason}`,
      { orderId: data.order_id, reason: data.reason }
    );
  } catch (err) {
    console.error('Failed to record reputation event for dispute:', err);
  }

  return result!;
}

export async function addDisputeEvidence(
  disputeId: string,
  evidenceUrls: string[]
): Promise<Dispute | null> {
  return queryOne<Dispute>(
    `UPDATE disputes
     SET evidence_urls = array_cat(COALESCE(evidence_urls, '{}'), $1)
     WHERE id = $2
     RETURNING *`,
    [evidenceUrls, disputeId]
  );
}

export async function resolveDispute(
  disputeId: string,
  resolution: string,
  resolvedInFavorOf: ActorType
): Promise<Dispute | null> {
  const result = await queryOne<Dispute>(
    `UPDATE disputes
     SET status = 'resolved',
         resolution = $1,
         resolved_in_favor_of = $2,
         resolved_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [resolution, resolvedInFavorOf, disputeId]
  );

  if (result) {
    // Get order details to find both parties
    const order = await queryOne<{ user_id: string; merchant_id: string }>(
      'SELECT user_id, merchant_id FROM orders WHERE id = $1',
      [result.order_id]
    );

    if (order) {
      try {
        // Record dispute outcome for both parties
        if (resolvedInFavorOf === 'user') {
          await recordReputationEvent(
            order.user_id,
            'user',
            'dispute_won',
            'Won dispute resolution',
            { disputeId, orderId: result.order_id }
          );
          await recordReputationEvent(
            order.merchant_id,
            'merchant',
            'dispute_lost',
            'Lost dispute resolution',
            { disputeId, orderId: result.order_id }
          );
        } else if (resolvedInFavorOf === 'merchant') {
          await recordReputationEvent(
            order.merchant_id,
            'merchant',
            'dispute_won',
            'Won dispute resolution',
            { disputeId, orderId: result.order_id }
          );
          await recordReputationEvent(
            order.user_id,
            'user',
            'dispute_lost',
            'Lost dispute resolution',
            { disputeId, orderId: result.order_id }
          );
        }
      } catch (err) {
        console.error('Failed to record reputation events for dispute resolution:', err);
      }
    }
  }

  return result;
}
