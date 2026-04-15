/**
 * Risk Repository — Device tracking, IP logging, risk events, blacklist
 *
 * All operations are fire-and-forget safe — failures log but never throw
 * to callers (no regression risk on existing flows).
 */

import { query, queryOne } from '../index';
import cache from '@/lib/cache/redis';

// ============================================================================
// TYPES
// ============================================================================

export interface Device {
  device_id: string;
  first_seen: string;
  last_seen: string;
  linked_accounts: number;
  risk_score: number;
  metadata: Record<string, unknown>;
}

export interface DeviceUser {
  id: string;
  device_id: string;
  entity_id: string;
  entity_type: 'user' | 'merchant';
  first_seen: string;
  last_seen: string;
}

export interface IpLog {
  id: string;
  entity_id: string;
  entity_type: string;
  ip: string;
  action: string;
  user_agent: string | null;
  created_at: string;
}

export interface IpStat {
  ip: string;
  usage_count: number;
  unique_users: number;
  first_seen: string;
  last_seen: string;
  is_flagged: boolean;
}

export type RiskSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RiskEventType =
  | 'multi_account_device'
  | 'ip_cluster_detected'
  | 'frequent_device_change'
  | 'high_cancellation_rate'
  | 'dispute_spike'
  | 'vpn_detected'
  | 'blacklisted_wallet'
  | 'suspicious_volume_spike';

