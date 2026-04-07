/**
 * Blacklist Middleware
 *
 * Checks if the authenticated actor, their device, or their IP
 * is blacklisted. Returns 403 if any match is found.
 *
 * Designed to be called AFTER auth resolution — never touches
 * the auth flow itself.
 */

import { NextRequest, NextResponse } from 'next/server';
import { AuthContext } from './auth';
import { isBlacklisted, BlacklistEntry } from '@/lib/db/repositories/risk';

export interface BlacklistCheckResult {
  blocked: boolean;
  entry: BlacklistEntry | null;
  matchType: 'user' | 'merchant' | 'device' | 'ip' | null;
}

/**
 * Check if the request should be blocked by the blacklist.
 * Checks actor ID, device_id header, and IP — in parallel.
 *
 * Returns null if not blocked, or a 403 response if blocked.
 */
export async function checkBlacklist(
  request: NextRequest,
  auth: AuthContext
): Promise<NextResponse | null> {
  try {
    const deviceId = request.headers.get('x-device-id');
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || null;

    // Build parallel checks
    const checks: Promise<BlacklistCheckResult>[] = [];

    // Check actor (user or merchant)
    const actorType = auth.actorType === 'user' ? 'user' as const :
                      auth.actorType === 'merchant' ? 'merchant' as const : null;
    if (actorType) {
      checks.push(
        isBlacklisted(auth.actorId, actorType).then(entry => ({
          blocked: !!entry,
          entry,
          matchType: actorType,
        }))
      );
    }

    // Check device
    if (deviceId) {
      checks.push(
        isBlacklisted(deviceId, 'device').then(entry => ({
          blocked: !!entry,
          entry,
          matchType: 'device' as const,
        }))
      );
    }

    // Check IP
    if (ip) {
      checks.push(
        isBlacklisted(ip, 'ip').then(entry => ({
          blocked: !!entry,
          entry,
          matchType: 'ip' as const,
        }))
      );
    }

    if (checks.length === 0) return null;

    const results = await Promise.all(checks);
    const blocked = results.find(r => r.blocked);

    if (blocked && blocked.entry) {
      // Soft ban = warn only (log but allow)
      if (blocked.entry.severity === 'soft') {
        console.warn('[BLACKLIST] Soft-banned entity detected', {
          actorId: auth.actorId,
          matchType: blocked.matchType,
          reason: blocked.entry.reason,
        });
        return null; // Allow through but logged
      }

      // Hard ban = block
      console.error('[BLACKLIST] Blocked request from blacklisted entity', {
        actorId: auth.actorId,
        matchType: blocked.matchType,
        entityId: blocked.entry.entity_id,
        reason: blocked.entry.reason,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Access denied. Your account has been restricted.',
          code: 'BLACKLISTED',
        },
        { status: 403 }
      );
    }

    return null;
  } catch (err) {
    // Blacklist check failure should NEVER block legitimate users
    console.error('[BLACKLIST] Check failed (allowing through):', err);
    return null;
  }
}
