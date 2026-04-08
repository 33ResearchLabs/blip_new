/**
 * End-to-end smoke test for the shadow WebSocket server.
 *
 * Usage:
 *   WS_SHADOW_JWT_SECRET=devsecret npx tsx scripts/ws-shadow-smoke.ts
 *
 * What it does:
 *   1. Starts the shadow server on an ephemeral port
 *   2. Connects two clients (user:alice, user:bob) with fallback-secret tokens
 *   3. Both join order:test
 *   4. Alice emits TYPING → Bob must receive it
 *   5. Exits 0 on success, 1 on failure
 */
import WebSocket from 'ws';
import { startShadowServer } from '../src/realtime/wsServer';
import { mintShadowToken } from '../src/realtime/wsAuth';

async function main() {
  if (!process.env.WS_SHADOW_JWT_SECRET) {
    process.env.WS_SHADOW_JWT_SECRET = 'smoke-secret';
  }

  // Use a random high port to avoid collisions
  const port = 4000 + Math.floor(Math.random() * 900) + 50;
  const server = await startShadowServer(port);

  const tokA = mintShadowToken('user', 'alice');
  const tokB = mintShadowToken('user', 'bob');
  const base = `ws://127.0.0.1:${port}`;

  const open = (token: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${base}/?token=${encodeURIComponent(token)}`);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });

  const waitMsg = (ws: WebSocket, match: (m: any) => boolean, ms = 2000) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timeout waiting for message')),
        ms
      );
      const handler = (raw: WebSocket.RawData) => {
        try {
          const parsed = JSON.parse(raw.toString());
          if (match(parsed)) {
            clearTimeout(timer);
            ws.off('message', handler);
            resolve(parsed);
          }
        } catch {
          /* ignore */
        }
      };
      ws.on('message', handler);
    });

  let ok = false;
  try {
    const alice = await open(tokA);
    const bob = await open(tokB);

    alice.send(JSON.stringify({ type: 'JOIN_ORDER', orderId: 'test' }));
    bob.send(JSON.stringify({ type: 'JOIN_ORDER', orderId: 'test' }));

    await waitMsg(alice, (m) => m.type === 'JOINED');
    await waitMsg(bob, (m) => m.type === 'JOINED');

    const received = waitMsg(
      bob,
      (m) => m.type === 'TYPING' && m.room === 'order:test'
    );
    alice.send(JSON.stringify({ type: 'TYPING', orderId: 'test' }));
    const evt = await received;

    if (evt?.data?.actorId === 'alice') {
      console.log('[smoke] PASS: bob received TYPING from alice');
      ok = true;
    } else {
      console.error('[smoke] FAIL: wrong payload', evt);
    }

    alice.close();
    bob.close();
  } catch (err) {
    console.error('[smoke] FAIL:', err);
  } finally {
    await server.close();
  }

  process.exit(ok ? 0 : 1);
}

void main();