export interface RiskEvent {
  id: string;
  entity_id: string;
  entity_type: string;
  event_type: string;
  severity: RiskSeverity;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type BlacklistEntityType = 'user' | 'merchant' | 'device' | 'ip' | 'wallet';

export interface BlacklistEntry {
  id: string;
  entity_id: string;
  entity_type: BlacklistEntityType;
  reason: string;
  severity: 'soft' | 'hard';
  is_active: boolean;
  created_by: string | null;
  expires_at: string | null;
  created_at: string;
}

// ============================================================================
// DEVICE OPERATIONS
// ============================================================================

/**
 * Upsert a device record and link it to the entity.
 * Returns the number of linked accounts (for multi-account detection).
 */
export async function trackDevice(
  deviceId: string,
  entityId: string,
  entityType: 'user' | 'merchant',
  metadata?: Record<string, unknown>
): Promise<{ linkedAccounts: number; isNewLink: boolean }> {
  // Upsert device
  await query(
    `INSERT INTO devices (device_id, metadata)
     VALUES ($1, $2)
     ON CONFLICT (device_id) DO UPDATE
       SET last_seen = NOW(),
           metadata = COALESCE(NULLIF($2::jsonb, '{}'::jsonb), devices.metadata)`,
    [deviceId, JSON.stringify(metadata || {})]
  );

  // Upsert device-user link
  const linkResult = await queryOne<{ is_new: boolean }>(
    `INSERT INTO device_users (device_id, entity_id, entity_type)
     VALUES ($1, $2, $3)
     ON CONFLICT (device_id, entity_id, entity_type) DO UPDATE
       SET last_seen = NOW()
     RETURNING (xmax = 0) AS is_new`,
    [deviceId, entityId, entityType]
  );

  const isNewLink = linkResult?.is_new ?? false;

  // Count linked accounts
  const countResult = await queryOne<{ cnt: string }>(
    `SELECT COUNT(DISTINCT (entity_id, entity_type))::text AS cnt
     FROM device_users WHERE device_id = $1`,
    [deviceId]
  );
  const linkedAccounts = parseInt(countResult?.cnt || '1');

  // Update device linked_accounts count
  await query(
    `UPDATE devices SET linked_accounts = $1 WHERE device_id = $2`,
    [linkedAccounts, deviceId]
  );

  return { linkedAccounts, isNewLink };
}

/**
 * Get all devices linked to an entity.
 */
export async function getEntityDevices(
  entityId: string,
  entityType: 'user' | 'merchant'
): Promise<(DeviceUser & Pick<Device, 'risk_score' | 'linked_accounts' | 'metadata'>)[]> {
  return query(
    `SELECT du.*, d.risk_score, d.linked_accounts, d.metadata
     FROM device_users du
     JOIN devices d ON d.device_id = du.device_id
     WHERE du.entity_id = $1 AND du.entity_type = $2
     ORDER BY du.last_seen DESC`,
    [entityId, entityType]
  );
}

// ============================================================================
// IP OPERATIONS
// ============================================================================

/**
 * Log an IP usage event and update aggregated stats.
 */
export async function logIp(
  entityId: string,
  entityType: 'user' | 'merchant',
  ip: string,
  action: string,
  userAgent?: string | null
): Promise<{ uniqueUsers: number }> {
  // Insert IP log
  await query(
    `INSERT INTO ip_logs (entity_id, entity_type, ip, action, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [entityId, entityType, ip, action, userAgent || null]
  );

  // Upsert IP stats — compute unique users inline.
  // Explicit $1::varchar cast on EVERY usage — PG can't infer a single type
  // for $1 when the same param appears in both a VALUES position (varchar
  // column) and a WHERE subquery position (text inference). Without the
  // cast, PG throws 42P08: "inconsistent types deduced for parameter $1".
  const result = await queryOne<{ unique_users: number }>(
    `INSERT INTO ip_stats (ip, usage_count, unique_users, last_seen)
     VALUES ($1::varchar, 1,
       (SELECT COUNT(DISTINCT entity_id) FROM ip_logs WHERE ip = $1::varchar),
       NOW()
     )
     ON CONFLICT (ip) DO UPDATE
       SET usage_count = ip_stats.usage_count + 1,
           unique_users = (SELECT COUNT(DISTINCT entity_id) FROM ip_logs WHERE ip = $1::varchar),
           last_seen = NOW()
     RETURNING unique_users`,
    [ip]
  );

  return { uniqueUsers: result?.unique_users ?? 1 };
}

/**
 * Get recent IPs for an entity.
 */
export async function getEntityRecentIps(
  entityId: string,
  entityType: 'user' | 'merchant',
  limit = 20
): Promise<IpLog[]> {
  return query<IpLog>(
    `SELECT * FROM ip_logs
     WHERE entity_id = $1 AND entity_type = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [entityId, entityType, limit]
  );
}

// ============================================================================
// RISK EVENTS
// ============================================================================

/**
 * Insert a risk event and non-blocking recalculate risk_score.
 */
export async function insertRiskEvent(
  entityId: string,
  entityType: string,
  eventType: string,
  severity: RiskSeverity,
  metadata?: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO risk_events (entity_id, entity_type, event_type, severity, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [entityId, entityType, eventType, severity, JSON.stringify(metadata || {})]
  );

  // Fire-and-forget: recalculate risk score (never blocks caller)
  if (entityType === 'user' || entityType === 'merchant') {
    recalculateRiskScore(entityId, entityType as 'user' | 'merchant', eventType).catch(() => {});
  }
}

/**
 * Get risk events for an entity.
 */
export async function getEntityRiskEvents(
  entityId: string,
  limit = 50
): Promise<RiskEvent[]> {
  return query<RiskEvent>(
    `SELECT * FROM risk_events
     WHERE entity_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [entityId, limit]
  );
}

/**
 * Count risk events by type for an entity in a time window.
 */
export async function countRiskEvents(
  entityId: string,
  eventType: string,
  windowHours = 24
): Promise<number> {
  const result = await queryOne<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM risk_events
     WHERE entity_id = $1 AND event_type = $2
       AND created_at > NOW() - make_interval(hours => $3)`,
    [entityId, eventType, windowHours]
  );
  return parseInt(result?.cnt || '0');
}

// ============================================================================
// BLACKLIST
// ============================================================================

const BLACKLIST_CACHE_TTL = 60; // 1 minute cache

/**
 * Check if an entity is blacklisted (checks cache first).
 */
export async function isBlacklisted(
  entityId: string,
  entityType: BlacklistEntityType
): Promise<BlacklistEntry | null> {
  const cacheKey = `blacklist:${entityType}:${entityId}`;

  // Check cache
  const cached = await cache.get<BlacklistEntry | 'clear'>(cacheKey);
  if (cached === 'clear') return null;
  if (cached) return cached;

  // Query DB
  const entry = await queryOne<BlacklistEntry>(
    `SELECT * FROM blacklist
     WHERE entity_id = $1 AND entity_type = $2 AND is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [entityId, entityType]
  );

  // Cache result (even null to avoid repeated DB queries)
  await cache.set(cacheKey, entry || 'clear', BLACKLIST_CACHE_TTL);

  return entry;
}

/**
 * Add an entity to the blacklist.
 */
export async function addToBlacklist(
  entityId: string,
  entityType: BlacklistEntityType,
  reason: string,
  severity: 'soft' | 'hard' = 'hard',
  createdBy?: string,
  expiresAt?: Date
): Promise<BlacklistEntry | null> {
  const entry = await queryOne<BlacklistEntry>(
    `INSERT INTO blacklist (entity_id, entity_type, reason, severity, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (entity_id, entity_type) DO UPDATE
       SET reason = $3, severity = $4, is_active = true, created_by = $5, expires_at = $6
     RETURNING *`,
    [entityId, entityType, reason, severity, createdBy || null, expiresAt?.toISOString() || null]
  );

  // Invalidate cache
  await cache.del(`blacklist:${entityType}:${entityId}`);

  return entry;
}

/**
 * Remove an entity from the blacklist (soft delete).
 */
export async function removeFromBlacklist(
  entityId: string,
  entityType: BlacklistEntityType
): Promise<boolean> {
  const result = await query(
    `UPDATE blacklist SET is_active = false WHERE entity_id = $1 AND entity_type = $2 AND is_active = true RETURNING id`,
    [entityId, entityType]
  );
  await cache.del(`blacklist:${entityType}:${entityId}`);
  return result.length > 0;
}

/**
 * Get all active blacklist entries (for admin).
 */
export async function getActiveBlacklist(
  entityType?: BlacklistEntityType,
  limit = 100
): Promise<BlacklistEntry[]> {
  if (entityType) {
    return query<BlacklistEntry>(
      `SELECT * FROM blacklist WHERE entity_type = $1 AND is_active = true ORDER BY created_at DESC LIMIT $2`,
      [entityType, limit]
    );
  }
  return query<BlacklistEntry>(
    `SELECT * FROM blacklist WHERE is_active = true ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
}

// ============================================================================
// BEHAVIORAL STATS — increment on order lifecycle events
// ============================================================================

/**
 * Increment cancelled_orders for user and merchant.
 * Called alongside existing reputation events in order cancellation — NOT inside updateOrderStatus.
 */
export async function incrementCancelledOrders(
  userId: string,
  merchantId: string
): Promise<void> {
  await Promise.all([
    query('UPDATE users SET cancelled_orders = cancelled_orders + 1 WHERE id = $1', [userId]),
    query('UPDATE merchants SET cancelled_orders = cancelled_orders + 1 WHERE id = $1', [merchantId]),
  ]);
}

/**
 * Increment dispute_count for user and merchant.
 */
export async function incrementDisputeCount(
  userId: string,
  merchantId: string
): Promise<void> {
  await Promise.all([
    query('UPDATE users SET dispute_count = dispute_count + 1 WHERE id = $1', [userId]),
    query('UPDATE merchants SET dispute_count = dispute_count + 1 WHERE id = $1', [merchantId]),
  ]);
}

/**
 * Update average completion time (rolling average).
 */
export async function updateAvgCompletionTime(
  entityId: string,
  entityType: 'user' | 'merchant',
  completionTimeMs: number
): Promise<void> {
  const table = entityType === 'user' ? 'users' : 'merchants';
  // Rolling average: new_avg = old_avg + (new_value - old_avg) / count
  await query(
    `UPDATE ${table}
     SET avg_completion_time_ms = COALESCE(
       avg_completion_time_ms + (($1 - COALESCE(avg_completion_time_ms, $1)) / GREATEST(total_trades, 1)),
       $1
     )
     WHERE id = $2`,
    [completionTimeMs, entityId]
  );
}

// ============================================================================
// RISK SCORING — event weights and level calculation
// ============================================================================

/** Weight each event type contributes to risk_score */
const EVENT_WEIGHTS: Record<string, number> = {
  multi_account_device:   30,
  ip_cluster_detected:    25,
  frequent_device_change: 20,
  high_cancellation_rate: 20,
  dispute_spike:          40,
  vpn_detected:           15,
  vpn_usage:              15,
  blacklisted_wallet:     50,
  blacklist_connection:   50,
  suspicious_volume_spike: 15,
};

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Derive level from score */
function scoreToLevel(score: number): RiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

const RISK_PROFILE_CACHE_TTL = 120; // 2 minutes

/**
 * Recalculate and persist risk_score for an entity.
 * Called non-blocking after every insertRiskEvent.
 * Sums event weights from ALL risk_events for the entity.
 */
export async function recalculateRiskScore(
  entityId: string,
  entityType: 'user' | 'merchant',
  lastEventType?: string
): Promise<void> {
  try {
    // Sum weights from all events for this entity
    const events = await query<{ event_type: string; cnt: string }>(
      `SELECT event_type, COUNT(*)::text AS cnt
       FROM risk_events
       WHERE entity_id = $1
       GROUP BY event_type`,
      [entityId]
    );

    let score = 0;
    let totalEventCount = 0;
    for (const row of events) {
      const cnt = parseInt(row.cnt);
      totalEventCount += cnt;
      const weight = EVENT_WEIGHTS[row.event_type] ?? 10;
      // First occurrence: full weight. Subsequent: diminishing (+weight/3 each).
      score += weight + Math.floor((cnt - 1) * (weight / 3));
    }

    const level = scoreToLevel(score);

    await query(
      `INSERT INTO risk_profiles (entity_id, entity_type, risk_score, risk_level, event_count, last_event_type, last_event_at, last_recalc_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (entity_id) DO UPDATE
         SET risk_score = $3,
             risk_level = $4,
             entity_type = $2,
             event_count = $5,
             last_event_type = $6,
             last_event_at = NOW(),
             last_recalc_at = NOW()`,
      [entityId, entityType, score, level, totalEventCount, lastEventType || null]
    );

    // Invalidate cache
    await cache.del(`risk-profile:${entityId}`);
  } catch (err) {
    // Non-blocking — never let scoring failure affect callers
    console.error('[RISK] Score recalculation failed:', err);
  }
}

/**
 * Get the persisted risk_profile row (or a default).
 */
async function getPersistedRiskScore(
  entityId: string,
  entityType: 'user' | 'merchant'
): Promise<{ risk_score: number; risk_level: RiskLevel; event_count: number; last_event_type: string | null; last_event_at: string | null }> {
  const row = await queryOne<{
    risk_score: number;
    risk_level: RiskLevel;
    event_count: number;
    last_event_type: string | null;
    last_event_at: string | null;
  }>(
    `SELECT risk_score, risk_level, event_count, last_event_type, last_event_at
     FROM risk_profiles WHERE entity_id = $1`,
    [entityId]
  );

  if (row) return row;

  // No profile yet — compute on-demand (first request bootstraps it)
  await recalculateRiskScore(entityId, entityType);
  const fresh = await queryOne<{
    risk_score: number;
    risk_level: RiskLevel;
    event_count: number;
    last_event_type: string | null;
    last_event_at: string | null;
  }>(
    `SELECT risk_score, risk_level, event_count, last_event_type, last_event_at
     FROM risk_profiles WHERE entity_id = $1`,
    [entityId]
  );

  return fresh ?? { risk_score: 0, risk_level: 'low' as const, event_count: 0, last_event_type: null, last_event_at: null };
}

// ============================================================================
// FULL RISK PROFILE — admin aggregation from all data sources
// ============================================================================

export interface FullRiskProfile {
  // Basic info
  basic: {
    entity_id: string;
    entity_type: 'user' | 'merchant';
    username: string | null;
    display_name: string | null;
    wallet_address: string | null;
    account_created_at: string;
    last_active_at: string | null;
  };

  // Risk summary
  risk_summary: {
    risk_score: number;
    risk_level: RiskLevel;
    total_risk_events: number;
    last_risk_event: { type: string; severity: string; at: string } | null;
  };

  // Behavioral stats
  behavioral_stats: {
    total_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    dispute_count: number;
    success_rate: number; // percentage
    avg_completion_time_ms: number | null;
  };

  // Financial stats
  financial_stats: {
    total_volume: number;
    avg_order_size: number;
    volume_24h: number;
    volume_7d: number;
  };

  // Device intelligence
  device_intelligence: {
    total_devices: number;
    trusted_devices: number;
    new_devices_7d: number;
    devices: Array<{
      device_id: string;
      first_seen: string;
      last_seen: string;
      linked_accounts_count: number;
      is_trusted: boolean;
      metadata: Record<string, unknown>;
    }>;
  };

  // Network intelligence
  network_intelligence: {
    recent_ips: Array<{ ip: string; action: string; at: string }>;
    unique_ip_count: number;
    ip_clusters_flag: boolean;
  };

  // Risk events timeline
  risk_events: Array<{
    type: string;
    severity: string;
    metadata: Record<string, unknown>;
    timestamp: string;
  }>;

  // Blacklist status
  blacklist: {
    is_blacklisted: boolean;
    reason: string | null;
    type: string | null;
    severity: string | null;
  };

  // Session insights
  session_insights: {
    active_sessions: number;
    total_sessions_30d: number;
    avg_session_duration_hours: number | null;
    login_frequency_7d: number;
  };

  // Computed flags
  flags: {
    is_high_risk: boolean;
    is_suspicious_device_usage: boolean;
    is_ip_clustered: boolean;
    is_behavior_anomalous: boolean;
  };
}

/**
 * Build a complete admin risk profile aggregating from all data sources.
 * Every sub-query is wrapped in try/catch — partial data is always returned.
 */
export async function getRiskProfile(
  entityId: string,
  entityType: 'user' | 'merchant'
): Promise<FullRiskProfile | null> {
  // Check Redis cache first
  const cacheKey = `risk-profile:${entityId}`;
  const cached = await cache.get<FullRiskProfile>(cacheKey);
  if (cached) return cached;

  const table = entityType === 'user' ? 'users' : 'merchants';

  // ── Basic info ────────────────────────────────────────────────────────
  let basic: FullRiskProfile['basic'] | null = null;
  try {
    const usernameCol = entityType === 'user' ? 'username' : 'username';
    const displayCol = entityType === 'user' ? 'username' : 'display_name';
    const walletCol = 'wallet_address';
    const row = await queryOne<{
      username: string | null;
      display_name: string | null;
      wallet_address: string | null;
      created_at: string;
      last_seen_at: string | null;
      updated_at: string | null;
    }>(
      `SELECT ${usernameCol} AS username, ${displayCol} AS display_name,
              ${walletCol} AS wallet_address, created_at,
              ${entityType === 'merchant' ? 'last_seen_at' : 'NULL::timestamptz AS last_seen_at'},
              updated_at
       FROM ${table} WHERE id = $1`,
      [entityId]
    );
    if (!row) return null; // Entity doesn't exist
    basic = {
      entity_id: entityId,
      entity_type: entityType,
      username: row.username,
      display_name: row.display_name,
      wallet_address: row.wallet_address,
      account_created_at: row.created_at,
      last_active_at: row.last_seen_at || row.updated_at || null,
    };
  } catch (err) {
    console.error('[RISK_PROFILE] Basic info query failed:', err);
    return null; // Can't build profile without basic info
  }

  // ── All parallel aggregation queries ──────────────────────────────────
  // Every one is wrapped in try/catch for partial-failure resilience.

  const [
    riskScoreResult,
    behavioralResult,
    financialResult,
    devicesResult,
    ipsResult,
    eventsResult,
    blacklistResult,
    sessionResult,
  ] = await Promise.allSettled([
    // 1. Risk score from risk_profiles table
    getPersistedRiskScore(entityId, entityType),

    // 2. Behavioral stats
    queryOne<{
      total_trades: number;
      total_volume: number;
      cancelled_orders: number;
      dispute_count: number;
      avg_completion_time_ms: number | null;
    }>(
      `SELECT total_trades, total_volume,
              COALESCE(cancelled_orders, 0) AS cancelled_orders,
              COALESCE(dispute_count, 0) AS dispute_count,
              avg_completion_time_ms
       FROM ${table} WHERE id = $1`,
      [entityId]
    ),

    // 3. Financial stats — volume windows
    (async () => {
      const [vol24h, vol7d] = await Promise.all([
        queryOne<{ vol: string }>(
          `SELECT COALESCE(SUM(fiat_amount), 0)::text AS vol
           FROM orders
           WHERE ${entityType === 'user' ? 'user_id' : 'merchant_id'} = $1
             AND status = 'completed'
             AND updated_at > NOW() - INTERVAL '24 hours'`,
          [entityId]
        ),
        queryOne<{ vol: string }>(
          `SELECT COALESCE(SUM(fiat_amount), 0)::text AS vol
           FROM orders
           WHERE ${entityType === 'user' ? 'user_id' : 'merchant_id'} = $1
             AND status = 'completed'
             AND updated_at > NOW() - INTERVAL '7 days'`,
          [entityId]
        ),
      ]);
      return {
        volume_24h: parseFloat(vol24h?.vol || '0'),
        volume_7d: parseFloat(vol7d?.vol || '0'),
      };
    })(),

    // 4. Devices
    getEntityDevices(entityId, entityType),

    // 5. IPs — recent + unique count + cluster flag
    (async () => {
      const [recentIps, uniqueCount, clusterFlag] = await Promise.all([
        getEntityRecentIps(entityId, entityType, 10),
        queryOne<{ cnt: string }>(
          `SELECT COUNT(DISTINCT ip)::text AS cnt FROM ip_logs
           WHERE entity_id = $1 AND entity_type = $2`,
          [entityId, entityType]
        ),
        queryOne<{ flagged: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM ip_stats
             WHERE ip IN (SELECT DISTINCT ip FROM ip_logs WHERE entity_id = $1 AND entity_type = $2)
               AND is_flagged = true
           ) AS flagged`,
          [entityId, entityType]
        ),
      ]);
      return { recentIps, uniqueCount: parseInt(uniqueCount?.cnt || '0'), clusterFlag: clusterFlag?.flagged ?? false };
    })(),

    // 6. Risk events (last 20)
    getEntityRiskEvents(entityId, 20),

    // 7. Blacklist
    isBlacklisted(entityId, entityType),

    // 8. Session insights
    (async () => {
      const [activeSessions, total30d, avgDuration, loginFreq] = await Promise.all([
        queryOne<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM sessions
           WHERE entity_id = $1 AND entity_type = $2
             AND is_revoked = false AND expires_at > NOW()`,
          [entityId, entityType]
        ),
        queryOne<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM sessions
           WHERE entity_id = $1 AND entity_type = $2
             AND created_at > NOW() - INTERVAL '30 days'`,
          [entityId, entityType]
        ),
        queryOne<{ avg_hours: string | null }>(
          `SELECT AVG(
             EXTRACT(EPOCH FROM (
               COALESCE(revoked_at, LEAST(expires_at, NOW())) - created_at
             )) / 3600
           )::text AS avg_hours
           FROM sessions
           WHERE entity_id = $1 AND entity_type = $2
             AND created_at > NOW() - INTERVAL '30 days'`,
          [entityId, entityType]
        ),
        queryOne<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt FROM sessions
           WHERE entity_id = $1 AND entity_type = $2
             AND created_at > NOW() - INTERVAL '7 days'`,
          [entityId, entityType]
        ),
      ]);
      return {
        active: parseInt(activeSessions?.cnt || '0'),
        total30d: parseInt(total30d?.cnt || '0'),
        avgHours: avgDuration?.avg_hours ? parseFloat(avgDuration.avg_hours) : null,
        loginFreq7d: parseInt(loginFreq?.cnt || '0'),
      };
    })(),
  ]);

  // ── Safely unwrap results ─────────────────────────────────────────────

  const riskScore = riskScoreResult.status === 'fulfilled'
    ? riskScoreResult.value
    : { risk_score: 0, risk_level: 'low' as const, event_count: 0, last_event_type: null, last_event_at: null };

  const behavioral = behavioralResult.status === 'fulfilled' && behavioralResult.value
    ? behavioralResult.value
    : { total_trades: 0, total_volume: 0, cancelled_orders: 0, dispute_count: 0, avg_completion_time_ms: null };

  const financial = financialResult.status === 'fulfilled'
    ? financialResult.value
    : { volume_24h: 0, volume_7d: 0 };

  const devices = devicesResult.status === 'fulfilled' ? devicesResult.value : [];

  const ips = ipsResult.status === 'fulfilled'
    ? ipsResult.value
    : { recentIps: [] as IpLog[], uniqueCount: 0, clusterFlag: false };

  const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];

