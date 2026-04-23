'use client';

/**
 * Admin → Observability: unified tabbed view over the Issues + Error Logs
 * panels. Each tab mounts the same panel component used by the standalone
 * `/admin/issues` and `/admin/error-logs` pages — no duplication.
 *
 * Active tab is driven by the `?tab=issues|errors` query param so links
 * can deep-link and the browser back button does the expected thing.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Bug, Radio } from 'lucide-react';
import { Suspense, useCallback, useState } from 'react';
import IssuesPanel from '../issues/IssuesPanel';
import ErrorLogsPanel from '../error-logs/ErrorLogsPanel';

type Tab = 'issues' | 'errors';

function AdminObservabilityInner() {
  const router = useRouter();
  const params = useSearchParams();
  const rawTab = params.get('tab');
  const activeTab: Tab = rawTab === 'errors' ? 'errors' : 'issues';

  const [refreshState, setRefreshState] = useState<{ loading: boolean; lastRefresh: Date }>(
    { loading: false, lastRefresh: new Date() },
  );
  const secondsAgo = Math.max(
    0,
    Math.floor((Date.now() - refreshState.lastRefresh.getTime()) / 1000),
  );

  const onRefreshStateChange = useCallback(
    (s: { loading: boolean; lastRefresh: Date }) => setRefreshState(s),
    [],
  );

  const switchTab = (t: Tab) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', t);
    router.replace(`/admin/observability?${sp.toString()}`);
  };

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

      <main className="max-w-7xl mx-auto px-4 py-4">
        <div className="mb-4 flex items-center gap-1 border-b border-border">
          <TabButton
            active={activeTab === 'issues'}
            onClick={() => switchTab('issues')}
            icon={<Bug size={13} />}
            label="Issues"
            subtitle="User-reported"
          />
          <TabButton
            active={activeTab === 'errors'}
            onClick={() => switchTab('errors')}
            icon={<AlertTriangle size={13} />}
            label="Error Logs"
            subtitle="Auto-captured"
          />
        </div>

        {/*
          Only the active panel is mounted — the other's polling loop
          stays torn down so we don't double-poll or double-render two
          detail drawers. Each panel owns its own filter + selection
          state; switching tabs resets both, which matches the user's
          mental model (different workspace per tab).
        */}
        {activeTab === 'issues' ? (
          <IssuesPanel onRefreshStateChange={onRefreshStateChange} />
        ) : (
          <ErrorLogsPanel onRefreshStateChange={onRefreshStateChange} />
        )}
      </main>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
}

function TabButton({ active, onClick, icon, label, subtitle }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2 text-[13px] font-medium transition-colors ${
        active
          ? 'text-foreground'
          : 'text-foreground/50 hover:text-foreground/80'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span className="text-[10px] text-foreground/40 font-normal">{subtitle}</span>
      {active && (
        <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-foreground" />
      )}
    </button>
  );
}

export default function AdminObservabilityPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <AdminObservabilityInner />
    </Suspense>
  );
}
