/**
 * Schema Snapshot Tests (LOCK #5)
 *
 * Pure unit tests — no DB, no WS. Validates that Zod schemas accept/reject
 * the correct payloads. If anyone changes a schema, these tests break.
 *
 * Run: npx tsx apps/core-api/tests/schemaSnapshot.test.ts
 */

import assert from 'assert';
import {
  SCHEMA_VERSION,
  orderCreatedBroadcastSchema,
  orderEscrowedBroadcastSchema,
  orderPaymentSentBroadcastSchema,
  orderCompletedBroadcastSchema,
  orderDisputedBroadcastSchema,
  broadcastPayloadSchema,
  pusherOrderCreatedSchema,
  pusherStatusUpdatedSchema,
  pusherOrderCancelledSchema,
} from 'settlement-core';

let passed = 0;
let failed = 0;
const tests: Array<{ name: string; fn: () => Promise<void> }> = [];

function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

// ── Valid WS payloads ──

const validBase = {
  schema_version: SCHEMA_VERSION,
  order_id: 'order-123',
  status: 'pending',
  minimal_status: 'open',
  order_version: 1,
};

test('WS: orderCreatedBroadcastSchema accepts valid payload', async () => {
  const result = orderCreatedBroadcastSchema.safeParse({
    ...validBase,
    event_type: 'ORDER_CREATED',
    userId: 'user-1',
    merchantId: 'merchant-1',
  });
  assert.strictEqual(result.success, true, `Errors: ${JSON.stringify(result.error?.issues)}`);
});

test('WS: orderEscrowedBroadcastSchema accepts valid payload', async () => {
  const result = orderEscrowedBroadcastSchema.safeParse({
    ...validBase,
    event_type: 'ORDER_ESCROWED',
    status: 'escrowed',
    minimal_status: 'escrowed',
    previousStatus: 'accepted',
  });
  assert.strictEqual(result.success, true);
});

test('WS: orderPaymentSentBroadcastSchema accepts valid payload', async () => {
  const result = orderPaymentSentBroadcastSchema.safeParse({
    ...validBase,
    event_type: 'ORDER_PAYMENT_SENT',
    status: 'payment_sent',
  });
  assert.strictEqual(result.success, true);
});

test('WS: orderCompletedBroadcastSchema accepts valid payload', async () => {
  const result = orderCompletedBroadcastSchema.safeParse({
    ...validBase,
    event_type: 'ORDER_COMPLETED',
    status: 'completed',
  });
  assert.strictEqual(result.success, true);
});

test('WS: orderDisputedBroadcastSchema accepts valid payload', async () => {
  const result = orderDisputedBroadcastSchema.safeParse({
    ...validBase,
    event_type: 'ORDER_DISPUTED',
    status: 'disputed',
  });
  assert.strictEqual(result.success, true);
});

// ── Valid Pusher payloads ──

test('Pusher: pusherOrderCreatedSchema accepts valid payload', async () => {
  const result = pusherOrderCreatedSchema.safeParse({
    schema_version: SCHEMA_VERSION,
    orderId: 'order-123',
    status: 'pending',
    minimal_status: 'open',
    order_version: 1,
    createdAt: new Date().toISOString(),
  });
  assert.strictEqual(result.success, true, `Errors: ${JSON.stringify(result.error?.issues)}`);
});

test('Pusher: pusherStatusUpdatedSchema accepts valid payload', async () => {
  const result = pusherStatusUpdatedSchema.safeParse({
    schema_version: SCHEMA_VERSION,
    orderId: 'order-123',
    status: 'escrowed',
    minimal_status: 'escrowed',
    order_version: 2,
    previousStatus: 'accepted',
    updatedAt: new Date().toISOString(),
  });
  assert.strictEqual(result.success, true, `Errors: ${JSON.stringify(result.error?.issues)}`);
});

test('Pusher: pusherOrderCancelledSchema accepts valid payload', async () => {
  const result = pusherOrderCancelledSchema.safeParse({
    schema_version: SCHEMA_VERSION,
    orderId: 'order-123',
    minimal_status: 'cancelled',
    order_version: 3,
    cancelledAt: new Date().toISOString(),
  });
  assert.strictEqual(result.success, true, `Errors: ${JSON.stringify(result.error?.issues)}`);
});

// ── Rejection tests ──

test('WS: rejects missing schema_version', async () => {
  const result = broadcastPayloadSchema.safeParse({
    event_type: 'ORDER_CREATED',
    order_id: 'order-123',
    status: 'pending',
    minimal_status: 'open',
    order_version: 1,
    // schema_version is missing
  });
  assert.strictEqual(result.success, false);
});

test('Pusher: rejects missing orderId', async () => {
  const result = pusherOrderCreatedSchema.safeParse({
    schema_version: SCHEMA_VERSION,
    // orderId is missing
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  assert.strictEqual(result.success, false);
});

test('WS: discriminated union rejects unknown event_type', async () => {
  const result = broadcastPayloadSchema.safeParse({
    ...validBase,
    event_type: 'ORDER_UNKNOWN_EVENT',
  });
  assert.strictEqual(result.success, false);
});

test('SCHEMA_VERSION equals 1', async () => {
  assert.strictEqual(SCHEMA_VERSION, 1, `Expected SCHEMA_VERSION=1, got ${SCHEMA_VERSION}`);
});

// ── Runner ──

async function run() {
  console.log('\nSchema Snapshot Tests\n');

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ✓ ${t.name}`);
    } catch (err: any) {
      failed++;
      console.log(`  ✗ ${t.name}`);
      console.log(`    ${err.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