  const blacklistEntry = blacklistResult.status === 'fulfilled' ? blacklistResult.value : null;

  const sessions = sessionResult.status === 'fulfilled'
    ? sessionResult.value
    : { active: 0, total30d: 0, avgHours: null, loginFreq7d: 0 };

  // ── Compute derived values ────────────────────────────────────────────

  const totalTrades = behavioral.total_trades || 1;
  const completedOrders = behavioral.total_trades - behavioral.cancelled_orders - behavioral.dispute_count;
  const successRate = Math.round((Math.max(completedOrders, 0) / totalTrades) * 10000) / 100;
  const avgOrderSize = behavioral.total_volume > 0 ? Math.round(behavioral.total_volume / totalTrades * 100) / 100 : 0;

  // Device flags
  const trustedDevices = devices.filter(d => d.linked_accounts <= 2 && d.risk_score <= 20);
  const newDevices7d = devices.filter(d => {
    const firstSeen = new Date(d.first_seen);
    return Date.now() - firstSeen.getTime() < 7 * 24 * 60 * 60 * 1000;
  });

  // Computed admin flags
  const cancellationRate = behavioral.cancelled_orders / totalTrades;
  const disputeRate = behavioral.dispute_count / totalTrades;
  const maxLinkedAccounts = Math.max(...devices.map(d => d.linked_accounts), 0);

