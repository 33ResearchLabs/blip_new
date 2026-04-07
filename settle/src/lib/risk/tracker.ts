/**
 * Risk Tracker — fire-and-forget tracking service
 *
 * Call these functions after login, signup, and order actions.
 * All operations catch errors internally — they NEVER throw.
 * This ensures zero regression on existing flows.
 */

import { NextRequest } from 'next/server';
import {
  trackDevice,
  logIp,
  insertRiskEvent,
  type RiskSeverity,
} from '@/lib/db/repositories/risk';

// ============================================================================
// THRESHOLDS — tune these for your fraud tolerance
// ============================================================================

const MULTI_ACCOUNT_DEVICE_THRESHOLD = 3;  // >3 users on same device = flag
const IP_CLUSTER_THRESHOLD = 5;            // >5 users on same IP = flag
const DEVICE_CHANGE_THRESHOLD = 3;         // >3 devices/day = flag

// ============================================================================
// MAIN TRACKING FUNCTION
// ============================================================================

export interface TrackingContext {
  entityId: string;
  entityType: 'user' | 'merchant';
  action: 'login' | 'signup' | 'order_create' | 'order_complete' | 'session_refresh';
}

/**
 * Extract tracking data from a request and process it.
 * Fire-and-forget — call without awaiting if latency-sensitive.
 */
export async function trackRequest(
  request: NextRequest,
  ctx: TrackingContext
): Promise<void> {
  try {
    const deviceId = request.headers.get('x-device-id');
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || null;
    const userAgent = request.headers.get('user-agent') || null;

    // Parse device metadata from header (frontend sends JSON-encoded metadata)
    let deviceMetadata: Record<string, unknown> = {};
    const metaHeader = request.headers.get('x-device-meta');
    if (metaHeader) {
      try {
        deviceMetadata = JSON.parse(metaHeader);
      } catch {
        // Invalid JSON — ignore
      }
    }

    // Run device tracking and IP logging in parallel
    const promises: Promise<void>[] = [];

    // 1. Device tracking
    if (deviceId) {
      promises.push(trackDeviceWithFlags(deviceId, ctx, deviceMetadata));
    }

    // 2. IP logging
    if (ip) {
      promises.push(trackIpWithFlags(ip, ctx, userAgent));
    }

    await Promise.allSettled(promises);
  } catch (err) {
    // Top-level safety net — never let tracking break the request
    console.error('[RISK_TRACKER] Unexpected error:', err);
  }
}

// ============================================================================
// INTERNAL — device tracking + auto-flags
// ============================================================================

async function trackDeviceWithFlags(
  deviceId: string,
  ctx: TrackingContext,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    const { linkedAccounts, isNewLink } = await trackDevice(
      deviceId,
      ctx.entityId,
      ctx.entityType,
      metadata
    );

    // Auto-flag: multi-account device
    if (isNewLink && linkedAccounts > MULTI_ACCOUNT_DEVICE_THRESHOLD) {
      const severity: RiskSeverity = linkedAccounts > 5 ? 'high' : 'medium';
      await insertRiskEvent(
        ctx.entityId,
        ctx.entityType,
        'multi_account_device',
        severity,
        {
          device_id: deviceId,
          linked_accounts: linkedAccounts,
          action: ctx.action,
        }
      );
      console.warn('[RISK] Multi-account device detected', {
        deviceId: deviceId.substring(0, 12) + '...',
        linkedAccounts,
        entityId: ctx.entityId,
      });
    }
  } catch (err) {
    console.error('[RISK_TRACKER] Device tracking failed:', err);
  }
}

// ============================================================================
// INTERNAL — IP tracking + auto-flags
// ============================================================================

async function trackIpWithFlags(
  ip: string,
  ctx: TrackingContext,
  userAgent: string | null
): Promise<void> {
  try {
    const { uniqueUsers } = await logIp(
      ctx.entityId,
      ctx.entityType,
      ip,
      ctx.action,
      userAgent
    );

    // Auto-flag: IP cluster
    if (uniqueUsers > IP_CLUSTER_THRESHOLD) {
      const severity: RiskSeverity = uniqueUsers > 10 ? 'high' : 'medium';
      await insertRiskEvent(
        ctx.entityId,
        ctx.entityType,
        'ip_cluster_detected',
        severity,
        {
          ip,
          unique_users: uniqueUsers,
          action: ctx.action,
        }
      );
      console.warn('[RISK] IP cluster detected', {
        ip,
        uniqueUsers,
        entityId: ctx.entityId,
      });
    }
  } catch (err) {
    console.error('[RISK_TRACKER] IP tracking failed:', err);
  }
}

// ============================================================================
// DEVICE CHANGE DETECTION — call from login flows
// ============================================================================

/**
 * Check if an entity has used too many different devices recently.
 * Call this on login to detect frequent device switching.
 */
export async function checkDeviceChangeFrequency(
  entityId: string,
  entityType: 'user' | 'merchant'
): Promise<void> {
  try {
    const { query } = await import('@/lib/db');
    const result = await query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT device_id)::text AS cnt
       FROM device_users
       WHERE entity_id = $1 AND entity_type = $2
         AND last_seen > NOW() - INTERVAL '24 hours'`,
      [entityId, entityType]
    );

    const deviceCount = parseInt(result[0]?.cnt || '0');
    if (deviceCount > DEVICE_CHANGE_THRESHOLD) {
      await insertRiskEvent(
        entityId,
        entityType,
        'frequent_device_change',
        'medium',
        { device_count_24h: deviceCount }
      );
      console.warn('[RISK] Frequent device change detected', {
        entityId,
        deviceCount,
      });
    }
  } catch (err) {
    console.error('[RISK_TRACKER] Device change check failed:', err);
  }
}
