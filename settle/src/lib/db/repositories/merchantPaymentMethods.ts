import { query, queryOne, transaction } from '../index';

export interface MerchantPaymentMethodRow {
  id: string;
  merchant_id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
  name: string;
  details: string;
  is_default: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Get all active payment methods for a merchant
export async function getMerchantPaymentMethods(merchantId: string): Promise<MerchantPaymentMethodRow[]> {
  return query<MerchantPaymentMethodRow>(
    'SELECT * FROM merchant_payment_methods WHERE merchant_id = $1 AND is_active = true ORDER BY is_default DESC, created_at DESC',
    [merchantId]
  );
}

// Add a new payment method.
// Wraps clear-default + insert in a single transaction so the unique
// constraint on (merchant_id) WHERE is_default = true is never violated.
export async function addMerchantPaymentMethod(data: {
  merchant_id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
  name: string;
  details: string;
  is_default?: boolean;
}): Promise<MerchantPaymentMethodRow> {
  return transaction(async (client) => {
    if (data.is_default) {
      await client.query(
        'UPDATE merchant_payment_methods SET is_default = false, updated_at = now() WHERE merchant_id = $1 AND is_default = true',
        [data.merchant_id]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO merchant_payment_methods (merchant_id, type, name, details, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.merchant_id, data.type, data.name, data.details, data.is_default ?? false]
    );
    return rows[0] as MerchantPaymentMethodRow;
  });
}

// Set a method as default
export async function setMerchantPaymentMethodDefault(
  id: string,
  merchantId: string
): Promise<MerchantPaymentMethodRow | null> {
  // Clear existing default
  await query(
    'UPDATE merchant_payment_methods SET is_default = false, updated_at = now() WHERE merchant_id = $1 AND is_default = true',
    [merchantId]
  );
  // Set new default
  return queryOne<MerchantPaymentMethodRow>(
    'UPDATE merchant_payment_methods SET is_default = true, updated_at = now() WHERE id = $1 AND merchant_id = $2 AND is_active = true RETURNING *',
    [id, merchantId]
  );
}

// Get a merchant's default payment method (for locking into orders)
export async function getMerchantDefaultPaymentMethod(merchantId: string): Promise<MerchantPaymentMethodRow | null> {
  // Prefer default, fall back to most recent active
  return queryOne<MerchantPaymentMethodRow>(
    `SELECT * FROM merchant_payment_methods
     WHERE merchant_id = $1 AND is_active = true
     ORDER BY is_default DESC, created_at DESC
     LIMIT 1`,
    [merchantId]
  );
}

// Edit an existing payment method's name and/or details. The `type` is
// intentionally not editable — switching type would require re-validating
// the details payload against a different shape; users should delete and
// re-add instead. Default flag is also handled separately via PATCH.
export async function updateMerchantPaymentMethod(
  id: string,
  merchantId: string,
  data: { name?: string; details?: string }
): Promise<MerchantPaymentMethodRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let p = 1;
  if (data.name !== undefined) {
    sets.push(`name = $${p++}`);
    values.push(data.name);
  }
  if (data.details !== undefined) {
    sets.push(`details = $${p++}`);
    values.push(data.details);
  }
  if (sets.length === 0) {
    return queryOne<MerchantPaymentMethodRow>(
      'SELECT * FROM merchant_payment_methods WHERE id = $1 AND merchant_id = $2 AND is_active = true',
      [id, merchantId]
    );
  }
  sets.push('updated_at = now()');
  values.push(id, merchantId);
  return queryOne<MerchantPaymentMethodRow>(
    `UPDATE merchant_payment_methods SET ${sets.join(', ')}
     WHERE id = $${p++} AND merchant_id = $${p++} AND is_active = true
     RETURNING *`,
    values
  );
}

// Soft-delete (deactivate) a payment method
export async function deleteMerchantPaymentMethod(id: string, merchantId: string): Promise<boolean> {
  const result = await query(
    'UPDATE merchant_payment_methods SET is_active = false, is_default = false, updated_at = now() WHERE id = $1 AND merchant_id = $2 RETURNING id',
    [id, merchantId]
  );
  return result.length > 0;
}
