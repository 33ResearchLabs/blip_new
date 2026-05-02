/**
 * Dispute confirm/finalize — structural regression checks.
 *
 * Cheap, no-DB assertions that the confirm route preserves the locking
 * contract introduced to fix the double-credit race. These guard against
 * a future refactor accidentally reverting to non-transactional dbQuery
 * calls or dropping the FOR UPDATE row locks.
 *
 * Run: tsx apps/core-api/tests/disputeConfirmStructure.test.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROUTE_PATH = resolve(__dirname, '../src/routes/dispute.ts');

const src = readFileSync(ROUTE_PATH, 'utf8');

// Carve out just the confirm handler so we don't accidentally accept
// asserts that pass because of unrelated code in the create-dispute route.
const confirmStart = src.indexOf("'/orders/:id/dispute/confirm'");
assert(confirmStart > 0, 'confirm route declaration not found in dispute.ts');
const confirmBody = src.slice(confirmStart);

let passed = 0;
const check = (name: string, cond: boolean) => {
  assert(cond, `FAIL: ${name}`);
  console.log(`  ✓ ${name}`);
  passed++;
};

console.log('Dispute confirm — structural regression checks');

check(
  'wraps confirm flow in transaction(async (client) => …)',
  /transaction\(async\s*\(\s*client\s*\)/.test(confirmBody)
);

check(
  'locks orders row with FOR UPDATE',
  /FROM\s+orders[\s\S]{0,200}WHERE\s+id\s*=\s*\$1[\s\S]{0,80}FOR\s+UPDATE/i.test(
    confirmBody
  )
);

check(
  'locks disputes row with FOR UPDATE',
  /FROM\s+disputes[\s\S]{0,200}WHERE\s+order_id\s*=\s*\$1[\s\S]{0,80}FOR\s+UPDATE/i.test(
    confirmBody
  )
);

check(
  're-checks pending_confirmation status after acquiring lock',
  /dispute\.status\s*!==\s*['"]pending_confirmation['"]/.test(confirmBody)
);

check(
  'guards finalize-once via UPDATE…WHERE status = pending_confirmation',
  /UPDATE\s+disputes[\s\S]{0,300}status\s*=\s*['"]resolved['"][\s\S]{0,200}WHERE[\s\S]{0,200}status\s*=\s*['"]pending_confirmation['"]/i.test(
    confirmBody
  )
);

check(
  'preserves order_version optimistic-concurrency guard on resolve',
  /UPDATE\s+orders[\s\S]{0,300}order_version\s*=\s*\$3[\s\S]{0,200}status\s*=\s*['"]disputed['"]/i.test(
    confirmBody
  )
);

check(
  'enforces credited-equals-escrow invariant',
  /Math\.abs\(\s*credited\s*-\s*amount\s*\)/.test(confirmBody)
);

check(
  'uses transaction-aware insertOutboxEvent (not …Direct) on finalize',
  /insertOutboxEvent\(\s*client\s*,/.test(confirmBody) &&
    !/insertOutboxEventDirect\s*\(/.test(confirmBody)
);

check(
  'does not run any dbQuery() inside the confirm handler',
  !/dbQuery\s*\(/.test(confirmBody)
);

check(
  'emits structured finalize log with money and party context',
  /logger\.info\([^)]*Dispute finalized[\s\S]{0,400}escrowAmount/.test(
    confirmBody
  )
);

console.log(`\nPASS — ${passed} structural checks`);
