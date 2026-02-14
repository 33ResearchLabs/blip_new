/**
 * Order State Machine
 *
 * Defines all valid order statuses and allowed transitions.
 * This is the single source of truth for order state management.
 */
import { OrderStatus, ActorType } from '../types/index';
export declare const ORDER_STATUSES: readonly OrderStatus[];
export declare const GLOBAL_ORDER_TIMEOUT_MINUTES = 15;
export declare const STATUS_TIMEOUTS: Partial<Record<OrderStatus, number>>;
interface TransitionRule {
    to: OrderStatus;
    allowedActors: ActorType[];
}
export declare const ALLOWED_TRANSITIONS: Record<OrderStatus, TransitionRule[]>;
export declare const TERMINAL_STATUSES: readonly OrderStatus[];
export declare const RESTORE_LIQUIDITY_ON_EXIT: readonly OrderStatus[];
export declare const ACTIVE_STATUSES: readonly OrderStatus[];
export interface TransitionValidation {
    valid: boolean;
    error?: string;
}
/**
 * Validate if a status transition is allowed
 */
export declare function validateTransition(currentStatus: OrderStatus, newStatus: OrderStatus, actorType: ActorType): TransitionValidation;
/**
 * Check if a status is terminal (no further transitions possible)
 */
export declare function isTerminalStatus(status: OrderStatus): boolean;
/**
 * Check if an order is active (not in terminal state)
 */
export declare function isActiveStatus(status: OrderStatus): boolean;
/**
 * Get timeout for a status in milliseconds
 */
export declare function getStatusTimeout(status: OrderStatus): number | null;
/**
 * Check if liquidity should be restored when transitioning from a status
 */
export declare function shouldRestoreLiquidity(fromStatus: OrderStatus, toStatus: OrderStatus): boolean;
/**
 * Get the event type string for a transition
 */
export declare function getTransitionEventType(fromStatus: OrderStatus, toStatus: OrderStatus): string;
/**
 * Get the timestamp field to update for a given status
 */
export declare function getTimestampField(status: OrderStatus): string | null;
/**
 * Get next expiry interval for a given status
 * Note: Global 15-minute timeout - expires_at is set at creation and doesn't change
 */
export declare function getNextExpiryInterval(status: OrderStatus): string | null;
export declare const MAX_EXTENSIONS = 3;
export declare const EXTENSION_DURATIONS: Partial<Record<OrderStatus, number>>;
export declare const EXTENDABLE_STATUSES: readonly OrderStatus[];
/**
 * Check if a status allows extension requests
 */
export declare function canRequestExtension(status: OrderStatus): boolean;
/**
 * Check if an order can be extended (has remaining extensions)
 */
export declare function canExtendOrder(status: OrderStatus, currentExtensionCount: number, maxExtensions?: number): {
    canExtend: boolean;
    reason?: string;
};
/**
 * Get extension duration for a status in minutes
 */
export declare function getExtensionDuration(status: OrderStatus): number;
/**
 * Determine what happens when an order expires without extension
 * - If max extensions reached -> disputed
 * - If extension declined -> cancelled
 * - If no response -> cancelled
 */
export declare function getExpiryOutcome(status: OrderStatus, extensionCount: number, maxExtensions?: number): 'disputed' | 'cancelled';
export {};
//# sourceMappingURL=stateMachine.d.ts.map