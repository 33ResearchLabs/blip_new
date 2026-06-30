const { createServer: createHttpsServer } = require('https');
const { createServer: createHttpServer } = require('http');
const next = require('next');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { handleConnection, startHeartbeat, broadcastToOrder } = require('./websocket-server');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '4545', 10);

// ── Production security env-var gate ───────────────────────────────────
// Refuses to boot if any of NODE_ENV / LOGIN_NONCE_REQUIRED /
// WALLET_OWNERSHIP_STRICT is missing or wrong. In dev (NODE_ENV !=
// 'production') this only warns — set the vars to silence the warning.
//
// Defense-in-depth: the runtime code paths that USED to branch on these
// flags have had their lax modes removed, but this gate ensures any
// future regression that reintroduces a `=== 'false'` check still cannot
// reach production.
//
// Operator escape hatch: SKIP_PRODUCTION_ENV_CHECK=true (logs loudly).
{
  const { assertProductionSecurityEnv } = require('./src/lib/security/productionEnvGuard.js');
  try {
    assertProductionSecurityEnv({ mode: dev ? 'warn' : 'enforce' });
  } catch (err) {
    // The assertion already logged the structured summary. Exit non-zero
    // so Railway/Docker restart loops surface the failure rather than
    // silently proceed (a swallowed startup error would let the server
    // stay alive in a half-configured state).
    console.error('[security][startup] Server boot aborted.');
    process.exit(1);
  }
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Track readiness — server starts BEFORE Next.js finishes preparing
let isReady = false;

const requestHandler = async (req, res) => {
  try {
    // Fast healthcheck — always responds, even before Next.js is ready
    if (req.url === '/api/health' || req.url === '/api/health/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ready: isReady, timestamp: new Date().toISOString() }));
      return;
    }

    // If Next.js isn't ready yet, return 503
    if (!isReady) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server starting up, please wait...' }));
      return;
    }

    await handle(req, res);
  } catch (err) {
    console.error('Error occurred handling', req.url, err);
    res.statusCode = 500;
    res.end('internal server error');
  }
};

// Start HTTP server IMMEDIATELY so Railway healthcheck can connect
let server;
let useHttps = false;

try {
  const httpsOptions = {
    key: fs.readFileSync('./localhost+3-key.pem'),
    cert: fs.readFileSync('./localhost+3.pem'),
  };
  server = createHttpsServer(httpsOptions, requestHandler);
  useHttps = true;
  console.log('> Using HTTPS (local certificates found)');
} catch (err) {
  server = createHttpServer(requestHandler);
  console.log('> Using HTTP (no local certs - SSL handled by proxy)');
}

// Create WebSocket server attached to HTTP/HTTPS server.
//
// `handleProtocols` is required for ticket-based auth: the browser sends
// `Sec-WebSocket-Protocol: bearer, <ticket>` and the server MUST echo a
// chosen subprotocol back (RFC 6455). If we don't echo "bearer", browsers
// fail the handshake with a subprotocol mismatch. We never echo the ticket
// itself — only the literal `bearer` marker — so the credential never
// appears in the response headers (where intermediaries might log it).
const wss = new WebSocketServer({
  server,
  path: '/ws/chat',
  handleProtocols: (protocols /*, request */) => {
    // `protocols` is a Set in ws v8+. Accept the connection only if the
    // client offered our marker; the actual ticket lives at the next
    // position in the offered list and is consumed in handleConnection.
    if (protocols && typeof protocols.has === 'function' && protocols.has('bearer')) {
      return 'bearer';
    }
    return false;
  },
});

wss.on('connection', (ws, request) => {
  handleConnection(ws, request, wss);
});

startHeartbeat(wss, 30000);
global.__wsBroadcastToOrder = broadcastToOrder;
console.log('> WebSocket server initialized at /ws/chat');

const protocol = useHttps ? 'https' : 'http';
const wsProtocol = useHttps ? 'wss' : 'ws';

server
  .once('error', (err) => {
    console.error(err);
    process.exit(1);
  })
  .listen(port, () => {
    console.log(`> Listening on ${protocol}://${hostname}:${port} (waiting for Next.js...)`);
    console.log(`> WebSocket available at ${wsProtocol}://${hostname}:${port}/ws/chat`);
  });

