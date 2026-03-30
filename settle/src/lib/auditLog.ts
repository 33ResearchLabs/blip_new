/**
 * Security Audit Logger
 *
 * Provides structured audit logging for security-sensitive actions.
 * Every log entry includes: who, what, when, and on which resource.
 *
 * In production, connect this to a persistent audit store (DB table, S3, SIEM).
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

  // Structured JSON log line — easily parseable by log aggregators
  console.log(`[AUDIT] ${JSON.stringify(entry)}`);
}

function inferResourceType(action: AuditAction): string {
  if (action.startsWith('order.')) return 'order';
  if (action.startsWith('escrow.')) return 'order';
  if (action.startsWith('compliance.')) return 'dispute';
  if (action.startsWith('admin.')) return 'system';
  return 'unknown';
}
