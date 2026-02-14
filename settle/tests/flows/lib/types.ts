/**
 * TypeScript Types for Flow Tests
 */

import { OrderStatus, ActorType } from '../../../src/lib/types/database';

export interface TestData {
  users: TestUser[];
  merchants: TestMerchant[];
  offers: TestOffer[];
}

export interface TestUser {
  id: string;
  username: string;
  wallet_address: string;
  balance: number;
  kyc_status: string;
}

export interface TestMerchant {
  id: string;
  username: string;
  display_name: string;
  wallet_address: string;
  balance: number;
  status: string;
}

export interface TestOffer {
  id: string;
  merchant_id: string;
  type: 'buy' | 'sell';
  payment_method: string;
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  event_type: string;
  actor_type: ActorType;
  actor_id: string;
  old_status: OrderStatus | null;
  new_status: OrderStatus;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Order {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  type: 'buy' | 'sell';
  status: OrderStatus; // DB status (12 statuses)
  minimal_status?: string; // API minimal status (8 statuses)
  crypto_amount: number;
  fiat_amount: number;
  rate: number;
  created_at: string;
  [key: string]: unknown;
}

export interface TestScenario {
  name: string;
  description: string;
  run: (api: ApiClient, testData: TestData) => Promise<void>;
}

export interface TestResult {
  scenario: string;
  passed: boolean;
  duration: number;
  error?: string;
  orderEvents?: OrderEvent[];
}

export interface ExpectedTransition {
  from: OrderStatus | null;
  to: OrderStatus;
  actor: ActorType;
}

// Re-export ApiClient type
export type { ApiClient } from './http';
