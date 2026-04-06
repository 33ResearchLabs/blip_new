/**
 * Runtime Detection Guards
 *
 * Lightweight in-memory trackers that log warnings for suspicious patterns.
 * Non-blocking — never rejects requests, only observes and logs.
 * Alerts are persisted to the security_alerts DB table for the admin dashboard.
 *
 * Tracked patterns:
 *   - Rapid duplicate order attempts (same user, same params)
 *   - Multiple claim attempts on same order
 *   - Repeated payment retries for same order
 *   - Suspicious auth velocity (many wallets from same IP)
 */

import { logger } from '@/lib/logger';
import { query } from '@/lib/db';

// ── In-memory sliding window counters ──────────────────────────────────

interface WindowEntry {
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const windows = new Map<string, WindowEntry>();
const WINDOW_MS = 60_000; // 1 minute window
const MAX_ENTRIES = 5000;

function trackEvent(category: string, key: string): number {
  const fullKey = `${category}:${key}`;
  const now = Date.now();

  const entry = windows.get(fullKey);
  if (entry && now - entry.firstSeen < WINDOW_MS) {
    entry.count++;
    entry.lastSeen = now;
    return entry.count;
  }

  // New window or expired
  windows.set(fullKey, { count: 1, firstSeen: now, lastSeen: now });

  // Lazy eviction
  if (windows.size > MAX_ENTRIES) {
    const cutoff = now - WINDOW_MS;
    for (const [k, v] of windows) {
      if (v.lastSeen < cutoff) windows.delete(k);
    }
  }

  return 1;
}

// ── Alert Persistence (DB-backed) ──────────────────────────────────────

export interface SecurityAlert {
  id: number;
  timestamp: string;
  type: 'rapid_order' | 'multi_claim' | 'payment_retry' | 'auth_velocity';
  severity: 'HIGH' | 'MEDIUM';
  message: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
}

function persistAlert(
  type: SecurityAlert['type'],
  severity: SecurityAlert['severity'],
  message: string,
  metadata: Record<string, unknown>,
): void {
  // Fire-and-forget — don't block the request if DB write fails
  query(
    `INSERT INTO security_alerts (type, severity, message, metadata)
     VALUES ($1, $2, $3, $4)`,
    [type, severity, message, JSON.stringify(metadata)]
  ).catch((err) => {
    logger.warn('[GUARD] Failed to persist alert (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/** Get recent alerts from the database for admin dashboard. */
export async function getRecentAlerts(
  limit = 50,
  severity?: 'HIGH' | 'MEDIUM',
): Promise<SecurityAlert[]> {
  const params: (string | number)[] = [];
  let sql = `SELECT id, timestamp, type, severity, message, metadata, acknowledged
             FROM security_alerts`;

  if (severity) {
    params.push(severity);
    sql += ` WHERE severity = $${params.length}`;
  }

  sql += ` ORDER BY timestamp DESC`;
  params.push(limit);
  sql += ` LIMIT $${params.length}`;

  const rows = await query<SecurityAlert>(sql, params);
  return rows;
}

// ── Public Guard Functions ─────────────────────────────────────────────

/** Track order creation attempts. Warns if same user creates >3 orders/minute. */
export function guardOrderCreation(userId: string, type: string, amount: number): void {
  const count = trackEvent('order_create', `${userId}:${type}`);
  if (count > 3) {
    const meta = { userId, type, amount, attemptsInWindow: count };
    logger.warn('[GUARD] Rapid order creation detected', meta);
    persistAlert('rapid_order', 'HIGH', `User creating ${count} ${type} orders/min`, meta);
  }
}

/** Track order claim attempts. Warns if >2 claims on same order in a minute. */
export function guardOrderClaim(orderId: string, merchantId: string): void {
  const count = trackEvent('order_claim', orderId);
  if (count > 2) {
    const meta = { orderId, merchantId, attemptsInWindow: count };
    logger.warn('[GUARD] Multiple claim attempts on same order', meta);
    persistAlert('multi_claim', 'MEDIUM', `Order ${orderId.slice(0, 8)}… claimed ${count}x/min`, meta);
  }
}

/** Track payment retries. Warns if >2 payment actions on same order in a minute. */
export function guardPaymentRetry(orderId: string, action: string, actorId: string): void {
  const count = trackEvent('payment_retry', `${orderId}:${action}`);
  if (count > 2) {
    const meta = { orderId, action, actorId, attemptsInWindow: count };
    logger.warn('[GUARD] Repeated payment action on same order', meta);
    persistAlert('payment_retry', 'HIGH', `Payment ${action} retried ${count}x on ${orderId.slice(0, 8)}…`, meta);
  }
}

/** Track auth attempts from same IP. Warns if >10 auth calls/minute from one IP. */
export function guardAuthVelocity(ip: string, walletAddress: string): void {
  const count = trackEvent('auth_velocity', ip);
  if (count > 10) {
    const meta = {
      ip: ip.substring(0, 12) + '***',
      walletPrefix: walletAddress.substring(0, 8),
      attemptsInWindow: count,
    };
    logger.warn('[GUARD] High auth velocity from single IP', meta);
    persistAlert('auth_velocity', 'MEDIUM', `${count} auth attempts/min from ${meta.ip}`, meta);
  }
}
