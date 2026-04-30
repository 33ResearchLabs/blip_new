"use client";

import { useState, useEffect, use } from "react";
import {
  Shield,
  Zap,
  ChevronLeft,
  AlertTriangle,
  Monitor,
  Globe,
  Activity,
  DollarSign,
  Clock,
  Ban,
} from "lucide-react";
import Link from "next/link";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

// ============================================
// TYPES (mirrors FullRiskProfile from backend)
// ============================================

interface RiskProfile {
  basic: {
    entity_id: string;
    entity_type: "user" | "merchant";
    username: string | null;
    display_name: string | null;
    wallet_address: string | null;
    account_created_at: string;
    last_active_at: string | null;
  };
  risk_summary: {
    risk_score: number;
    risk_level: string;
    total_risk_events: number;
    last_risk_event: { type: string; severity: string; at: string } | null;
  };
  behavioral_stats: {
    total_orders: number;
    completed_orders: number;
    cancelled_orders: number;
    dispute_count: number;
    success_rate: number;
    avg_completion_time_ms: number | null;
  };
  financial_stats: {
    total_volume: number;
    avg_order_size: number;
    volume_24h: number;
    volume_7d: number;
  };
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
  network_intelligence: {
    recent_ips: Array<{ ip: string; action: string; at: string }>;
    unique_ip_count: number;
    ip_clusters_flag: boolean;
  };
  risk_events: Array<{
    type: string;
    severity: string;
    metadata: Record<string, unknown>;
    timestamp: string;
  }>;
  blacklist: {
    is_blacklisted: boolean;
    reason: string | null;
    type: string | null;
    severity: string | null;
  };
  session_insights: {
    active_sessions: number;
    total_sessions_30d: number;
    avg_session_duration_hours: number | null;
    login_frequency_7d: number;
  };
  flags: {
    is_high_risk: boolean;
    is_suspicious_device_usage: boolean;
    is_ip_clustered: boolean;
    is_behavior_anomalous: boolean;
  };
}

// ============================================
// HELPERS
// ============================================

const riskColor = (level: string) => {
  switch (level) {
    case "critical": return "text-[var(--color-error)]";
    case "high": return "text-primary";
    case "medium": return "text-[var(--color-warning)]";
    default: return "text-[var(--color-success)]";
  }
};

const riskBg = (level: string) => {
  switch (level) {
    case "critical": return "bg-[var(--color-error)]/15 border-[var(--color-error)]/25";
    case "high": return "bg-primary/12 border-primary/25";
    case "medium": return "bg-[var(--color-warning)]/12 border-[var(--color-warning)]/25";
    default: return "bg-[var(--color-success)]/10 border-[var(--color-success)]/20";
  }
};