  const profile: FullRiskProfile = {
    basic,

    risk_summary: {
      risk_score: riskScore.risk_score,
      risk_level: riskScore.risk_level,
      total_risk_events: riskScore.event_count,
      last_risk_event: riskScore.last_event_type
        ? { type: riskScore.last_event_type, severity: events[0]?.severity ?? 'unknown', at: riskScore.last_event_at || '' }
        : null,
    },

    behavioral_stats: {
      total_orders: behavioral.total_trades,
      completed_orders: Math.max(completedOrders, 0),
      cancelled_orders: behavioral.cancelled_orders,
      dispute_count: behavioral.dispute_count,
      success_rate: successRate,
      avg_completion_time_ms: behavioral.avg_completion_time_ms,
    },

    financial_stats: {
      total_volume: behavioral.total_volume,
      avg_order_size: avgOrderSize,
      volume_24h: financial.volume_24h,
      volume_7d: financial.volume_7d,
    },

    device_intelligence: {
      total_devices: devices.length,
      trusted_devices: trustedDevices.length,
      new_devices_7d: newDevices7d.length,
      devices: devices.map(d => ({
        device_id: d.device_id,
        first_seen: d.first_seen,
        last_seen: d.last_seen,
        linked_accounts_count: d.linked_accounts,
        is_trusted: d.linked_accounts <= 2 && d.risk_score <= 20,
        metadata: d.metadata || {},
      })),
    },

    network_intelligence: {
      recent_ips: ips.recentIps.map(ip => ({ ip: ip.ip, action: ip.action, at: ip.created_at })),
      unique_ip_count: ips.uniqueCount,
      ip_clusters_flag: ips.clusterFlag,
    },

    risk_events: events.map(e => ({
      type: e.event_type,
      severity: e.severity,
      metadata: e.metadata,
      timestamp: e.created_at,
    })),

    blacklist: {
      is_blacklisted: !!blacklistEntry,
      reason: blacklistEntry?.reason || null,
      type: blacklistEntry?.entity_type || null,
      severity: blacklistEntry?.severity || null,
    },

    session_insights: {
      active_sessions: sessions.active,
      total_sessions_30d: sessions.total30d,
      avg_session_duration_hours: sessions.avgHours ? Math.round(sessions.avgHours * 100) / 100 : null,
      login_frequency_7d: sessions.loginFreq7d,
    },

    flags: {
      is_high_risk: riskScore.risk_score > 60,
      is_suspicious_device_usage: maxLinkedAccounts > 3 || newDevices7d.length > 2,
      is_ip_clustered: ips.clusterFlag,
      is_behavior_anomalous: cancellationRate > 0.3 || disputeRate > 0.2,
    },
  };

  // Cache for 2 minutes
  await cache.set(cacheKey, profile, RISK_PROFILE_CACHE_TTL);

  return profile;
}
