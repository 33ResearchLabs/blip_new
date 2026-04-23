'use client';

/**
 * Admin → Error Logs dashboard.
 *
 * Panel content lives in `ErrorLogsPanel` so it can be re-hosted under
 * the merged `/admin/observability` tabbed page without duplication.
 * Polls every 10s. When ENABLE_ERROR_TRACKING is off the panel surfaces
 * a friendly notice instead of a broken list.
 */

import Link from 'next/link';
import { Radio } from 'lucide-react';
import { useState } from 'react';
import ErrorLogsPanel from './ErrorLogsPanel';

export default function AdminErrorLogsPage() {
  const [refreshState, setRefreshState] = useState<{ loading: boolean; lastRefresh: Date }>(
    { loading: false, lastRefresh: new Date() },
  );
  const secondsAgo = Math.max(
    0,
    Math.floor((Date.now() - refreshState.lastRefresh.getTime()) / 1000),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <Radio size={14} className="text-[var(--color-success)] animate-pulse" />
            <span className="text-sm font-bold">Admin</span>
            <span className="text-[10px] text-foreground/30 font-mono">
              {refreshState.loading ? 'syncing…' : `${secondsAgo}s ago`}
            </span>
          </div>
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-card rounded-lg p-[3px]">
              {[
                ['/admin', 'Console'],
                ['/admin/live', 'Live Feed'],
                ['/admin/access-control', 'Access Control'],
                ['/admin/accounts', 'Accounts'],
                ['/admin/disputes', 'Disputes'],
                ['/admin/monitor', 'Monitor'],
                ['/admin/observability', 'Observability'],
                ['/admin/usdt-inr-price', 'Price'],
              ].map(([href, label]) => {
                const active = href === '/admin/observability';
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`px-3 py-[5px] rounded-md text-[12px] font-medium transition-colors ${
                      active
                        ? 'bg-accent-subtle text-foreground'
                        : 'text-foreground/40 hover:text-foreground/70 hover:bg-accent-subtle'
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        <ErrorLogsPanel onRefreshStateChange={setRefreshState} />
      </main>
    </div>
  );
}
