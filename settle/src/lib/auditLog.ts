/**
 * Security Audit Logger
 *
 * Provides structured audit logging for security-sensitive actions.
 * Every log entry includes: who, what, when, and on which resource.
 *
 * Persistence (zero-regression additive):
 *   - ALWAYS emits a structured `[AUDIT] {...}` line to stdout (existing behavior)
 *   - For order-scoped actions, ALSO fire-and-forget writes to the
 *     `financial_audit_log` table (migration 049) so the audit trail is
 *     queryable. DB write failures are swallowed — they never break the
 *     calling code or change the response.
 */

type AuditAction =
  | 'order.created'
  | 'order.status_changed'
  | 'order.cancelled'
  | 'escrow.locked'
  | 'escrow.released'
  | 'escrow.refunded'
  | 'compliance.dispute_accessed'
  | 'compliance.dispute_resolved'
  | 'compliance.dispute_status_changed'
  | 'compliance.access_granted'
  | 'compliance.access_revoked'
  | 'admin.login'
  | 'admin.privilege_change';

interface AuditEntry {
  timestamp: string;
  action: AuditAction;
  actorId: string;
  actorType: string;
  resourceId?: string;
  resourceType?: string;
  /**
   * Free-form context. Recognized optional keys persisted to DB columns:
   *   - previous_status, new_status  → financial_audit_log columns
   *   - ip_address, session_id       → carried inside metadata JSON
   *   - tx_hash, amount, currency, … → carried inside metadata JSON
   */
  metadata?: Record<string, unknown>;
}

export function auditLog(
  action: AuditAction,
  actorId: string,
  actorType: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
): void {
  const entry: AuditEntry = {
    timestamp: new Date().toISOString(),
    action,
    actorId,
    actorType,
    resourceId,
    resourceType: resourceId ? inferResourceType(action) : undefined,
    metadata,
  };

  // Structured JSON log line — easily parseable by log aggregators.
  // PRESERVED: this stdout line is the original behavior and remains the
  // primary signal. The DB write below is purely additive.
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);

  // Fire-and-forget DB persistence for order-scoped events.
  // The financial_audit_log table requires order_id + new_status NOT NULL,
  // so we only persist when both are derivable. Anything else stays
  // stdout-only (admin.login, compliance.access_*, etc.).
  void persistAuditEntry(entry);
}

function inferResourceType(action: AuditAction): string {
  if (action.startsWith('order.')) return 'order';
  if (action.startsWith('escrow.')) return 'order';
  if (action.startsWith('compliance.')) return 'dispute';
  if (action.startsWith('admin.')) return 'system';
  return 'unknown';
}

/**
 * Persist to financial_audit_log. Fire-and-forget — any failure is logged
 * as a warning but NEVER propagated. The original audit signal (stdout) is
 * already emitted, so a DB outage cannot lose audit data — it can only
 * delay queryability until logs are reindexed.
 */
async function persistAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    // Only persist order-scoped events (table requires order_id NOT NULL)
    if (!entry.resourceId || entry.resourceType !== 'order') return;

    const md = entry.metadata || {};
    const newStatus = (md.new_status as string | undefined)
      ?? statusFromAction(entry.action);
    if (!newStatus) return; // table requires new_status NOT NULL — skip if unknown

    const previousStatus = (md.previous_status as string | undefined) ?? null;

    // Lazy import to avoid circular dependency at module load
    const { query } = await import('@/lib/db');
    await query(
      `INSERT INTO financial_audit_log
         (order_id, actor_type, actor_id, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.resourceId,
        entry.actorType,
        entry.actorId,
        entry.action,
        previousStatus,
        newStatus,
        JSON.stringify(md),
      ],
    );
  } catch (err) {
    // Never throw from audit logging. Surface as a low-noise warning so
    // ops can detect prolonged outages but the calling code is unaffected.
    try {
      // eslint-disable-next-line no-console
      console.warn('[AUDIT] Failed to persist to financial_audit_log (non-fatal)', {
        action: entry.action,
        resourceId: entry.resourceId,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch { /* swallow logger failures too */ }
  }
}

/**
 * Best-effort derivation of the post-action status when the caller didn't
 * include it in metadata. Returns undefined when the action doesn't imply
 * a single concrete status — in which case the entry is stdout-only.
 */
function statusFromAction(action: AuditAction): string | undefined {
  switch (action) {
    case 'order.cancelled':
      return 'cancelled';
    case 'escrow.locked':
      return 'escrowed';
    case 'escrow.released':
      return 'completed';
    case 'escrow.refunded':
      return 'cancelled';
    default:
      return undefined; // order.status_changed needs explicit new_status in metadata
  }
}
