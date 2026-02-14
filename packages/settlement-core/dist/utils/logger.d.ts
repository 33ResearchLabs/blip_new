/**
 * Structured Logger
 *
 * Provides consistent logging across the application.
 * In production, this could be connected to a logging service.
 */
interface LogContext {
    [key: string]: unknown;
}
export declare const logger: {
    debug: (message: string, context?: LogContext) => void;
    info: (message: string, context?: LogContext) => void;
    warn: (message: string, context?: LogContext) => void;
    error: (message: string, context?: LogContext, error?: Error) => void;
    order: {
        created: (orderId: string, userId: string, merchantId: string, amount: number) => void;
        statusChanged: (orderId: string, fromStatus: string, toStatus: string, actorType: string, actorId: string) => void;
        cancelled: (orderId: string, reason: string, actorType: string) => void;
        completed: (orderId: string, cryptoAmount: number, fiatAmount: number) => void;
        expired: (orderId: string) => void;
        error: (orderId: string, operation: string, error: Error) => void;
    };
    chat: {
        messageSent: (orderId: string, senderType: string, senderId: string) => void;
        messagesRead: (orderId: string, readerType: string) => void;
    };
    dispute: {
        raised: (orderId: string, disputeId: string, reason: string) => void;
        resolved: (disputeId: string, resolution: string, inFavorOf: string) => void;
    };
    auth: {
        walletConnected: (walletAddress: string, type: string, actorId: string) => void;
        unauthorized: (endpoint: string, reason: string) => void;
        forbidden: (endpoint: string, actorId: string, reason: string) => void;
    };
    api: {
        request: (method: string, path: string, actorId?: string) => void;
        error: (method: string, path: string, error: Error) => void;
    };
};
export {};
//# sourceMappingURL=logger.d.ts.map