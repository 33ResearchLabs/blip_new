/**
 * DB Isolation Test
 *
 * Verifies that settle's order API routes do NOT import DB mutation functions.
 * All order mutations must go through proxyCoreApi to core-api.
 * Reads are allowed (GET handlers can query the DB directly).
 */
import * as fs from 'fs';
import * as path from 'path';

const SETTLE_API_DIR = path.resolve(__dirname, '../../src/app/api');

// Order mutation routes that must ONLY use proxyCoreApi for writes
const ORDER_MUTATION_ROUTES = [
  'orders/route.ts',
  'orders/[id]/route.ts',
  'merchant/orders/route.ts',
  'orders/[id]/escrow/route.ts',
  'orders/[id]/extension/route.ts',
  'orders/[id]/dispute/route.ts',
  'orders/[id]/dispute/confirm/route.ts',
  'orders/expire/route.ts',
];

// DB mutation functions that must NOT be imported in order routes
const BANNED_IMPORTS = [
  'createOrder',
  'updateOrderStatus',
  'cancelOrder',
  'atomicCancelWithRefund',
  'expireOldOrders',
  'verifyRefundInvariants',
  'verifyReleaseInvariants',
  'insertNotificationOutbox',
];

// Legacy proxy guard that should no longer exist
const BANNED_SYMBOLS = [
  'isCoreApiEnabled',
];

describe('DB Isolation: order mutation routes', () => {
  const routeFiles: { name: string; content: string }[] = [];

  beforeAll(() => {
    for (const route of ORDER_MUTATION_ROUTES) {
      const filePath = path.join(SETTLE_API_DIR, route);
      if (fs.existsSync(filePath)) {
        routeFiles.push({
          name: route,
          content: fs.readFileSync(filePath, 'utf-8'),
        });
      }
    }
  });

  test('all order mutation route files exist', () => {
    expect(routeFiles.length).toBe(ORDER_MUTATION_ROUTES.length);
  });

  test.each(BANNED_IMPORTS)(
    'no route imports banned mutation function: %s',
    (fn) => {
      for (const { name, content } of routeFiles) {
        expect(content).not.toMatch(
          new RegExp(`\\b${fn}\\b`),
        );
      }
    }
  );

  test.each(BANNED_SYMBOLS)(
    'no route references legacy symbol: %s',
    (symbol) => {
      for (const { name, content } of routeFiles) {
        expect(content).not.toMatch(
          new RegExp(`\\b${symbol}\\b`),
        );
      }
    }
  );

  test('proxy helper does not export isCoreApiEnabled', () => {
    const proxyPath = path.resolve(__dirname, '../../src/lib/proxy/coreApi.ts');
    const proxyContent = fs.readFileSync(proxyPath, 'utf-8');
    expect(proxyContent).not.toMatch(/export\s+function\s+isCoreApiEnabled/);
  });

  test('mutation routes import proxyCoreApi', () => {
    // These routes must import proxyCoreApi (they have mutation endpoints)
    const mustProxy = [
      'orders/route.ts',
      'orders/[id]/route.ts',
      'merchant/orders/route.ts',
      'orders/[id]/escrow/route.ts',
      'orders/[id]/extension/route.ts',
      'orders/[id]/dispute/route.ts',
      'orders/[id]/dispute/confirm/route.ts',
      'orders/expire/route.ts',
    ];

    for (const route of mustProxy) {
      const file = routeFiles.find(f => f.name === route);
      expect(file).toBeDefined();
      expect(file!.content).toMatch(/proxyCoreApi/);
    }
  });
});
