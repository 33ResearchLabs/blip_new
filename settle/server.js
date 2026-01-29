const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { handleConnection, startHeartbeat } = require('./websocket-server');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const httpsOptions = {
  key: fs.readFileSync('./localhost+3-key.pem'),
  cert: fs.readFileSync('./localhost+3.pem'),
};

app.prepare().then(() => {
  const server = createServer(httpsOptions, async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Create WebSocket server attached to HTTPS server
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

  console.log('> WebSocket server initialized at /ws/chat');

  server
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on https://${hostname}:${port}`);
      console.log(`> WebSocket available at wss://${hostname}:${port}/ws/chat`);
    });
});
