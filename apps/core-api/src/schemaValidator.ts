/**
 * Startup schema validation.
 * Fails fast if required columns are missing from the database,
 * preventing runtime 500 errors from schema mismatches.
 */

import { query } from 'settlement-core';

/** Columns that MUST exist for the application to function correctly. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  orders: ['payment_deadline', 'requires_payment_proof'],
};

/**
 * Validates that all required columns exist in the database schema.
 * Throws and exits the process if any are missing.
 */
export async function validateSchema(): Promise<void> {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const rows = await query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = $1
         AND column_name = ANY($2)`,
      [table, columns]
    );

    const foundColumns = new Set(rows.map((r) => r.column_name));
    const missing = columns.filter((c) => !foundColumns.has(c));

    if (missing.length > 0) {
      const msg = `DB schema mismatch: table "${table}" is missing required columns: ${missing.join(', ')}. Run pending migrations before starting the application.`;
      console.error(`[FATAL] ${msg}`);
      throw new Error(msg);
    }
  }

  console.log('[schema-validator] All required columns verified.');
}
