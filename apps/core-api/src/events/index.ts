/**
 * Event system barrel — registers all listeners on the order event bus.
 * Call once at startup (index.ts).
 */
export { orderBus, ORDER_EVENT, type OrderEventPayload } from './orderEvents';
export type { OrderEventName } from './orderEvents';

import { registerReceiptListener } from './listeners/receiptListener';
import { registerNotificationListener } from './listeners/notificationListener';
import { registerBroadcastListener } from './listeners/broadcastListener';
import { registerAuditLogListener } from './listeners/auditLogListener';

let registered = false;

export function registerAllListeners(): void {
  if (registered) return;
  registered = true;

  registerReceiptListener();
  registerNotificationListener();
  registerBroadcastListener();
  registerAuditLogListener();
}
