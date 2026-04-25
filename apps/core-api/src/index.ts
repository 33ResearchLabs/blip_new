// Load env FIRST — before any modules that read process.env at import time
// (e.g. settlement-core's MOCK_MODE constant)
import './loadEnv';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health';
import { orderRoutes } from './routes/orders';
import { orderCreateRoutes } from './routes/orderCreate';
import { escrowRoutes } from './routes/escrow';
import { extensionRoutes } from './routes/extension';
import { disputeRoutes } from './routes/dispute';
import { cancelRequestRoutes } from './routes/cancelRequest';
import { expireRoutes } from './routes/expire';
import { debugRoutes } from './routes/debug';
import { conversionRoutes } from './routes/conversion';
import { corridorRoutes } from './routes/corridor';
import { reputationRoutes } from './routes/reputation';
import { authHook } from './hooks/auth';
import { initWebSocketServer, closeWebSocketServer } from './ws/broadcast';
import { startOutboxWorker, stopOutboxWorker } from './workers/notificationOutbox';
import { startCorridorTimeoutWorker, stopCorridorTimeoutWorker } from './workers/corridorTimeoutWorker';
import { startAutoBumpWorker, stopAutoBumpWorker } from './workers/autoBumpWorker';
import { startPriceFeedWorker, stopPriceFeedWorker } from './workers/priceFeedWorker';
import { startUnhappyPathWorker, stopUnhappyPathWorker } from './workers/unhappyPathWorker';
import { startReceiptWorker, stopReceiptWorker } from './workers/receiptWorker';
import { startIdempotencyCleanupWorker, stopIdempotencyCleanupWorker } from './workers/idempotencyCleanupWorker';
import { startOutboxEventWorker, stopOutboxEventWorker } from './workers/outboxEventWorker';
import { closeReceiptQueue } from './queues/receiptQueue';
import { startReputationWorker, stopReputationWorker } from './workers/reputationWorker';
import {
  startReceiptReconciliationWorker,
  stopReceiptReconciliationWorker,
} from './workers/receiptReconciliationWorker';
import { registerAllListeners } from './events';
import { closePool, safeLog } from 'settlement-core';
import { runPendingMigrations } from './migrationRunner';
import { validateSchema } from './schemaValidator';

const PORT = parseInt(process.env.CORE_API_PORT || '4010', 10);
const HOST = process.env.CORE_API_HOST || '0.0.0.0';
const IS_WORKER = process.env.WORKER_ID !== undefined;

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'warn',
  },
});

// ── Centralized error tracking hooks ─────────────────────────────────
// Every unhandled exception from any route is captured via setErrorHandler.
// We then re-call reply.send(err) so Fastify's default response shape is
// preserved — we only observe, we do not alter responses.
fastify.setErrorHandler((err, request, reply) => {
  try {
    safeLog({
      type: `api.unhandled_exception${request.routerPath ? '.' + request.routerPath.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) : ''}`,
      severity: (reply.statusCode && reply.statusCode >= 500) || !reply.statusCode ? 'ERROR' : 'WARN',
      message: `Unhandled exception in ${request.method} ${request.url}: ${err.message}`,
      source: 'backend',
      metadata: {
        route: request.routerPath,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        errorName: err.name,
        stack: err.stack?.slice(0, 4000),
      },
    });
  } catch { /* swallow */ }
  // Fall through to Fastify's default handling
  reply.send(err);
});

