'use client';

/**
 * Admin → Worker Health dashboard.
 *
 * Color-coded liveness table for every background worker (both fleets), backed
 * by the worker_health table. Panel content lives in WorkerHealthPanel; this
 * wrapper owns only the small refresh indicator. Polls every 10s.
 */

import { Radio } from 'lucide-react';
import { useState } from 'react';
import WorkerHealthPanel from './WorkerHealthPanel';

export default function AdminWorkerHealthPage() {
  const [refreshState, setRefreshState] = useState<{ loading: boolean; lastRefresh: Date }>(
    { loading: false, lastRefresh: new Date() },
  );
  const secondsAgo = Math.max(
    0,
    Math.floor((Date.now() - refreshState.lastRefresh.getTime()) / 1000),
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Persistent nav lives in src/app/admin/layout.tsx. */}
      <div className="flex items-center gap-2 max-w-7xl mx-auto px-4 py-1.5 border-b border-border">
        <Radio size={14} className="text-[var(--color-success)] animate-pulse" />
        <span className="text-[10px] text-foreground/30 font-mono">
          {refreshState.loading ? 'syncing…' : `${secondsAgo}s ago`}
        </span>
      </div>

      <main className="max-w-7xl mx-auto p-4">
        <WorkerHealthPanel onRefreshStateChange={setRefreshState} />
      </main>
    </div>
  );
}
