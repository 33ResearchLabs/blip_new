/**
 * POST /api/csp-report
 *
 * Receiver for browser-generated Content-Security-Policy violation reports.
 * Wired up via the `report-uri /api/csp-report` and
 * `report-to csp-endpoint` directives plus the
 * `Reporting-Endpoints: csp-endpoint="/api/csp-report"` header set by
 * `src/middleware.ts`.
 *
 * Two report shapes arrive here:
 *   - Legacy `report-uri` — Content-Type: application/csp-report
 *     Body: { "csp-report": { "violated-directive": ..., "blocked-uri": ..., ... } }
 *   - Reporting API v2 — Content-Type: application/reports+json
 *     Body: [ { "type": "csp-violation", "body": { "effectiveDirective": ..., ... } }, ... ]
 *
 * Behavior: never reflect content; always return 204; cap log size; rate-limited
 * by the global middleware bucket. The route is in PUBLIC_EXACT so the browser
 * can post even from an unauthenticated page (login screen, dev-lock page, etc.).
 */

import { NextRequest, NextResponse } from 'next/server';

const MAX_BODY_BYTES = 16 * 1024; // 16KB — reports are tiny; reject anything larger

interface CspReportLegacy {
  'csp-report'?: Record<string, unknown>;
}

type CspReportV2Item = {
  type?: string;
  body?: Record<string, unknown>;
  url?: string;
  user_agent?: string;
};

function summarize(report: unknown): {
  directive: string;
  blockedUri: string;
  documentUri: string;
} {
  // Pull the most useful fields out of either report shape for the log line.
  const out = { directive: 'unknown', blockedUri: 'unknown', documentUri: 'unknown' };
  if (!report || typeof report !== 'object') return out;

  const legacy = (report as CspReportLegacy)['csp-report'];
  if (legacy && typeof legacy === 'object') {
    out.directive = String(
      legacy['effective-directive'] ?? legacy['violated-directive'] ?? 'unknown'
    );
    out.blockedUri = String(legacy['blocked-uri'] ?? 'unknown');
    out.documentUri = String(legacy['document-uri'] ?? 'unknown');
    return out;
  }

  if (Array.isArray(report) && report.length > 0) {
    const first = report[0] as CspReportV2Item;
    const body = first.body ?? {};
    out.directive = String(
      body['effectiveDirective'] ?? body['violatedDirective'] ?? 'unknown'
    );
    out.blockedUri = String(body['blockedURL'] ?? body['blockedURI'] ?? 'unknown');
    out.documentUri = String(body['documentURL'] ?? first.url ?? 'unknown');
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    // Cap body size before reading — defensive against a buggy/hostile client
    const len = parseInt(request.headers.get('content-length') || '0', 10);
    if (len > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    const ct = (request.headers.get('content-type') || '').toLowerCase();
    let report: unknown = null;
    if (
      ct.includes('application/csp-report') ||
      ct.includes('application/reports+json') ||
      ct.includes('application/json')
    ) {
      report = await request.json().catch(() => null);
    }

    const { directive, blockedUri, documentUri } = summarize(report);

    // Console line — visible in Railway logs immediately
    console.warn('[SECURITY] CSP violation', {
      directive,
      blockedUri,
      documentUri,
      ua: request.headers.get('user-agent') ?? null,
      ip:
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
        request.headers.get('x-real-ip') ??
        null,
    });

    // Structured log to error_logs (fire-and-forget — never block the response)
    void (async () => {
      try {
        const { safeLog } = await import('@/lib/errorTracking/logger');
        safeLog({
          type: 'security.csp_violation',
          severity: 'WARN',
          source: 'frontend',
          message: `CSP blocked ${directive} → ${blockedUri} (on ${documentUri})`,
          metadata: {
            directive,
            blockedUri,
            documentUri,
            userAgent: request.headers.get('user-agent') ?? null,
            // Full report kept for forensic detail; safeLog already truncates to 32KB
            report,
          },
        });
      } catch {
        /* swallow — logging must never cascade */
      }
    })();

    // 204: never echo content back to a violator
    return new NextResponse(null, { status: 204 });
  } catch {
    // Last-resort fail-safe: still 204, never 5xx (would just spam reports)
    return new NextResponse(null, { status: 204 });
  }
}
