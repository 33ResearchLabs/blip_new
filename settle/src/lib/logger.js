/**
 * Structured Logger
 *
 * Provides consistent logging across the application.
 * In production, this could be connected to a logging service.
 */
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
// Default to 'info' in production, 'debug' in development
const MIN_LOG_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';
function shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}
function formatEntry(entry) {
    if (process.env.NODE_ENV === 'production') {
        // JSON format for production (easier to parse)
        return JSON.stringify(entry);
    }
    // Pretty format for development
    const parts = [
        `[${entry.timestamp}]`,
        `[${entry.level.toUpperCase()}]`,
        entry.message,
    ];
    if (entry.context && Object.keys(entry.context).length > 0) {
        parts.push(JSON.stringify(entry.context, null, 2));
    }
    if (entry.error) {
        parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);
        if (entry.error.stack) {
            parts.push(`\n  Stack: ${entry.error.stack}`);
        }
    }
    return parts.join(' ');
}
function log(level, message, context, error) {
    if (!shouldLog(level))
        return;
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        context,
    };
    if (error) {
        entry.error = {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    const formatted = formatEntry(entry);
    switch (level) {
        case 'debug':
        case 'info':
            console.log(formatted);
            break;
        case 'warn':
            console.warn(formatted);
            break;
        case 'error':
            console.error(formatted);
            break;
    }
}
export const logger = {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context, error) => log('error', message, context, error),
    // Specialized loggers for common operations
    order: {
        created: (orderId, userId, merchantId, amount) => log('info', 'Order created', { orderId, userId, merchantId, amount }),
        statusChanged: (orderId, fromStatus, toStatus, actorType, actorId) => log('info', 'Order status changed', {
            orderId,
            fromStatus,
            toStatus,
            actorType,
            actorId,
        }),
        cancelled: (orderId, reason, actorType) => log('info', 'Order cancelled', { orderId, reason, actorType }),
        completed: (orderId, cryptoAmount, fiatAmount) => log('info', 'Order completed', { orderId, cryptoAmount, fiatAmount }),
        expired: (orderId) => log('info', 'Order expired', { orderId }),
        error: (orderId, operation, error) => log('error', `Order operation failed: ${operation}`, { orderId }, error),
    },
    chat: {
        messageSent: (orderId, senderType, senderId) => log('debug', 'Chat message sent', { orderId, senderType, senderId }),
        messagesRead: (orderId, readerType) => log('debug', 'Messages marked read', { orderId, readerType }),
    },
    dispute: {
        raised: (orderId, disputeId, reason) => log('warn', 'Dispute raised', { orderId, disputeId, reason }),
        resolved: (disputeId, resolution, inFavorOf) => log('info', 'Dispute resolved', { disputeId, resolution, inFavorOf }),
    },
    auth: {
        walletConnected: (walletAddress, type, actorId) => log('info', 'Wallet connected', { walletAddress, type, actorId }),
        unauthorized: (endpoint, reason) => log('warn', 'Unauthorized access attempt', { endpoint, reason }),
        forbidden: (endpoint, actorId, reason) => log('warn', 'Forbidden access attempt', { endpoint, actorId, reason }),
    },
    api: {
        request: (method, path, actorId) => log('debug', 'API request', { method, path, actorId }),
        error: (method, path, error) => log('error', 'API error', { method, path }, error),
    },
};
