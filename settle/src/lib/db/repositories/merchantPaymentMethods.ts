import { query, queryOne } from '../index';

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

// Add a new payment method
export async function addMerchantPaymentMethod(data: {
  merchant_id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
  name: string;
  details: string;
  is_default?: boolean;
}): Promise<MerchantPaymentMethodRow> {
  // If this is the first method or marked default, clear existing defaults
  if (data.is_default) {
    await query(
      'UPDATE merchant_payment_methods SET is_default = false, updated_at = now() WHERE merchant_id = $1 AND is_default = true',
      [data.merchant_id]
    );
  }

  const row = await queryOne<MerchantPaymentMethodRow>(
    `INSERT INTO merchant_payment_methods (merchant_id, type, name, details, is_default)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.merchant_id, data.type, data.name, data.details, data.is_default ?? false]
  );
  return row!;
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

// Soft-delete (deactivate) a payment method
export async function deleteMerchantPaymentMethod(id: string, merchantId: string): Promise<boolean> {
  const result = await query(
    'UPDATE merchant_payment_methods SET is_active = false, is_default = false, updated_at = now() WHERE id = $1 AND merchant_id = $2 RETURNING id',
    [id, merchantId]
  );
  return result.length > 0;
}