// Graceful shutdown — close pool + server on SIGTERM/SIGINT
function gracefulShutdown(signal) {
  console.log(`> ${signal} received — shutting down gracefully...`);
  isReady = false; // Stop accepting new requests

  // Close WebSocket connections
  wss.clients.forEach((client) => client.terminate());

  server.close(() => {
    console.log('> HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.error('> Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Prepare Next.js in the background
app.prepare().then(async () => {
  // Validate DB connectivity before marking ready
  try {
    const { Pool } = require('pg');
    // 20s handshake timeout — Railway's proxy can take 5-15s during
    // platform warm-up. Falls back to DB_CONNECTION_TIMEOUT_MS if set.
    const startupConnectTimeout = parseInt(
      process.env.DB_CONNECTION_TIMEOUT_MS || '20000',
      10,
    );
    const testPool = process.env.DATABASE_URL
      ? new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: startupConnectTimeout,
        })
      : new Pool({
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          database: process.env.DB_NAME || 'settle',
          user: process.env.DB_USER || 'zeus',
          password: process.env.DB_PASSWORD || '',
          connectionTimeoutMillis: startupConnectTimeout,
        });
    await testPool.query('SELECT 1');
    await testPool.end();
    console.log('> Database connection verified');
  } catch (dbErr) {
    console.error('> WARNING: Database connection failed:', dbErr.message);
    if (process.env.NODE_ENV === 'production') {
      console.error('> FATAL: Cannot start without database in production');
      process.exit(1);
    }
  }

  isReady = true;
  console.log(`> Next.js ready — accepting requests`);

  // Start metrics reporter (logs every 60s)
  try {
    const { startMetricsReporter } = require('./src/lib/monitoring');
    startMetricsReporter();
  } catch (metricsErr) {
    console.warn('> Metrics reporter not available:', metricsErr.message);
  }

  // Background workers. When WORKERS_VIA_PM2=true they run as dedicated PM2
  // apps (ecosystem.config.cjs) with autorestart, so server.js must NOT also
  // spawn them here — otherwise every worker runs twice. Flip the env var to
  // cut over to PM2 supervision; unset it to roll back to in-server spawning.
  if (process.env.WORKERS_VIA_PM2 === 'true') {
    console.log('> Workers managed by PM2 (WORKERS_VIA_PM2=true) — server.js will not spawn them');
  } else {

  // Start notification outbox worker
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const workerScript = path.join(__dirname, 'src/workers/notificationOutbox.ts');
    const outboxWorker = spawn(npxBin, ['tsx', workerScript], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: __dirname,
    });
    outboxWorker.on('exit', (code) => {
      if (code !== 0) console.error(`> Outbox worker exited with code ${code}`);
    });
    console.log('> Notification outbox worker started (pid:', outboxWorker.pid + ')');
  } catch (outboxErr) {
    console.warn('> Notification outbox worker not available:', outboxErr.message);
  }

  // Start price tick collector worker (fetches USDT prices every 25s)
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const priceScript = path.join(__dirname, 'src/workers/price-tick-collector.ts');
    const priceWorker = spawn(npxBin, ['tsx', priceScript], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: __dirname,
    });
    priceWorker.on('exit', (code) => {
      if (code !== 0) console.error(`> Price tick worker exited with code ${code}`);
    });
    console.log('> Price tick collector started (pid:', priceWorker.pid + ')');
  } catch (priceErr) {
    console.warn('> Price tick collector not available:', priceErr.message);
  }

  // Start payment-deadline worker — handles pending/escrowed/disputed/payment_sent
  // expiries and stuck on-chain escrow refunds. Without this worker, escrowed
  // orders never auto-cancel-and-refund, leaving user funds locked indefinitely.
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const deadlineScript = path.join(__dirname, 'src/workers/payment-deadline-worker.ts');
    const deadlineWorker = spawn(npxBin, ['tsx', deadlineScript], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: __dirname,
    });
    deadlineWorker.on('exit', (code) => {
      if (code !== 0) console.error(`> Payment-deadline worker exited with code ${code}`);
    });
    console.log('> Payment-deadline worker started (pid:', deadlineWorker.pid + ')');
  } catch (deadlineErr) {
    console.warn('> Payment-deadline worker not available:', deadlineErr.message);
  }

  // Start escrow-reconciler — closes the on-chain ↔ DB orphan window. Reads
  // pending_escrow rows registered by /api/orders/:id/escrow/intent and
  // reflects on-chain reality into the orders table. Without this worker,
  // any escrow lock where the client tab dies / Solana indexes slowly /
  // network drops between sign and PATCH leaves funds locked on-chain
  // with no DB record. CLAUDE.md flag: this worker is the durability
  // anchor between Solana and Postgres.
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const reconcilerScript = path.join(__dirname, 'src/workers/escrow-reconciler.ts');
    const reconcilerWorker = spawn(npxBin, ['tsx', reconcilerScript], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: __dirname,
    });
    reconcilerWorker.on('exit', (code) => {
      if (code !== 0) console.error(`> Escrow reconciler worker exited with code ${code}`);
    });
    console.log('> Escrow reconciler started (pid:', reconcilerWorker.pid + ')');
  } catch (reconcilerErr) {
    console.warn('> Escrow reconciler not available:', reconcilerErr.message);
  }

  // Start dispute-reconciler — completes DB finalization for disputes that
  // already settled on-chain (Released/Refunded) but whose finalize never
  // committed (blockchain-success + DB-failure window). This is the recovery
  // safety net that MUST run before the backend arbiter is enabled. Gated by
  // DISPUTE_RECONCILER_ENABLED (default off) so it stays inert until turned on.
  if ((process.env.DISPUTE_RECONCILER_ENABLED || '').toLowerCase() === 'true') {
    try {
      const { spawn } = require('child_process');
      const path = require('path');
      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const disputeReconcilerScript = path.join(__dirname, 'src/workers/disputeReconciler.ts');
      const disputeReconcilerWorker = spawn(npxBin, ['tsx', disputeReconcilerScript], {
        stdio: 'inherit',
        env: { ...process.env },
        cwd: __dirname,
      });
      disputeReconcilerWorker.on('exit', (code) => {
        if (code !== 0) console.error(`> Dispute reconciler worker exited with code ${code}`);
      });
      console.log('> Dispute reconciler started (pid:', disputeReconcilerWorker.pid + ')');
    } catch (disputeReconcilerErr) {
      console.warn('> Dispute reconciler not available:', disputeReconcilerErr.message);
    }
  }

  // Start anomaly-sweeper — observability-only background process that scans
  // for silent business-invariant violations (stuck orders, balance drift,
  // undelivered chats, escrow mismatches) and writes them to error_logs.
  // Purely read-only; never modifies any row. Gated by ENABLE_ERROR_TRACKING.
  if ((process.env.ENABLE_ERROR_TRACKING || '').toLowerCase() === 'true'
      && (process.env.ENABLE_ANOMALY_SWEEPER || '').toLowerCase() !== 'false') {
    try {
      const { spawn } = require('child_process');
      const path = require('path');
      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const sweeperScript = path.join(__dirname, 'src/workers/anomaly-sweeper.ts');
      const sweeper = spawn(npxBin, ['tsx', sweeperScript], {
        stdio: 'inherit',
        env: { ...process.env },
        cwd: __dirname,
      });
      sweeper.on('exit', (code) => {
        if (code !== 0) console.error(`> Anomaly sweeper exited with code ${code}`);
      });
      console.log('> Anomaly sweeper started (pid:', sweeper.pid + ')');
    } catch (sweeperErr) {
      console.warn('> Anomaly sweeper not available:', sweeperErr.message);
    }
  } else {
    console.log('> Anomaly sweeper skipped (ENABLE_ERROR_TRACKING not true)');
  }

  // Start reputation worker — SOLE writer of the display tables
  // `reputation_scores` / `reputation_history` (CIBIL 300–900). Without it
  // running, those rows go stale (core-api no longer writes them) and the
  // leaderboard drifts from the in-app score. Full back-fill on boot, fast
  // refresh on a tight cadence, daily maintenance. See
  // src/workers/reputation-worker.ts.
  //
  // This runs under `node server.js` (Railway/Docker production). Under
  // `next dev` (start-all.sh) server.js isn't executed — the worker is
  // started in-process by the instrumentation hook instead.
  try {
    const { spawn } = require('child_process');
    const path = require('path');
    const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const reputationScript = path.join(__dirname, 'src/workers/reputation-worker.ts');
    const reputationWorker = spawn(npxBin, ['tsx', reputationScript], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: __dirname,
    });
    reputationWorker.on('exit', (code) => {
      if (code !== 0) console.error(`> Reputation worker exited with code ${code}`);
    });
    console.log('> Reputation worker started (pid:', reputationWorker.pid + ')');
  } catch (reputationErr) {
    console.warn('> Reputation worker not available:', reputationErr.message);
  }

  } // end: server.js spawns workers only when WORKERS_VIA_PM2 !== 'true'
});
