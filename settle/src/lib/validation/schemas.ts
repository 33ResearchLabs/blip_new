/**
 * Zod Validation Schemas
 *
 * Central location for all API request validation schemas.
 */

import { z } from 'zod';

// Common reusable schemas
export const uuidSchema = z.string().uuid('Invalid UUID format');

export const walletAddressSchema = z
  .string()
  .min(10, 'Invalid wallet address')
  .max(100, 'Invalid wallet address');

export const positiveAmountSchema = z
  .number()
  .positive('Amount must be positive')
  .max(1000000, 'Amount exceeds maximum');

export const ratingSchema = z
  .number()
  .int()
  .min(1, 'Rating must be at least 1')
  .max(5, 'Rating cannot exceed 5');

// Enums matching database types
export const orderStatusSchema = z.enum([
  'pending',
  'accepted',
  'escrow_pending',
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing',
  'completed',
  'cancelled',
  'disputed',
  'expired',
]);

export const actorTypeSchema = z.enum(['user', 'merchant', 'system']);

export const offerTypeSchema = z.enum(['buy', 'sell']);

export const paymentMethodSchema = z.enum(['bank', 'cash']);

export const tradePreferenceSchema = z.enum(['fast', 'cheap', 'best']);

export const disputeReasonSchema = z.enum([
  'payment_not_received',
  'crypto_not_received',
  'wrong_amount',
  'fraud',
  'other',
]);

export const disputeStatusSchema = z.enum([
  'open',
  'investigating',
  'resolved',
  'escalated',
]);

// Auth schemas
export const walletAuthSchema = z.object({
  wallet_address: walletAddressSchema,
  type: z.enum(['user', 'merchant']).default('user'),
  name: z.string().min(1).max(100).optional(),
});

// User schemas
export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  avatar_url: z.string().url().optional(),
  push_token: z.string().optional(),
});

export const addBankAccountSchema = z.object({
  bank_name: z.string().min(1, 'Bank name required').max(100),
  account_name: z.string().min(1, 'Account name required').max(100),
  iban: z.string().min(15, 'Invalid IBAN').max(34, 'Invalid IBAN'),
  is_default: z.boolean().optional().default(false),
});

// Offer schemas
export const offerFiltersSchema = z.object({
  type: offerTypeSchema.optional(),
  payment_method: paymentMethodSchema.optional(),
  amount: z.coerce.number().positive().optional(),
  preference: tradePreferenceSchema.optional(),
});

export const createOfferSchema = z.object({
  merchant_id: uuidSchema,
  type: offerTypeSchema,
  payment_method: paymentMethodSchema,
  rate: z.number().positive('Rate must be positive'),
  min_amount: positiveAmountSchema,
  max_amount: positiveAmountSchema,
  available_amount: positiveAmountSchema,
  // Bank details (required if payment_method is 'bank')
  bank_name: z.string().max(100).optional(),
  bank_account_name: z.string().max(100).optional(),
  bank_iban: z.string().max(34).optional(),
  // Cash details (required if payment_method is 'cash')
  location_name: z.string().max(200).optional(),
  location_address: z.string().max(500).optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  meeting_instructions: z.string().max(1000).optional(),
}).refine(
  (data) => {
    if (data.payment_method === 'bank') {
      return data.bank_name && data.bank_account_name && data.bank_iban;
    }
    return true;
  },
  { message: 'Bank details required for bank payment method' }
).refine(
  (data) => {
    if (data.payment_method === 'cash') {
      return data.location_name && data.location_address;
    }
    return true;
  },
  { message: 'Location details required for cash payment method' }
).refine(
  (data) => data.max_amount >= data.min_amount,
  { message: 'max_amount must be greater than or equal to min_amount' }
);

export const updateOfferSchema = z.object({
  rate: z.number().positive().optional(),
  min_amount: positiveAmountSchema.optional(),
  max_amount: positiveAmountSchema.optional(),
  available_amount: positiveAmountSchema.optional(),
  is_active: z.boolean().optional(),
  bank_name: z.string().max(100).optional(),
  bank_account_name: z.string().max(100).optional(),
  bank_iban: z.string().max(34).optional(),
  location_name: z.string().max(200).optional(),
  location_address: z.string().max(500).optional(),
  location_lat: z.number().min(-90).max(90).optional(),
  location_lng: z.number().min(-180).max(180).optional(),
  meeting_instructions: z.string().max(1000).optional(),
});

// Order schemas
export const createOrderSchema = z.object({
  user_id: uuidSchema,
  offer_id: uuidSchema.optional(),
  crypto_amount: positiveAmountSchema,
  type: offerTypeSchema,
  payment_method: paymentMethodSchema.optional(),
  preference: tradePreferenceSchema.optional(),
  user_bank_account: z.string().max(50).optional(), // User's bank IBAN for receiving fiat (sell orders)
  buyer_wallet_address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana wallet address').optional(), // Buyer's Solana wallet for receiving crypto (buy orders)
});

export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
  actor_type: actorTypeSchema,
  actor_id: uuidSchema,
  reason: z.string().max(500).optional(), // For cancellation
});

export const orderIdParamSchema = z.object({
  id: uuidSchema,
});

// Chat schemas
export const sendMessageSchema = z.object({
  sender_type: actorTypeSchema,
  sender_id: uuidSchema,
  content: z
    .string()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message too long')
    .transform((val) => sanitizeMessage(val)),
  message_type: z.enum(['text', 'image', 'system']).optional().default('text'),
  image_url: z.string().url().optional(),
});

export const markMessagesReadSchema = z.object({
  reader_type: actorTypeSchema,
});

// Review schemas
export const submitReviewSchema = z.object({
  reviewer_type: actorTypeSchema,
  reviewer_id: uuidSchema,
  reviewee_type: actorTypeSchema,
  reviewee_id: uuidSchema,
  rating: ratingSchema,
  comment: z.string().max(1000).optional(),
});

// Dispute schemas
export const createDisputeSchema = z.object({
  raised_by: actorTypeSchema,
  raiser_id: uuidSchema,
  reason: disputeReasonSchema,
  description: z.string().min(10, 'Please provide more details').max(2000),
  evidence_urls: z.array(z.string().url()).max(10).optional(),
});

export const updateDisputeSchema = z.object({
  status: disputeStatusSchema.optional(),
  resolution: z.string().max(2000).optional(),
  resolved_in_favor_of: actorTypeSchema.optional(),
});

export const addDisputeEvidenceSchema = z.object({
  evidence_urls: z.array(z.string().url()).min(1).max(10),
});

// Query parameter schemas
export const userOrdersQuerySchema = z.object({
  user_id: uuidSchema,
  status: z.string().optional(), // Comma-separated statuses
});

export const merchantOrdersQuerySchema = z.object({
  merchant_id: uuidSchema,
  status: z.string().optional(), // Comma-separated statuses
});

// Helper function to sanitize messages (basic XSS prevention)
function sanitizeMessage(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Type exports for use in handlers
export type WalletAuthInput = z.infer<typeof walletAuthSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type AddBankAccountInput = z.infer<typeof addBankAccountSchema>;
export type OfferFiltersInput = z.infer<typeof offerFiltersSchema>;
export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type MarkMessagesReadInput = z.infer<typeof markMessagesReadSchema>;
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
export type CreateDisputeInput = z.infer<typeof createDisputeSchema>;
export type UpdateDisputeInput = z.infer<typeof updateDisputeSchema>;
