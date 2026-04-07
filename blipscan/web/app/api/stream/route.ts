import { NextRequest } from 'next/server';
import { Client } from 'pg';

export const dynamic = 'force-dynamic';

function createClient() {
  return process.env.DATABASE_URL
    ? new Client({ connectionString: process.env.DATABASE_URL })
    : new Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'blipscan',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
      });
}

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const client = createClient();

      const sendEvent = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream closed
        }
      };

      // Send heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        sendEvent(JSON.stringify({ type: 'heartbeat', time: new Date().toISOString() }));
      }, 30000);

      try {
        await client.connect();
        await client.query('LISTEN trade_updates');

        // Send initial connected event
        sendEvent(JSON.stringify({ type: 'connected' }));

        client.on('notification', (msg) => {
          if (msg.channel === 'trade_updates' && msg.payload) {
            try {
              const data = JSON.parse(msg.payload);
              sendEvent(JSON.stringify({ type: 'trade_update', data }));
            } catch {
              // Invalid payload
            }
          }
        });

        client.on('error', () => {
          clearInterval(heartbeat);
          try { controller.close(); } catch {}
        });

        // Clean up when client disconnects
        request.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          client.query('UNLISTEN trade_updates').catch(() => {});
          client.end().catch(() => {});
          try { controller.close(); } catch {}
        });
      } catch (error) {
        clearInterval(heartbeat);
        sendEvent(JSON.stringify({ type: 'error', message: 'Failed to connect' }));
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
