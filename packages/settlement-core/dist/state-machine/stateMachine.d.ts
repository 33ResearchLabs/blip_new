/**
 * @deprecated Use the minimal 8-status machine via normalizer.ts instead. This legacy 12-status machine is retained for reference only.
 */
import { OrderStatus, ActorType } from '../types/index';
/** @deprecated Use minimal state machine */
export declare const ORDER_STATUSES: readonly OrderStatus[];
export declare const GLOBAL_ORDER_TIMEOUT_MINUTES = 15;
export declare const STATUS_TIMEOUTS: Partial<Record<OrderStatus, number>>;
export declare const INACTIVITY_WARNING_MINUTES = 15;
export declare const INACTIVITY_ESCALATION_MINUTES = 60;
export declare const DISPUTE_AUTO_RESOLVE_HOURS = 24;
export declare const INACTIVITY_TRACKED_STATUSES: readonly OrderStatus[];
export declare const CANCEL_REQUEST_STATUSES: readonly OrderStatus[];
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
/** @deprecated Use normalizer.ts for minimal state machine */
export declare function validateTransition(currentStatus: OrderStatus, newStatus: OrderStatus, actorType: ActorType): TransitionValidation;
/** @deprecated */
export declare function isTerminalStatus(status: OrderStatus): boolean;
/** @deprecated */
export declare function isActiveStatus(status: OrderStatus): boolean;
/** @deprecated */
export declare function getStatusTimeout(status: OrderStatus): number | null;
/** @deprecated */
export declare function shouldRestoreLiquidity(fromStatus: OrderStatus, toStatus: OrderStatus): boolean;
/** @deprecated */
export declare function getTransitionEventType(fromStatus: OrderStatus, toStatus: OrderStatus): string;
/** @deprecated */
export declare function getTimestampField(status: OrderStatus): string | null;
/** @deprecated */
export declare function getNextExpiryInterval(status: OrderStatus): string | null;
export declare const MAX_EXTENSIONS = 3;
export declare const EXTENSION_DURATIONS: Partial<Record<OrderStatus, number>>;
export declare const EXTENDABLE_STATUSES: readonly OrderStatus[];
/** @deprecated */
export declare function canRequestExtension(status: OrderStatus): boolean;
/** @deprecated */
export declare function canExtendOrder(status: OrderStatus, currentExtensionCount: number, maxExtensions?: number): {
    canExtend: boolean;
    reason?: string;
};
/** @deprecated */
export declare function getExtensionDuration(status: OrderStatus): number;
/** @deprecated */
export declare function getExpiryOutcome(status: OrderStatus, extensionCount: number, maxExtensions?: number): 'disputed' | 'cancelled';
/** @deprecated */
export declare function canRequestCancel(status: OrderStatus): boolean;
/** @deprecated */
export declare function canUnilateralCancel(status: OrderStatus): boolean;
/** @deprecated */
export declare function isInactivityTracked(status: OrderStatus): boolean;
/** @deprecated */
export declare function getInactivityOutcome(status: OrderStatus, hasEscrow: boolean): 'disputed' | 'cancelled';
export {};
//# sourceMappingURL=stateMachine.d.ts.map