// Process-level safety net: catches anything that escapes route/worker
// try/catch blocks (unhandled promise rejections, uncaught exceptions).
// Installed once per process.
if (!(globalThis as any).__coreApiGlobalsInstalled) {
  (globalThis as any).__coreApiGlobalsInstalled = true;
  process.on('unhandledRejection', (reason) => {
    try {
      const e = reason as { message?: string; stack?: string; name?: string };
      safeLog({
        type: 'process.unhandled_rejection',
        severity: 'ERROR',
        message: `[core-api] Unhandled promise rejection: ${e?.message || String(reason)}`,
        source: 'backend',
        metadata: { errorName: e?.name, stack: e?.stack?.slice(0, 4000) },
      });
    } catch { /* swallow */ }
  });
  process.on('uncaughtException', (err) => {
    // Skip client-aborted HTTP requests (normal browser behavior on
    // tab close / navigation). Node fires `aborted` from the socket
    // layer — not actionable.
    const stack = err.stack || '';
    const isClientAbort =
      err.message === 'aborted' &&
      (stack.includes('abortIncoming') || stack.includes('socketOnClose'));
    if (isClientAbort) return;

    try {
      safeLog({
        type: 'process.uncaught_exception',
        severity: 'CRITICAL',
        message: `[core-api] Uncaught exception: ${err.message}`,
        source: 'backend',
        metadata: { errorName: err.name, stack: err.stack?.slice(0, 4000) },
      });
    } catch { /* swallow */ }
    // Do NOT exit — let existing process handlers decide
  });
}

// Register CORS
await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
});

// Mitigate CVE-2025-fastify-content-type-bypass (fastify <5.7.2):
// Strip tab/newline chars from Content-Type before Fastify parses it.
fastify.addHook('onRequest', async (request) => {
  const ct = request.headers['content-type'];
  if (ct && /[\t\r\n]/.test(ct)) {
    request.headers['content-type'] = ct.replace(/[\t\r\n]/g, '');
  }
});

// Register event listeners (before routes so they're ready when first request arrives)
registerAllListeners();

// Register auth hook (before routes)
await fastify.register(authHook);

// Register routes
await fastify.register(healthRoutes);
await fastify.register(orderRoutes, { prefix: '/v1' });
await fastify.register(orderCreateRoutes, { prefix: '/v1' });
await fastify.register(escrowRoutes, { prefix: '/v1' });
await fastify.register(extensionRoutes, { prefix: '/v1' });
await fastify.register(disputeRoutes, { prefix: '/v1' });
await fastify.register(cancelRequestRoutes, { prefix: '/v1' });
await fastify.register(expireRoutes, { prefix: '/v1' });
await fastify.register(conversionRoutes, { prefix: '/v1' });
await fastify.register(corridorRoutes, { prefix: '/v1' });
await fastify.register(reputationRoutes, { prefix: '/v1' });
await fastify.register(debugRoutes);

// Pre-flight: log DB target, run migrations, validate schema
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  // Sanitize: show host/db only, mask credentials
  try {
    const u = new URL(dbUrl);
    console.log(`[startup] Connected DB: ${u.hostname}${u.pathname}`);
  } catch {
    console.log('[startup] Connected DB: (DATABASE_URL set, unable to parse)');
  }
} else {
  console.log(`[startup] Connected DB: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'settle'}`);
}

try {
  await runPendingMigrations();
  await validateSchema();
} catch (err) {
  console.error('[FATAL] Startup pre-flight failed:', err);
  process.exit(1);
}

// Start server
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Core API [${IS_WORKER ? 'worker ' + process.env.WORKER_ID : 'standalone'}] running on http://${HOST}:${PORT}`);

  // Only primary (non-worker) runs WS + background workers
  if (!IS_WORKER) {
    initWebSocketServer(fastify.server);
    startOutboxWorker();
    startCorridorTimeoutWorker();
    startAutoBumpWorker();
    startPriceFeedWorker();
    startUnhappyPathWorker();
    startIdempotencyCleanupWorker();
    startOutboxEventWorker();
    startReputationWorker();
    await startReceiptWorker();
    startReceiptReconciliationWorker();
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// Graceful shutdown
const shutdown = async (signal: string) => {
  if (!IS_WORKER) {
    stopOutboxWorker();
    stopCorridorTimeoutWorker();
    stopAutoBumpWorker();
    stopPriceFeedWorker();
    stopUnhappyPathWorker();
    stopIdempotencyCleanupWorker();
    stopOutboxEventWorker();
    stopReputationWorker();
    stopReceiptReconciliationWorker();
    await stopReceiptWorker();
    await closeReceiptQueue();
    closeWebSocketServer();
  }
  await fastify.close();
  await closePool();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
