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

app.prepare().then(() => {
  let server;
  let useHttps = false;

  const requestHandler = async (req, res) => {
    try {
      // Fast healthcheck bypass — responds instantly without touching Next.js
      if (req.url === '/api/health' || req.url === '/api/health/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
        return;
      }
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  };

  // Try HTTPS with local certificates (works in both dev and production)
  try {
    const httpsOptions = {
      key: fs.readFileSync('./localhost+3-key.pem'),
      cert: fs.readFileSync('./localhost+3.pem'),
    };
    server = createHttpsServer(httpsOptions, requestHandler);
    useHttps = true;
    console.log('> Using HTTPS (local certificates found)');
  } catch (err) {
    // No local certs - use HTTP (production/Railway with SSL termination)
    server = createHttpServer(requestHandler);
    console.log('> Using HTTP (no local certs - SSL handled by proxy)');
  }

  // Create WebSocket server attached to HTTP/HTTPS server
  const wss = new WebSocketServer({
    server,
    path: '/ws/chat'
  });

  // Handle WebSocket connections
  wss.on('connection', (ws, request) => {
    handleConnection(ws, request, wss);
  });

  // Start heartbeat to clean up stale connections
  startHeartbeat(wss, 30000);

  // Expose WS broadcast globally so API routes can push order events
  global.__wsBroadcastToOrder = broadcastToOrder;

  console.log('> WebSocket server initialized at /ws/chat');

  // Start notification outbox worker as a child process (TypeScript, needs tsx)
  // Processes pending notifications from DB with retries (Pusher/WebSocket fallback)
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
    console.warn('> Notifications will rely on Pusher/WebSocket only (no retry)');
  }

  const protocol = useHttps ? 'https' : 'http';
  const wsProtocol = useHttps ? 'wss' : 'ws';

  server
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on ${protocol}://${hostname}:${port}`);
      console.log(`> WebSocket available at ${wsProtocol}://${hostname}:${port}/ws/chat`);
    });
});
