# 8-State Minimal Status System - Usage Examples

## Quick Reference

### Status Mapping

```typescript
// DB (12-state) → API (8-state)
pending           → open
accepted          → accepted
escrow_pending    → accepted (transient)
escrowed          → escrowed
payment_pending   → escrowed (transient)
payment_sent      → payment_sent
payment_confirmed → payment_sent (transient)
releasing         → completed (transient)
completed         → completed
cancelled         → cancelled
disputed          → disputed
expired           → expired
```

## For Frontend/API Consumers

### Reading Order Status

```typescript
// ✅ Recommended: Use minimal_status (8-state)
const order = await fetch('/api/orders/123').then(r => r.json());

// Check status using minimal_status
if (order.data.minimal_status === 'payment_sent') {
  showPaymentSentUI();
}

// Display status
const statusDisplay = {
  'open': 'Waiting for merchant',
  'accepted': 'Merchant accepted',
  'escrowed': 'Crypto locked',
  'payment_sent': 'Payment sent',
  'completed': 'Completed',
  'cancelled': 'Cancelled',
  'disputed': 'In dispute',
  'expired': 'Expired'
};

console.log(statusDisplay[order.data.minimal_status]);
```

### Rendering UI Based on Status

```typescript
interface Order {
  id: string;
  status: string; // Legacy 12-state
  minimal_status: string; // New 8-state
  crypto_amount: number;
  // ...
}

function OrderCard({ order }: { order: Order }) {
  // Use minimal_status for cleaner logic
  const { minimal_status } = order;

  // Actions based on status
  const actions = {
    open: <AcceptButton />,
    accepted: <LockEscrowButton />,
    escrowed: <MarkPaidButton />,
    payment_sent: <ConfirmReleaseButton />,
    completed: <ViewReceiptButton />,
    cancelled: null,
    disputed: <ViewDisputeButton />,
    expired: null,
  };

  return (
    <div>
      <StatusBadge status={minimal_status} />
      {actions[minimal_status as keyof typeof actions]}
    </div>
  );
}
```

### Filtering Orders

```typescript
// Filter by minimal status
const paymentSentOrders = orders.filter(
  o => o.minimal_status === 'payment_sent'
);

// This includes both payment_sent AND payment_confirmed DB statuses
// No need to check multiple statuses!
```

## For Backend Code

### Updating Order Status

```typescript
import { updateOrderStatus } from '@/lib/db/repositories/orders';

// ✅ Good - Use canonical statuses
await updateOrderStatus(
  orderId,
  'payment_sent', // Canonical status
  'user',
  userId
);

// ❌ Bad - Transient status rejected
await updateOrderStatus(
  orderId,
  'payment_confirmed', // Transient!
  'user',
  userId
);
// Error: "Status 'payment_confirmed' is a transient status and cannot be written."
```

### Creating Orders

```typescript
import { createOrder } from '@/lib/db/repositories/orders';

// Orders start in 'pending' status (normalizes to 'open')
const order = await createOrder({
  user_id: userId,
  merchant_id: merchantId,
  offer_id: offerId,
  type: 'buy',
  payment_method: 'bank',
  crypto_amount: 100,
  fiat_amount: 100000,
  rate: 1000,
});

// Response includes both statuses
console.log(order.status);          // 'pending' (DB)
console.log(order.minimal_status);  // 'open' (API)
```

### Querying by Status

```typescript
import { expandStatus } from '@/lib/orders/statusNormalizer';
import { query } from '@/lib/db';

// Find all "payment_sent" orders (includes payment_confirmed)
const dbStatuses = expandStatus('payment_sent');
// Returns: ['payment_sent', 'payment_confirmed']

const orders = await query(
  'SELECT * FROM orders WHERE status = ANY($1)',
  [dbStatuses]
);

// All returned orders will have minimal_status = 'payment_sent'
```

### Normalizing Status in Responses

```typescript
import { normalizeStatus } from '@/lib/orders/statusNormalizer';

// In API handler
export async function GET(request: Request) {
  const order = await getOrderById(orderId);

  // Add minimal_status to response
  return NextResponse.json({
    success: true,
    data: {
      ...order,
      minimal_status: normalizeStatus(order.status)
    }
  });
}
```

## Common Patterns

### Status-Based Transitions

```typescript
import { validateMinimalTransition } from '@/lib/orders/stateMachineMinimal';

// Validate transition before attempting
const validation = validateMinimalTransition(
  currentOrder.minimal_status,
  'payment_sent',
  'user'
);

if (!validation.valid) {
  return res.status(400).json({ error: validation.error });
}

// Proceed with update
await updateOrderStatus(orderId, 'payment_sent', 'user', userId);
```

### Action Mapping

```typescript
import { normalizeAction } from '@/lib/orders/statusNormalizer';

// User clicks "Mark as Paid" button
function handleAction(action: string) {
  const targetStatus = normalizeAction(action);
  // 'mark_paid' → 'payment_sent'

  if (targetStatus) {
    await updateOrderStatus(orderId, targetStatus, 'user', userId);
  }
}
```

