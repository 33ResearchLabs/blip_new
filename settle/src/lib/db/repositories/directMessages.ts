import { query, queryOne } from '../index';
import {
  MerchantContact,
  MerchantContactWithUser,
  DirectMessage,
  DirectConversation,
} from '../../types/database';

// ============ CONTACTS ============

// Get all contacts for a merchant
export async function getMerchantContacts(merchantId: string): Promise<MerchantContactWithUser[]> {
  return query<MerchantContactWithUser>(
    `SELECT
      mc.*,
      json_build_object(
        'id', u.id,
        'username', u.username,
        'rating', u.rating,
        'total_trades', u.total_trades
      ) as user
    FROM merchant_contacts mc
    JOIN users u ON mc.user_id = u.id
    WHERE mc.merchant_id = $1
    ORDER BY mc.is_favorite DESC, mc.last_trade_at DESC NULLS LAST`,
    [merchantId]
  );
}

// Add or update a contact (called when order completes)
export async function upsertMerchantContact(data: {
  merchant_id: string;
  user_id: string;
  trade_volume: number;
}): Promise<MerchantContact> {
  const result = await queryOne<MerchantContact>(
    `INSERT INTO merchant_contacts (merchant_id, user_id, trades_count, total_volume, last_trade_at)
     VALUES ($1, $2, 1, $3, NOW())
     ON CONFLICT (merchant_id, user_id)
     DO UPDATE SET
       trades_count = merchant_contacts.trades_count + 1,
       total_volume = merchant_contacts.total_volume + $3,
       last_trade_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [data.merchant_id, data.user_id, data.trade_volume]
  );
  return result!;
}

// Update contact nickname or notes
export async function updateMerchantContact(
  contactId: string,
  merchantId: string,
  data: { nickname?: string; notes?: string; is_favorite?: boolean }
): Promise<MerchantContact | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.nickname !== undefined) {
    updates.push(`nickname = $${paramIndex++}`);
    params.push(data.nickname);
  }
  if (data.notes !== undefined) {
    updates.push(`notes = $${paramIndex++}`);
    params.push(data.notes);
  }
  if (data.is_favorite !== undefined) {
    updates.push(`is_favorite = $${paramIndex++}`);
    params.push(data.is_favorite);
  }

  if (updates.length === 0) return null;

  updates.push('updated_at = NOW()');
  params.push(contactId, merchantId);

  return queryOne<MerchantContact>(
    `UPDATE merchant_contacts
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex++} AND merchant_id = $${paramIndex}
     RETURNING *`,
    params
  );
}

// ============ DIRECT MESSAGES ============

// Get conversations list for merchant
export async function getMerchantDirectConversations(merchantId: string): Promise<DirectConversation[]> {
  return query<DirectConversation>(
    `SELECT
      mc.id as contact_id,
      mc.user_id,
      u.username,
      mc.nickname,
      mc.is_favorite,
      mc.trades_count,
      (
        SELECT json_build_object(
          'content', dm.content,
          'sender_type', dm.sender_type,
          'created_at', dm.created_at,
          'is_read', dm.is_read
        )
        FROM direct_messages dm
        WHERE (dm.sender_id = $1 AND dm.recipient_id = mc.user_id)
           OR (dm.sender_id = mc.user_id AND dm.recipient_id = $1)
        ORDER BY dm.created_at DESC
        LIMIT 1
      ) as last_message,
      (
        SELECT COUNT(*)::int
        FROM direct_messages dm
        WHERE dm.sender_id = mc.user_id
          AND dm.recipient_id = $1
          AND dm.recipient_type = 'merchant'
          AND dm.is_read = false
      ) as unread_count,
      (
        SELECT MAX(dm.created_at)
        FROM direct_messages dm
        WHERE (dm.sender_id = $1 AND dm.recipient_id = mc.user_id)
           OR (dm.sender_id = mc.user_id AND dm.recipient_id = $1)
      ) as last_activity
    FROM merchant_contacts mc
    JOIN users u ON mc.user_id = u.id
    WHERE mc.merchant_id = $1
    ORDER BY last_activity DESC NULLS LAST, mc.is_favorite DESC`,
    [merchantId]
  );
}

// Get messages between merchant and user
export async function getDirectMessages(
  merchantId: string,
  userId: string,
  limit = 50,
  offset = 0
): Promise<DirectMessage[]> {
  return query<DirectMessage>(
    `SELECT * FROM direct_messages
     WHERE (sender_id = $1 AND recipient_id = $2)
        OR (sender_id = $2 AND recipient_id = $1)
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [merchantId, userId, limit, offset]
  );
}

// Send a direct message
export async function sendDirectMessage(data: {
  sender_type: 'merchant' | 'user';
  sender_id: string;
  recipient_type: 'merchant' | 'user';
  recipient_id: string;
  content: string;
  message_type?: 'text' | 'image';
  image_url?: string;
}): Promise<DirectMessage> {
  const result = await queryOne<DirectMessage>(
    `INSERT INTO direct_messages (sender_type, sender_id, recipient_type, recipient_id, content, message_type, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.sender_type,
      data.sender_id,
      data.recipient_type,
      data.recipient_id,
      data.content,
      data.message_type || 'text',
      data.image_url || null,
    ]
  );
  return result!;
}

// Mark messages as read
export async function markDirectMessagesAsRead(
  recipientId: string,
  recipientType: 'merchant' | 'user',
  senderId: string
): Promise<void> {
  await query(
    `UPDATE direct_messages
     SET is_read = true, read_at = NOW()
     WHERE recipient_id = $1
       AND recipient_type = $2
       AND sender_id = $3
       AND is_read = false`,
    [recipientId, recipientType, senderId]
  );
}

// Get total unread direct messages count for merchant
export async function getMerchantUnreadDirectCount(merchantId: string): Promise<number> {
  const result = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int as count
     FROM direct_messages
     WHERE recipient_id = $1
       AND recipient_type = 'merchant'
       AND is_read = false`,
    [merchantId]
  );
  return result?.count || 0;
}
