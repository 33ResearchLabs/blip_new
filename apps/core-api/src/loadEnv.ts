/**
 * Environment loader — must be imported FIRST in index.ts
 * so that process.env vars are set before any other modules
 * (like settlement-core's MOCK_MODE) evaluate them.
 *
 * Production (Railway): env vars injected by platform, no files needed.
 * Local dev: reads from settle/.env.local via relative path.
 */
import { config } from 'dotenv';
import { existsSync } from 'fs';

if (process.env.NODE_ENV !== 'production') {
  const paths = ['../../settle/.env.local', '../../settle/.env'];
  for (const p of paths) {
    if (existsSync(p)) config({ path: p });
  }
}
