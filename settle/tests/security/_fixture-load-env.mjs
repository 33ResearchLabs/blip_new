// Test fixture: import settle/src/lib/env.ts via tsx so the boot-time
// guards execute in a fresh process. The harness in
// mockModeProductionGuard.test.ts spawns `node` against this file with
// the env vars under test. We use tsx programmatically because env.ts
// is TypeScript and may use TS-only constructs.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('tsx/esm', pathToFileURL('./'));

const target = process.env._ENV_TS_PATH;
if (!target) {
  console.error('fixture: _ENV_TS_PATH not set');
  process.exit(2);
}

await import(pathToFileURL(target).href);
console.log('fixture: env.ts loaded without crashing');
