/**
 * Structured Logger
 *
 * Provides consistent logging across the application.
 * In production, this could be connected to a logging service.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Default to 'info' in production, 'debug' in development
const MIN_LOG_LEVEL: LogLevel =
  process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LOG_LEVEL];
}

function formatEntry(entry: LogEntry): string {
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

function log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
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
  debug: (message: string, context?: LogContext) => log('debug', message, context),
  info: (message: string, context?: LogContext) => log('info', message, context),
  warn: (message: string, context?: LogContext) => log('warn', message, context),
  error: (message: string, context?: LogContext, error?: Error) =>
    log('error', message, context, error),

  // Specialized loggers for common operations
  order: {
    created: (orderId: string, userId: string, merchantId: string, amount: number) =>
      log('info', 'Order created', { orderId, userId, merchantId, amount }),

    statusChanged: (
      orderId: string,
      fromStatus: string,
      toStatus: string,
      actorType: string,
      actorId: string
    ) =>
      log('info', 'Order status changed', {
        orderId,
        fromStatus,
        toStatus,
        actorType,
        actorId,
      }),

    cancelled: (orderId: string, reason: string, actorType: string) =>
      log('info', 'Order cancelled', { orderId, reason, actorType }),

    completed: (orderId: string, cryptoAmount: number, fiatAmount: number) =>
      log('info', 'Order completed', { orderId, cryptoAmount, fiatAmount }),

    expired: (orderId: string) => log('info', 'Order expired', { orderId }),

    error: (orderId: string, operation: string, error: Error) =>
      log('error', `Order operation failed: ${operation}`, { orderId }, error),
  },

  chat: {
    messageSent: (orderId: string, senderType: string, senderId: string) =>
      log('debug', 'Chat message sent', { orderId, senderType, senderId }),

    messagesRead: (orderId: string, readerType: string) =>
      log('debug', 'Messages marked read', { orderId, readerType }),
  },

  dispute: {
    raised: (orderId: string, disputeId: string, reason: string) =>
      log('warn', 'Dispute raised', { orderId, disputeId, reason }),

    resolved: (disputeId: string, resolution: string, inFavorOf: string) =>
      log('info', 'Dispute resolved', { disputeId, resolution, inFavorOf }),
  },

  auth: {
    walletConnected: (walletAddress: string, type: string, actorId: string) =>
      log('info', 'Wallet connected', { walletAddress, type, actorId }),

    unauthorized: (endpoint: string, reason: string) =>
      log('warn', 'Unauthorized access attempt', { endpoint, reason }),

    forbidden: (endpoint: string, actorId: string, reason: string) =>
      log('warn', 'Forbidden access attempt', { endpoint, actorId, reason }),
  },

  api: {
    request: (method: string, path: string, actorId?: string) =>
      log('debug', 'API request', { method, path, actorId }),

    error: (method: string, path: string, error: Error) =>
      log('error', 'API error', { method, path }, error),
  },
};