const sevColor = (sev: string) => {
  switch (sev) {
    case "critical": return "text-[var(--color-error)] bg-[var(--color-error)]/10";
    case "high": return "text-primary bg-primary/10";
    case "medium": return "text-[var(--color-warning)] bg-[var(--color-warning)]/10";
    default: return "text-foreground/50 bg-foreground/5";
  }
};

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const fmtAgo = (d: string | null) => {
  if (!d) return "—";
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const fmtVol = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

// ============================================
// SECTION CARD
// ============================================

function Card({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-section-divider">
        <Icon className="w-3.5 h-3.5 text-foreground/30" />
        <span className="text-[10px] font-mono font-bold text-foreground/50 uppercase tracking-wider">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div>
      <div className="text-[9px] font-mono text-foreground/30 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-bold tabular-nums ${color || "text-foreground/70"}`}>{value}</div>
      {sub && <div className="text-[9px] font-mono text-foreground/25 mt-0.5">{sub}</div>}
    </div>
  );
}

// ============================================
// PAGE
// ============================================

export default function RiskProfilePage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = use(params);
  const [profile, setProfile] = useState<RiskProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Admin auth cookie is sent automatically (httpOnly + same-origin).
    // The server returns 401 if there is no session — handled below.
    fetchWithAuth(`/api/risk-profile/${entityId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setProfile(data.data);
        } else {
          setError(data.error || "Failed to load profile");
        }
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
  }, [entityId]);

  if (loading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-foreground/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-6 h-6 text-[var(--color-error)]/40 mx-auto mb-2" />
          <p className="text-sm text-foreground/40">{error || "Profile not found"}</p>
          <Link href="/admin/accounts?tab=merchants" className="text-[10px] text-primary mt-2 block">Back to merchants</Link>
        </div>
      </div>
    );
  }

  const p = profile;
  const b = p.basic;
  const r = p.risk_summary;
  const bs = p.behavioral_stats;
  const fs = p.financial_stats;
  const di = p.device_intelligence;
  const ni = p.network_intelligence;
  const si = p.session_insights;
  const fl = p.flags;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="h-[50px] flex items-center px-4 gap-3">
          <Link href="/admin/accounts?tab=merchants" className="flex items-center gap-1.5 text-foreground/40 hover:text-foreground/70 transition-colors">
            <ChevronLeft className="w-4 h-4" />
            <span className="text-[11px] font-mono">Accounts</span>
          </Link>
          <div className="flex items-center gap-2 mx-auto">
            <Zap className="w-4 h-4 text-foreground fill-foreground" />
            <span className="text-[14px] font-bold">Risk Profile</span>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">

        {/* ── Hero: Identity + Risk Score ── */}
        <div className="flex flex-col md:flex-row gap-4">
          {/* Identity */}
          <div className="flex-1 bg-card border border-border rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-sm font-bold text-foreground/80">{b.display_name || b.username || "Unknown"}</div>
                <div className="text-[10px] font-mono text-foreground/30">{b.entity_type.toUpperCase()} &middot; {b.entity_id.slice(0, 8)}...</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[10px] font-mono">
              <div><span className="text-foreground/25">Wallet</span> <span className="text-foreground/50 block truncate">{b.wallet_address || "—"}</span></div>
              <div><span className="text-foreground/25">Joined</span> <span className="text-foreground/50 block">{fmtDate(b.account_created_at)}</span></div>
              <div><span className="text-foreground/25">Last active</span> <span className="text-foreground/50 block">{fmtAgo(b.last_active_at)}</span></div>
            </div>
          </div>

          {/* Risk Score */}
          <div className={`w-full md:w-64 border rounded-xl p-5 flex flex-col items-center justify-center ${riskBg(r.risk_level)}`}>
            <div className={`text-4xl font-bold font-mono tabular-nums ${riskColor(r.risk_level)}`}>{r.risk_score}</div>
            <div className={`text-[11px] font-mono font-bold uppercase tracking-widest mt-1 ${riskColor(r.risk_level)}`}>{r.risk_level}</div>
            <div className="text-[9px] font-mono text-foreground/25 mt-2">{r.total_risk_events} events</div>
            {r.last_risk_event && (
              <div className="text-[8px] font-mono text-foreground/20 mt-0.5">{r.last_risk_event.type} &middot; {fmtAgo(r.last_risk_event.at)}</div>
            )}
          </div>

          {/* Flags */}
          <div className="w-full md:w-48 bg-card border border-border rounded-xl p-4 space-y-2">
            <div className="text-[9px] font-mono font-bold text-foreground/35 uppercase tracking-wider mb-1">Flags</div>
            {([
              ["High Risk", fl.is_high_risk],
              ["Suspicious Devices", fl.is_suspicious_device_usage],
              ["IP Clustered", fl.is_ip_clustered],
              ["Behavior Anomaly", fl.is_behavior_anomalous],
            ] as [string, boolean][]).map(([label, active]) => (
              <div key={label} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${active ? "bg-[var(--color-error)]" : "bg-foreground/10"}`} />
                <span className={`text-[10px] font-mono ${active ? "text-[var(--color-error)]" : "text-foreground/25"}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Stats Row ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Behavioral */}
          <Card title="Behavioral Stats" icon={Activity}>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Orders" value={bs.total_orders} />
              <Stat label="Completed" value={bs.completed_orders} color="text-[var(--color-success)]/70" />
              <Stat label="Success" value={`${bs.success_rate}%`} color={bs.success_rate < 70 ? "text-[var(--color-error)]" : "text-[var(--color-success)]/70"} />
              <Stat label="Cancelled" value={bs.cancelled_orders} color={bs.cancelled_orders > 0 ? "text-primary/70" : undefined} />
              <Stat label="Disputes" value={bs.dispute_count} color={bs.dispute_count > 0 ? "text-[var(--color-error)]" : undefined} />
              <Stat label="Avg Time" value={bs.avg_completion_time_ms ? `${Math.round(bs.avg_completion_time_ms / 60000)}m` : "—"} />
            </div>
          </Card>

          {/* Financial */}
          <Card title="Financial Stats" icon={DollarSign}>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Total Volume" value={fmtVol(fs.total_volume)} />
              <Stat label="Avg Order" value={fmtVol(fs.avg_order_size)} />
              <Stat label="24h Volume" value={fmtVol(fs.volume_24h)} />
              <Stat label="7d Volume" value={fmtVol(fs.volume_7d)} />
            </div>
          </Card>

          {/* Sessions */}
          <Card title="Session Insights" icon={Clock}>
            <div className="grid grid-cols-2 gap-4">
              <Stat label="Active Now" value={si.active_sessions} />
              <Stat label="30d Sessions" value={si.total_sessions_30d} />
              <Stat label="Avg Duration" value={si.avg_session_duration_hours ? `${si.avg_session_duration_hours}h` : "—"} />
              <Stat label="Logins (7d)" value={si.login_frequency_7d} />
            </div>
          </Card>
        </div>

        {/* ── Devices + Network ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Devices */}
          <Card title={`Device Intelligence (${di.total_devices})`} icon={Monitor}>
            <div className="flex gap-3 mb-3 text-[9px] font-mono">
              <span className="text-foreground/25">Trusted: <span className="text-[var(--color-success)] font-bold">{di.trusted_devices}</span></span>
              <span className="text-foreground/25">New (7d): <span className="text-primary font-bold">{di.new_devices_7d}</span></span>
            </div>
            {di.devices.length === 0 ? (
              <p className="text-[10px] text-foreground/20 font-mono">No devices tracked yet</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-hide">
                {di.devices.map((d) => (
                  <div key={d.device_id} className="flex items-center justify-between px-2 py-1.5 rounded bg-background/50 border border-section-divider">
                    <div className="min-w-0">
                      <div className="text-[9px] font-mono text-foreground/50 truncate">{d.device_id.slice(0, 16)}...</div>
                      <div className="text-[8px] font-mono text-foreground/20">{fmtAgo(d.last_seen)} &middot; {(d.metadata as Record<string, string>)?.browserName || ""} {(d.metadata as Record<string, string>)?.osName || ""}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span className={`text-[8px] font-mono font-bold ${d.linked_accounts_count > 3 ? "text-[var(--color-error)]" : "text-foreground/30"}`}>
                        {d.linked_accounts_count} accts
                      </span>
                      <span className={`w-1.5 h-1.5 rounded-full ${d.is_trusted ? "bg-[var(--color-success)]" : "bg-primary"}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Network */}
          <Card title={`Network Intelligence (${ni.unique_ip_count} IPs)`} icon={Globe}>
            <div className="flex gap-3 mb-3 text-[9px] font-mono">
              <span className="text-foreground/25">Unique IPs: <span className="font-bold text-foreground/50">{ni.unique_ip_count}</span></span>
              {ni.ip_clusters_flag && (
                <span className="text-[var(--color-error)] font-bold flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" /> CLUSTER DETECTED
                </span>
              )}
            </div>
            {ni.recent_ips.length === 0 ? (
              <p className="text-[10px] text-foreground/20 font-mono">No IPs logged yet</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto scrollbar-hide">
                {ni.recent_ips.map((ip, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-1 rounded bg-background/50 border border-section-divider">
                    <span className="text-[9px] font-mono text-foreground/50">{ip.ip}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] font-mono text-foreground/25">{ip.action}</span>
                      <span className="text-[8px] font-mono text-foreground/20">{fmtAgo(ip.at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── Risk Events + Blacklist ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Events Timeline */}
          <div className="md:col-span-2">
            <Card title={`Risk Events (${r.total_risk_events})`} icon={AlertTriangle}>
              {p.risk_events.length === 0 ? (
                <p className="text-[10px] text-foreground/20 font-mono">No risk events recorded</p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto scrollbar-hide">
                  {p.risk_events.map((e, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 rounded bg-background/50 border border-section-divider">
                      <span className={`px-1.5 py-0.5 rounded text-[7px] font-bold uppercase ${sevColor(e.severity)}`}>
                        {e.severity}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-mono text-foreground/60">{e.type.replace(/_/g, " ")}</span>
                        {Object.keys(e.metadata).length > 0 && (
                          <span className="text-[8px] text-foreground/20 ml-2">{JSON.stringify(e.metadata).slice(0, 60)}</span>
                        )}
                      </div>
                      <span className="text-[8px] font-mono text-foreground/20 shrink-0">{fmtAgo(e.timestamp)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Blacklist */}
          <Card title="Blacklist Status" icon={Ban}>
            {p.blacklist.is_blacklisted ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[var(--color-error)] animate-pulse" />
                  <span className="text-[11px] font-mono font-bold text-[var(--color-error)]">BLACKLISTED</span>
                </div>
                <div className="text-[10px] font-mono text-foreground/40 space-y-1">
                  <div>Type: <span className="text-foreground/60">{p.blacklist.type}</span></div>
                  <div>Severity: <span className="text-foreground/60">{p.blacklist.severity}</span></div>
                  <div>Reason: <span className="text-foreground/60">{p.blacklist.reason}</span></div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[var(--color-success)]/40" />
                <span className="text-[11px] font-mono text-[var(--color-success)]/60">Not blacklisted</span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
