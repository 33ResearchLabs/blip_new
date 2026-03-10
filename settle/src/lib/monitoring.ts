export function captureError(error: unknown, context?: Record<string, unknown>) {
  console.error('[Error]', error, context);
  try {
    const Sentry = require('@sentry/nextjs');
    Sentry.captureException(error, { extra: context });
  } catch {
    // Sentry not installed — console.error is sufficient
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  console.log(`[${level.toUpperCase()}]`, message);
  try {
    const Sentry = require('@sentry/nextjs');
    Sentry.captureMessage(message, level);
  } catch {
    // Sentry not installed
  }
}
