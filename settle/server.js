const { createServer } = require('https');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0'; // Listen on all interfaces
const port = parseInt(process.env.PORT || '3001', 10); // Use 3001 for HTTPS to avoid conflict

// Load certificates
const certPath = path.join(__dirname, 'certificates');
const httpsOptions = {
  key: fs.readFileSync(path.join(certPath, 'localhost+3-key.pem')),
  cert: fs.readFileSync(path.join(certPath, 'localhost+3.pem')),
};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer(httpsOptions, async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  })
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, hostname, () => {
      console.log(`> Ready on https://localhost:${port}`);
      console.log(`> Also available on https://192.168.1.3:${port}`);
      console.log('');
      console.log('⚠️  If you see certificate warnings:');
      console.log('   Run: mkcert -install');
      console.log('   (requires sudo password)');
    });
});
