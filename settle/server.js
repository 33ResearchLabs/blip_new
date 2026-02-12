const { createServer: createHttpsServer } = require('https');
const { createServer: createHttpServer } = require('http');
const { parse } = require('url');
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

  if (dev) {
    // Development: HTTPS with local certificates
    try {
      const httpsOptions = {
        key: fs.readFileSync('./localhost+3-key.pem'),
        cert: fs.readFileSync('./localhost+3.pem'),
      };
      server = createHttpsServer(httpsOptions, async (req, res) => {
        try {
          const parsedUrl = parse(req.url, true);
          await handle(req, res, parsedUrl);
        } catch (err) {
          console.error('Error occurred handling', req.url, err);
          res.statusCode = 500;
          res.end('internal server error');
        }
      });
      console.log('> Using HTTPS (development mode with local certificates)');
    } catch (err) {
      console.warn('> Local HTTPS certs not found, falling back to HTTP');
      server = createHttpServer(async (req, res) => {
        try {
          const parsedUrl = parse(req.url, true);
          await handle(req, res, parsedUrl);
        } catch (err) {
          console.error('Error occurred handling', req.url, err);
          res.statusCode = 500;
          res.end('internal server error');
        }
      });
    }
  } else {
    // Production: HTTP (Railway/Vercel handles SSL termination)
    server = createHttpServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('Error occurred handling', req.url, err);
        res.statusCode = 500;
        res.end('internal server error');
      }
    });
    console.log('> Using HTTP (production - SSL handled by proxy)');
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

  const protocol = dev ? 'https' : 'http';
  const wsProtocol = dev ? 'wss' : 'ws';

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