### Status Comparison

```typescript
import { areStatusesEquivalent } from '@/lib/orders/statusNormalizer';

// Check if two DB statuses are equivalent (normalize to same minimal status)
const isEquivalent = areStatusesEquivalent(
  'payment_sent',
  'payment_confirmed'
); // true

// Useful for idempotency checks
if (areStatusesEquivalent(order.status, requestedStatus)) {
  return { success: true, order }; // No-op
}
```

### Timeline Display

```typescript
function OrderTimeline({ order }: { order: Order }) {
  // Use minimal_status for clean timeline
  const steps = [
    { status: 'open', label: 'Order Created', time: order.created_at },
    { status: 'accepted', label: 'Accepted', time: order.accepted_at },
    { status: 'escrowed', label: 'Escrowed', time: order.escrowed_at },
    { status: 'payment_sent', label: 'Payment Sent', time: order.payment_sent_at },
    { status: 'completed', label: 'Completed', time: order.completed_at },
  ];

  const currentIndex = steps.findIndex(s => s.status === order.minimal_status);

  return (
    <div>
      {steps.map((step, idx) => (
        <Step
          key={step.status}
          label={step.label}
          completed={idx < currentIndex}
          active={idx === currentIndex}
          time={step.time}
        />
      ))}
    </div>
  );
}
```

## Migration from Legacy Code

### Before (12-state)

```typescript
// ❌ Old way - checking multiple statuses
if (
  order.status === 'payment_sent' ||
  order.status === 'payment_confirmed'
) {
  showPaymentUI();
}

// ❌ Old way - complex status checks
const isInProgress = [
  'pending',
  'accepted',
  'escrow_pending',
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing'
].includes(order.status);
```

### After (8-state)

```typescript
// ✅ New way - single status check
if (order.minimal_status === 'payment_sent') {
  showPaymentUI();
}

// ✅ New way - simple status checks
import { isMinimalActiveStatus } from '@/lib/orders/stateMachineMinimal';

const isInProgress = isMinimalActiveStatus(order.minimal_status);
```

## Error Handling

### Handling Transient Status Errors

```typescript
async function updateStatus(orderId: string, status: string) {
  try {
    const result = await updateOrderStatus(orderId, status, 'user', userId);

    if (!result.success) {
      // Check if error is due to transient status
      if (result.error?.includes('transient status')) {
        // Extract suggested status from error message
        console.error('Use minimal status instead:', result.error);
        // Retry with canonical status
      }
      throw new Error(result.error);
    }

    return result.order;
  } catch (error) {
    console.error('Status update failed:', error);
    throw error;
  }
}
```

### Validation Before Update

```typescript
import { validateStatusWrite } from '@/lib/orders/statusNormalizer';

// Validate before attempting update
try {
  validateStatusWrite(targetStatus);
  await updateOrderStatus(orderId, targetStatus, 'user', userId);
} catch (error) {
  console.error('Invalid status:', error.message);
  // Show error to user
}
```

## Testing

### Testing with Minimal Statuses

```typescript
import { normalizeStatus } from '@/lib/orders/statusNormalizer';

describe('Order Flow', () => {
  it('should transition from open to accepted', async () => {
    const order = await createOrder({...});
    expect(normalizeStatus(order.status)).toBe('open');

    await updateOrderStatus(order.id, 'accepted', 'merchant', merchantId);

    const updated = await getOrderById(order.id);
    expect(normalizeStatus(updated.status)).toBe('accepted');
  });

  it('should normalize legacy statuses', () => {
    expect(normalizeStatus('pending')).toBe('open');
    expect(normalizeStatus('escrow_pending')).toBe('accepted');
    expect(normalizeStatus('payment_pending')).toBe('escrowed');
    expect(normalizeStatus('payment_confirmed')).toBe('payment_sent');
    expect(normalizeStatus('releasing')).toBe('completed');
  });
});
```

## Best Practices

### DO ✅

- Use `minimal_status` for all new UI code
- Use canonical statuses for DB writes (`pending`, `accepted`, `escrowed`, `payment_sent`, `completed`)
- Validate status transitions before updating
- Use `expandStatus()` for queries that need to match multiple DB statuses
- Handle both `status` and `minimal_status` for backwards compatibility

### DON'T ❌

- Don't write transient statuses (`escrow_pending`, `payment_pending`, `payment_confirmed`, `releasing`)
- Don't rely on `status` field for new code (use `minimal_status`)
- Don't check multiple DB statuses when you can use one minimal status
- Don't forget to normalize status in API responses

## Summary

The 8-state minimal system provides:
- **Simpler API**: 8 statuses instead of 12
- **Cleaner code**: No more checking multiple statuses
- **Backwards compatible**: Both `status` and `minimal_status` in responses
- **Future-proof**: Easy to deprecate legacy statuses

Use `minimal_status` for all new code and enjoy the simpler, cleaner API!
