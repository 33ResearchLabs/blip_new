/**
 * Risk Scan Worker API
 *
 * POST /api/admin/risk-scan
 *
 * Runs auto-flag rules that detect fraud patterns.
 * Designed to be called by a cron job every 5-10 minutes.
 * Requires admin auth.
 *
 * Rules:
 *   1. Devices linked to >3 users → risk_event
 *   2. IPs used by >5 users → risk_event (flag IP)
 *   3. Entities with >3 device changes in 24h → risk_event
 *   4. High cancellation rate (>30%) with >5 trades → risk_event
 *   5. Dispute spike (>2 disputes in 24h) → risk_event
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { query } from '@/lib/db';
import { insertRiskEvent } from '@/lib/db/repositories/risk';

export async function POST(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  const results = {
    multi_account_devices: 0,
    ip_clusters: 0,
    frequent_device_changes: 0,
    high_cancellation: 0,
    dispute_spikes: 0,
    errors: [] as string[],
  };

  // ── Rule 1: Multi-account devices ──────────────────────────────────────
  try {
    const flaggedDevices = await query<{
      device_id: string;
      linked_accounts: number;
      entity_ids: string[];
    }>(
      `SELECT d.device_id, d.linked_accounts,
              array_agg(DISTINCT du.entity_id) AS entity_ids
       FROM devices d
       JOIN device_users du ON du.device_id = d.device_id
       WHERE d.linked_accounts > 3
         AND NOT EXISTS (
           SELECT 1 FROM risk_events re
           WHERE re.entity_type = 'device'
             AND re.entity_id = d.device_id::text
             AND re.event_type = 'multi_account_device'
             AND re.created_at > NOW() - INTERVAL '24 hours'
         )
       GROUP BY d.device_id, d.linked_accounts`
    );

    for (const device of flaggedDevices) {
      await insertRiskEvent(
        device.device_id,
        'device',
        'multi_account_device',
        device.linked_accounts > 5 ? 'high' : 'medium',
        { linked_accounts: device.linked_accounts, entity_ids: device.entity_ids }
      );
      results.multi_account_devices++;
    }
  } catch (err) {
    results.errors.push(`Rule 1 (multi_account_devices): ${err}`);
  }

  // ── Rule 2: IP clusters ────────────────────────────────────────────────
  try {
    const flaggedIps = await query<{ ip: string; unique_users: number }>(
      `SELECT ip, unique_users FROM ip_stats
       WHERE unique_users > 5 AND is_flagged = false`
    );

    for (const ipStat of flaggedIps) {
      await insertRiskEvent(
        ipStat.ip,
        'ip',
        'ip_cluster_detected',
        ipStat.unique_users > 10 ? 'high' : 'medium',
        { unique_users: ipStat.unique_users }
      );
      await query('UPDATE ip_stats SET is_flagged = true WHERE ip = $1', [ipStat.ip]);
      results.ip_clusters++;
    }
  } catch (err) {
    results.errors.push(`Rule 2 (ip_clusters): ${err}`);
  }

  // ── Rule 3: Frequent device changes ────────────────────────────────────
  try {
    const frequentSwitchers = await query<{
      entity_id: string;
      entity_type: string;
      device_count: string;
    }>(
      `SELECT entity_id, entity_type, COUNT(DISTINCT device_id)::text AS device_count
       FROM device_users
       WHERE last_seen > NOW() - INTERVAL '24 hours'
       GROUP BY entity_id, entity_type
       HAVING COUNT(DISTINCT device_id) > 3`
    );

    for (const switcher of frequentSwitchers) {
      // Skip if already flagged in last 24h
      const existing = await query(
        `SELECT 1 FROM risk_events
         WHERE entity_id = $1 AND event_type = 'frequent_device_change'
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [switcher.entity_id]
      );
      if (existing.length > 0) continue;

      await insertRiskEvent(
        switcher.entity_id,
        switcher.entity_type,
        'frequent_device_change',
        'medium',
        { device_count_24h: parseInt(switcher.device_count) }
      );
      results.frequent_device_changes++;
    }
  } catch (err) {
    results.errors.push(`Rule 3 (frequent_device_changes): ${err}`);
  }

  // ── Rule 4: High cancellation rate ─────────────────────────────────────
  try {
    // Check users
    const highCancelUsers = await query<{ id: string }>(
      `SELECT id FROM users
       WHERE total_trades >= 5
         AND cancelled_orders > 0
         AND (cancelled_orders::float / GREATEST(total_trades, 1)) > 0.3
         AND NOT EXISTS (
           SELECT 1 FROM risk_events re
           WHERE re.entity_id = users.id::text
             AND re.event_type = 'high_cancellation_rate'
             AND re.created_at > NOW() - INTERVAL '7 days'
         )`
    );

    for (const user of highCancelUsers) {
      await insertRiskEvent(user.id, 'user', 'high_cancellation_rate', 'medium', {});
      results.high_cancellation++;
    }

    // Check merchants
    const highCancelMerchants = await query<{ id: string }>(
      `SELECT id FROM merchants
       WHERE total_trades >= 5
         AND cancelled_orders > 0
         AND (cancelled_orders::float / GREATEST(total_trades, 1)) > 0.3
         AND NOT EXISTS (
           SELECT 1 FROM risk_events re
           WHERE re.entity_id = merchants.id::text
             AND re.event_type = 'high_cancellation_rate'
             AND re.created_at > NOW() - INTERVAL '7 days'
         )`
    );

    for (const merchant of highCancelMerchants) {
      await insertRiskEvent(merchant.id, 'merchant', 'high_cancellation_rate', 'medium', {});
      results.high_cancellation++;
    }
  } catch (err) {
    results.errors.push(`Rule 4 (high_cancellation): ${err}`);
  }

  // ── Rule 5: Dispute spikes ─────────────────────────────────────────────
  try {
    // Find entities with >2 dispute events in last 24h
    const disputeSpikes = await query<{
      entity_id: string;
      entity_type: string;
      dispute_count: string;
    }>(
      `SELECT entity_id, entity_type, COUNT(*)::text AS dispute_count
       FROM risk_events
       WHERE event_type IN ('order_disputed')
         AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY entity_id, entity_type
       HAVING COUNT(*) > 2`
    );

    // Also check from orders directly
    const orderDisputes = await query<{
      entity_id: string;
      entity_type: string;
      cnt: string;
    }>(
      `SELECT user_id AS entity_id, 'user' AS entity_type, COUNT(*)::text AS cnt
       FROM orders
       WHERE status = 'disputed' AND updated_at > NOW() - INTERVAL '24 hours'
       GROUP BY user_id
       HAVING COUNT(*) > 2
       UNION ALL
       SELECT merchant_id AS entity_id, 'merchant' AS entity_type, COUNT(*)::text AS cnt
       FROM orders
       WHERE status = 'disputed' AND updated_at > NOW() - INTERVAL '24 hours'
         AND merchant_id IS NOT NULL
       GROUP BY merchant_id
       HAVING COUNT(*) > 2`
    );

    const allSpikes = [...disputeSpikes, ...orderDisputes];
    const seen = new Set<string>();

    for (const spike of allSpikes) {
      const key = `${spike.entity_id}:${spike.entity_type}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip if already flagged
      const existing = await query(
        `SELECT 1 FROM risk_events
         WHERE entity_id = $1 AND event_type = 'dispute_spike'
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [spike.entity_id]
      );
      if (existing.length > 0) continue;

      await insertRiskEvent(
        spike.entity_id,
        spike.entity_type,
        'dispute_spike',
        'high',
        { dispute_count_24h: parseInt((spike as Record<string, string>).dispute_count || (spike as Record<string, string>).cnt || '0') }
      );
      results.dispute_spikes++;
    }
  } catch (err) {
    results.errors.push(`Rule 5 (dispute_spikes): ${err}`);
  }

  const totalFlags = results.multi_account_devices + results.ip_clusters +
    results.frequent_device_changes + results.high_cancellation + results.dispute_spikes;

  console.log('[RISK_SCAN] Completed', {
    ...results,
    total_new_flags: totalFlags,
  });

  return NextResponse.json({
    success: true,
    data: {
      ...results,
      total_new_flags: totalFlags,
      scanned_at: new Date().toISOString(),
    },
  });
}
