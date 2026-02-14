/**
 * Deterministic Test Data for Flow Tests
 *
 * This file defines fixed test accounts with predictable credentials,
 * balances, and wallet addresses for reproducible test runs.
 *
 * Password for all accounts: "test123"
 * Hash: $2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW
 */

import { OfferType, PaymentMethod } from '../types/database';

export interface TestUser {
  username: string;
  password_hash: string;
  wallet_address: string;
  balance: number;
  kyc_status: 'verified' | 'pending' | 'rejected';
  kyc_level: number;
}

export interface TestMerchant {
  wallet_address: string;
  username: string;
  business_name: string;
  display_name: string;
  email: string;
  password_hash: string;
  balance: number;
  status: 'active' | 'inactive' | 'suspended';
  is_online: boolean;
}

export interface TestOffer {
  type: OfferType;
  payment_method: PaymentMethod;
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  bank_name: string;
  bank_account_name: string;
  bank_iban: string;
  is_active: boolean;
}

// Fixed bcrypt hash for password "test123"
const TEST_PASSWORD_HASH = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW';

/**
 * Test Users
 * - test_buyer_001: Used for buy orders (user buys USDC from merchant)
 * - test_seller_002: Used for sell orders (user sells USDC to merchant)
 */
export const TEST_USERS: TestUser[] = [
  {
    username: 'test_buyer_001',
    password_hash: TEST_PASSWORD_HASH,
    wallet_address: 'BuyerWa11et2222222222222222222222222222', // Valid base58
    balance: 10000,
    kyc_status: 'verified',
    kyc_level: 1,
  },
  {
    username: 'test_seller_002',
    password_hash: TEST_PASSWORD_HASH,
    wallet_address: 'Se11erWa11et3333333333333333333333333333', // Valid base58
    balance: 10000,
    kyc_status: 'verified',
    kyc_level: 1,
  },
];

/**
 * Test Merchants
 * - test_merchant_m1: Primary merchant for user-merchant trades
 * - test_merchant_m2: Secondary merchant for M2M trades
 */
export const TEST_MERCHANTS: TestMerchant[] = [
  {
    wallet_address: 'Merchant1Wa11et44444444444444444444444', // Valid base58
    username: 'test_merchant_m1',
    business_name: 'Test Exchange LLC',
    display_name: 'TestMerchant1',
    email: 'merchant1@test.local',
    password_hash: TEST_PASSWORD_HASH,
    balance: 50000,
    status: 'active',
    is_online: true,
  },
  {
    wallet_address: 'Merchant2Wa11et55555555555555555555555', // Valid base58
    username: 'test_merchant_m2',
    business_name: 'Test Trading Co',
    display_name: 'TestMerchant2',
    email: 'merchant2@test.local',
    password_hash: TEST_PASSWORD_HASH,
    balance: 50000,
    status: 'active',
    is_online: true,
  },
];

/**
 * Test Offers
 *
 * Merchant1 offers (for user-merchant trades):
 * - Offer 0: Merchant1 sells USDC at 3.67 AED (users can buy)
 * - Offer 1: Merchant1 buys USDC at 3.65 AED (users can sell)
 *
 * Merchant2 offers (for M2M trades):
 * - Offer 2: Merchant2 sells USDC at 3.68 AED (merchants can buy)
 */
export const TEST_OFFERS: Omit<TestOffer, 'merchant_id'>[] = [
  // Merchant1 sells USDC (users can buy)
  {
    type: 'sell' as OfferType,
    payment_method: 'bank' as PaymentMethod,
    rate: 3.67,
    min_amount: 100,
    max_amount: 5000,
    available_amount: 10000,
    bank_name: 'Emirates NBD',
    bank_account_name: 'Test Exchange LLC',
    bank_iban: 'AE070331234567890000001',
    is_active: true,
  },
  // Merchant1 buys USDC (users can sell)
  {
    type: 'buy' as OfferType,
    payment_method: 'bank' as PaymentMethod,
    rate: 3.65,
    min_amount: 100,
    max_amount: 5000,
    available_amount: 10000,
    bank_name: 'Emirates NBD',
    bank_account_name: 'Test Exchange LLC',
    bank_iban: 'AE070331234567890000001',
    is_active: true,
  },
  // Merchant2 sells USDC (for M2M tests)
  {
    type: 'sell' as OfferType,
    payment_method: 'bank' as PaymentMethod,
    rate: 3.68,
    min_amount: 100,
    max_amount: 5000,
    available_amount: 10000,
    bank_name: 'Dubai Islamic Bank',
    bank_account_name: 'Test Trading Co',
    bank_iban: 'AE070331234567890000002',
    is_active: true,
  },
];

/**
 * Get offer index for a specific merchant and type
 */
export function getOfferIndex(merchantIndex: 0 | 1, offerType: 'buy' | 'sell'): number {
  if (merchantIndex === 0) {
    return offerType === 'sell' ? 0 : 1;
  }
  return 2; // Merchant2 only has sell offer
}

/**
 * Expected balance after test scenario
 * Used for balance verification in tests
 */
export interface ExpectedBalances {
  user_buyer: number;
  user_seller: number;
  merchant1: number;
  merchant2: number;
}

/**
 * Initial balances for all test accounts
 */
export const INITIAL_BALANCES: ExpectedBalances = {
  user_buyer: 10000,
  user_seller: 10000,
  merchant1: 50000,
  merchant2: 50000,
};
