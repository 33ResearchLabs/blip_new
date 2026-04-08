/**
 * Standalone entry point for the shadow WebSocket server.
 *
 * Run with:
 *   npx tsx scripts/run-ws-shadow.ts
 *
 * Env:
 *   WS_SHADOW_PORT       (default 4001)
 *   WS_SHADOW_JWT_SECRET (fallback verifier; production uses sessionToken)
 */
import { startShadowServer } from '../src/realtime/wsServer';

(async () => {
  try {
    const server = await startShadowServer();
    const shutdown = async (sig: string) => {
      console.log(`[ws-shadow] received ${sig}, shutting down`);
      await server.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (err) {
    console.error('[ws-shadow] failed to start', err);
    process.exit(1);
  }
})();
