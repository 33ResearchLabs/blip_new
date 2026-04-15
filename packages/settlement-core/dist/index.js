/**
 * Settlement Core - Shared order settlement logic
 *
 * This package contains the core business logic for order settlement,
 * shared between the Next.js app and Fastify core-api.
 */
// DB
export * from './db/client';
// State Machine
export * from './state-machine/stateMachine';
export * from './state-machine/normalizer';
// Finalization
export * from './finalization/atomicCancel';
export * from './finalization/guards';
// Types
export * from './types/index';
// Config
export * from './config/mockMode';
// Utils
export * from './utils/logger';
// Error tracking (additive — feature-flagged via ENABLE_ERROR_TRACKING)
export * from './errorTracking/logger';
//# sourceMappingURL=index.js.map