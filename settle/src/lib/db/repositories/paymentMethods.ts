import { query, queryOne, transaction } from '../index';

export interface PaymentMethodRow {
  id: string;
  user_id: string;
  type: 'bank' | 'upi' | 'cash' | 'other';
  label: string;
  details: Record<string, string>;
  is_active: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

// Get all active payment methods for a user. Default first so callers don't
// need to re-sort; created_at DESC for the remainder gives newest-first
// stability inside the rest of the list.
export async function getUserPaymentMethods(userId: string): Promise<PaymentMethodRow[]> {
  return query<PaymentMethodRow>(
    'SELECT * FROM user_payment_methods WHERE user_id = $1 AND is_active = true ORDER BY is_default DESC, created_at DESC',
    [userId]
  );
}

// Get a single payment method by ID
export async function getPaymentMethodById(id: string): Promise<PaymentMethodRow | null> {
  return queryOne<PaymentMethodRow>(
    'SELECT * FROM user_payment_methods WHERE id = $1',
    [id]
  );
}

// Add a new payment method
export async function addPaymentMethod(data: {
  user_id: string;
  type: 'bank' | 'upi' | 'cash' | 'other';
  label: string;
  details: Record<string, string>;
}): Promise<PaymentMethodRow> {
  const row = await queryOne<PaymentMethodRow>(
    `INSERT INTO user_payment_methods (user_id, type, label, details)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.user_id, data.type, data.label, JSON.stringify(data.details)]
  );
  return row!;
}

// Update an existing payment method
export async function updatePaymentMethod(
  id: string,
  userId: string,
  data: {
    label?: string;
    details?: Record<string, string>;
    is_active?: boolean;
  }
): Promise<PaymentMethodRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (data.label !== undefined) {
    sets.push(`label = $${idx++}`);
    values.push(data.label);
  }
  if (data.details !== undefined) {
    sets.push(`details = $${idx++}`);
    values.push(JSON.stringify(data.details));
  }
  if (data.is_active !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(data.is_active);
  }

  if (sets.length === 0) return getPaymentMethodById(id);

  sets.push(`updated_at = now()`);
  values.push(id, userId);

  return queryOne<PaymentMethodRow>(
    `UPDATE user_payment_methods SET ${sets.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`,
    values
  );
}

// Soft-delete (deactivate) a payment method
export async function deletePaymentMethod(id: string, userId: string): Promise<boolean> {
  const result = await query(
    'UPDATE user_payment_methods SET is_active = false, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return result.length > 0;
}

// Verify a payment method belongs to a user and is active
export async function verifyPaymentMethodOwnership(
  id: string,
  userId: string
): Promise<PaymentMethodRow | null> {
  return queryOne<PaymentMethodRow>(
    'SELECT * FROM user_payment_methods WHERE id = $1 AND user_id = $2 AND is_active = true',
    [id, userId]
  );
}

// Atomically set a method as the user's default. Clears any previous
// default for the same user in the same transaction so the partial unique
// index (uq_upm_one_default_per_user) is never violated mid-flight.
// Returns the newly-defaulted row, or null if the method doesn't belong
// to the user / isn't active.
export async function setDefaultPaymentMethod(
  methodId: string,
  userId: string,
): Promise<PaymentMethodRow | null> {
  return transaction(async (client) => {
    const owned = await client.query(
      'SELECT id FROM user_payment_methods WHERE id = $1 AND user_id = $2 AND is_active = true',
      [methodId, userId],
    );
    if (owned.rowCount === 0) return null;

    await client.query(
      'UPDATE user_payment_methods SET is_default = false, updated_at = now() WHERE user_id = $1 AND is_default = true',
      [userId],
    );
    const updated = await client.query<PaymentMethodRow>(
      'UPDATE user_payment_methods SET is_default = true, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *',
      [methodId, userId],
    );
    return updated.rows[0] ?? null;
  });
}
