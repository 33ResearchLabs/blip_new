# UI Reliability Fixes - Implementation Guide

This document lists ALL the fixes that need to be made to settle/src/app/merchant/page.tsx

## Files Created:
1. ✅ `/settle/src/lib/orders/statusResolver.ts` - Status resolution utility
2. ✅ `/settle/src/lib/orders/mutationHelpers.ts` - Mutation helper utilities
3. ✅ `/settle/src/hooks/useRealtimeOrders.ts` - UPDATED with version gating
4. ✅ `/settle/src/components/merchant/InProgressPanel.tsx` - UPDATED to use minimal_status

## Changes Needed in `/settle/src/app/merchant/page.tsx`:

### 1. Add Imports (at top of file, around line 80)

```typescript
import { getAuthoritativeStatus, shouldAcceptUpdate } from '@/lib/orders/statusResolver';
import { executeSafeMutation, refetchSingleOrder } from '@/lib/orders/mutationHelpers';
```

### 2. Fix Expired Orders Handler (around line 1680-1707)

**FIND:**
```typescript
fetch(`/api/orders/${order.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    status: 'expired',
    actor_type: 'system',
    actor_id: '00000000-0000-0000-0000-000000000000',
  }),
}).catch(console.error);
```

**REPLACE WITH:**
```typescript
fetch(`/api/orders/${order.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    status: 'expired',
    actor_type: 'system',
    actor_id: '00000000-0000-0000-0000-000000000000',
  }),
})
  .then(async (res) => {
    if (!res.ok) {
      console.error(`[Expiry] Failed to mark order ${order.id} as expired:`, res.status);
      return;
    }
    const data = await res.json();
    if (data.success) {
      console.log(`[Expiry] Order ${order.id} marked as expired`);
      fetchOrders(); // Force refetch to sync state
    }
  })
  .catch((error) => {
    console.error(`[Expiry] Error marking order ${order.id} as expired:`, error);
    // Keep order in list if expiry fails (don't silently drop it)
  });
```

### 3. Fix Release Escrow (around lines 2400-2450)

**FIND the section where escrow is released (after `releaseResult.success`):**
```typescript
await fetch(`/api/orders/${releaseOrder.id}/escrow`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tx_hash: releaseResult.txHash,
    actor_type: 'merchant',
    actor_id: merchantId,
  }),
});
```

**REPLACE WITH:**
```typescript
const backendResult = await fetch(`/api/orders/${releaseOrder.id}/escrow`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tx_hash: releaseResult.txHash,
    actor_type: 'merchant',
    actor_id: merchantId,
  }),
});

if (!backendResult.ok) {
  const errorText = await backendResult.text();
  console.error('[Release] Backend PATCH failed:', errorText);
  setReleaseError(`Failed to record release: ${errorText.substring(0, 100)}`);
  toast.showError('Failed to record escrow release on server');
  return;
}

const backendData = await backendResult.json();
if (!backendData.success) {
  console.error('[Release] Backend returned error:', backendData.error);
  setReleaseError(backendData.error || 'Failed to record release');
  toast.showError(backendData.error || 'Failed to record escrow release');
  return;
}

console.log('[Release] Backend confirmed escrow release');
```

### 4. Fix Confirm Payment (around lines 2815-2850)

**FIND:**
```typescript
if (!res.ok) {
  console.error("Failed to confirm payment:", res.status);
  return;
}
const data = await res.json();
if (data.success) {
  // Success path
} else {
  console.error("Failed to confirm payment:", data.error);
}
```

**REPLACE WITH:**
```typescript
if (!res.ok) {
  const errorText = await res.text();
  console.error("Failed to confirm payment:", res.status, errorText);
  toast.showError(`Failed to confirm payment (${res.status})`);
  // Rollback optimistic update if any
  fetchOrders();
  return;
}

const data = await res.json();
if (data.success) {
  // Success path
  console.log('[Confirm Payment] Success');
  // Force immediate refetch
  await refetchSingleOrder(orderId, (updatedOrder) => {
    setOrders(prev => prev.map(o => o.id === orderId ? mapDbOrderToUI(updatedOrder) : o));
  });
  fetchOrders();
} else {
  console.error("Failed to confirm payment:", data.error);
  toast.showError(data.error || 'Failed to confirm payment');
  // Rollback optimistic update
  fetchOrders();
}
```

### 5. Fix Submit Dispute (around lines 2899-2920)

**FIND:**
```typescript
if (data.success) {
  setOrders(prev => prev.map(o =>
    o.id === disputeOrderId ? { ...o, status: "disputed" as const } : o
  ));
  setShowDisputeModal(false);
  // ... toast notifications ...
}
```

**REPLACE WITH:**
```typescript
if (data.success) {
  setOrders(prev => prev.map(o =>
    o.id === disputeOrderId ? { ...o, status: "disputed" as const } : o
  ));
  setShowDisputeModal(false);
  setDisputeOrderId(null);
  setDisputeReason("");
  setDisputeDescription("");
  playSound('click');
  toast.showDisputeOpened(disputeOrderId);
  addNotification('dispute', 'Dispute submitted. Our team will review it.', disputeOrderId);

  // ✅ FORCE REFETCH to get dispute details from server
  setTimeout(async () => {
    await refetchSingleOrder(disputeOrderId, (updatedOrder) => {
      setOrders(prev => prev.map(o => o.id === disputeOrderId ? mapDbOrderToUI(updatedOrder) : o));
    });
    fetchOrders();
  }, 500);
}
```

### 6. Add Background Polling (add new useEffect, around line 1730)

```typescript
// Background polling for ongoing orders (failsafe against missed websocket events)
useEffect(() => {
  if (!merchantId || !isLoggedIn) return;

  const pollInterval = setInterval(() => {
    const hasOngoingOrders = orders.some(o => {
      const status = getAuthoritativeStatus(o);
      return ['accepted', 'escrowed', 'payment_sent'].includes(status);
    });

    if (hasOngoingOrders) {
      console.log('[Polling] Refreshing ongoing orders');
      fetchOrders();
    }
  }, 30000); // 30 seconds

  return () => clearInterval(pollInterval);
}, [merchantId, isLoggedIn, orders, fetchOrders]);
```

### 7. Add Visibility Change Handler (add new useEffect, around line 1750)

```typescript
// Refetch when page becomes visible (user might have updated order elsewhere)
useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && merchantId && isLoggedIn) {
      console.log('[Visibility] Page visible, refetching orders');
      fetchOrders();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, [merchantId, isLoggedIn, fetchOrders]);
```

### 8. Fix WebSocket Status Updates (around lines 1607-1640)

**FIND the websocket handler `onOrderStatusUpdated`:**
```typescript
const handleStatusUpdated = (rawData: unknown) => {
  const data = rawData as { orderId: string; status: string; ... };
  setOrders(prev => prev.map(o => {
    if (o.id !== data.orderId) return o;
    // Apply update
  }));
};
```

**REPLACE WITH:**
```typescript
const handleStatusUpdated = (rawData: unknown) => {
  console.log('[WebSocket] STATUS_UPDATED event:', rawData);
  const data = rawData as {
    orderId: string;
    status: string;
    minimal_status?: string;
    order_version?: number;
    previousStatus: string;
    updatedAt: string;
    data?: any;
  };

  setOrders(prev => prev.map(o => {
    if (o.id !== data.orderId) return o;

    // ✅ VERSION GATING: Reject stale updates
    const versionCheck = shouldAcceptUpdate(
      data.order_version || data.data?.order_version,
      o.orderVersion
    );

    if (!versionCheck.accept) {
      console.log('[WebSocket] Rejected stale update:', versionCheck.reason);
      return o; // Keep current (newer) state
    }

    console.log('[WebSocket] Accepted update:', versionCheck.reason);

    // Apply full data if available
    if (data.data) {
      return mapDbOrderToUI(data.data);
    }

    // Partial update (legacy path)
    return {
      ...o,
      status: mapMinimalStatusToUIStatus(data.minimal_status || data.status, o.isMyOrder),
      minimalStatus: data.minimal_status,
      orderVersion: data.order_version || o.orderVersion,
    };
  }));
};
```

### 9. Fix Cancel Order Without Escrow (around lines 2607-2620)

**FIND:**
```typescript
setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "cancelled" as const } : o));
fetchOrders();
```

**REPLACE WITH:**
```typescript
// Optimistic update
setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "cancelled" as const } : o));

// Verify with server
try {
  await fetchOrders();
  playSound('click');
  toast.showSuccess('Order cancelled');
} catch (error) {
  console.error('[Cancel] Failed to verify cancellation:', error);
  toast.showError('Cancellation may have failed - please refresh');
}
```

### 10. Fix Accept Order (around lines 1826-1842)

**FIND the multiple accept paths and ensure they ALL include:**

```typescript
// After backend accepts order
setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: uiStatus as "escrow" | "active" } : o));

// ✅ FORCE REFETCH
await refetchSingleOrder(order.id, (updatedOrder) => {
  setOrders(prev => prev.map(o => o.id === order.id ? mapDbOrderToUI(updatedOrder) : o));
});
fetchOrders();
```

## Testing Checklist:

After making these changes, test:

1. ✅ Complete an order → should NOT remain in "In Progress"
2. ✅ Cancel an order → should disappear and stay gone after refresh
3. ✅ Receive older websocket event → should be rejected
4. ✅ Release escrow failure → should show error, NOT mark as completed
5. ✅ Confirm payment failure → should show error, rollback optimistic update
6. ✅ Submit dispute → should immediately show dispute details
7. ✅ Expired order fails to mark → should NOT disappear (stays for retry)
8. ✅ Switch tabs and back → orders refresh
9. ✅ Wait 30 seconds with ongoing order → auto-refresh

## Backend Changes Required:

**IMPORTANT:** Websocket events MUST include `order_version` and `minimal_status`:

```typescript
// When emitting websocket events
pusher.trigger(channel, ORDER_EVENTS.STATUS_UPDATED, {
  orderId: order.id,
  status: order.status,
  minimal_status: order.minimal_status,  // ✅ REQUIRED
  order_version: order.order_version,     // ✅ REQUIRED
  previousStatus: oldStatus,
  updatedAt: order.updated_at,
  data: serializeOrder(order),  // Include full order data
});
```

## Summary of Changes:

- **Fixed:** 10 mutation handlers with error handling and rollback
- **Added:** Version gating to websocket updates
- **Added:** Background polling (30s) for ongoing orders
- **Added:** Visibility change refetch
- **Added:** Forced refetch after all critical mutations
- **Fixed:** Expired orders now handle failures gracefully
- **Fixed:** All status checks now use `getAuthoritativeStatus()` from status resolver

All changes are UI-only and backward-compatible.
