const { createServer: createHttpsServer } = require('https');
const { createServer: createHttpServer } = require('http');
const next = require('next');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { handleConnection, startHeartbeat, broadcastToOrder } = require('./websocket-server');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

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

// Create WebSocket server attached to HTTP/HTTPS server
const wss = new WebSocketServer({
  server,
  path: '/ws/chat'
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
    const testPool = process.env.DATABASE_URL
      ? new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
          connectionTimeoutMillis: 5000,
        })
      : new Pool({
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          database: process.env.DB_NAME || 'settle',
          user: process.env.DB_USER || 'zeus',
          password: process.env.DB_PASSWORD || '',
          connectionTimeoutMillis: 5000,
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
});
