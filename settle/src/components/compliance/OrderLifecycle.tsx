"use client";

/**
 * OrderLifecycle — Visual timeline showing every status change
 * with time deltas between steps. Used in compliance dispute cards.
 */

export interface LifecycleEvent {
  status: string;
  fromStatus: string | null;
  actorType: string;
  timestamp: string;
  deltaMs: number;
  deltaFormatted: string;
}

interface OrderLifecycleProps {
  events: LifecycleEvent[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  created:      { label: "Created",      color: "text-[var(--color-text-secondary)]",   dot: "bg-gray-500" },
  pending:      { label: "Pending",      color: "text-blue-400",   dot: "bg-blue-500" },
  accepted:     { label: "Accepted",     color: "text-yellow-400", dot: "bg-yellow-500" },
  escrowed:     { label: "Escrowed",     color: "text-purple-400", dot: "bg-purple-500" },
  payment_sent: { label: "Payment Sent", color: "text-primary", dot: "bg-primary" },
  completed:    { label: "Completed",    color: "text-emerald-400",dot: "bg-emerald-500" },
  cancelled:    { label: "Cancelled",    color: "text-red-400",    dot: "bg-red-500" },
  disputed:     { label: "Disputed",     color: "text-red-400",    dot: "bg-red-500" },
  expired:      { label: "Expired",      color: "text-muted",   dot: "bg-gray-600" },
};

function getConfig(status: string) {
  return STATUS_CONFIG[status] || { label: status, color: "text-[var(--color-text-secondary)]", dot: "bg-gray-500" };
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatDate(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function OrderLifecycle({ events }: OrderLifecycleProps) {
  if (!events || events.length === 0) return null;

  // Deduplicate consecutive events with same status (e.g., double dispute events)
  const deduped = events.filter(
    (ev, i) => i === 0 || ev.status !== events[i - 1].status
  );

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted mb-2">
        Order Lifecycle
      </p>
      <div className="flex items-center gap-0 overflow-x-auto no-scrollbar">
        {deduped.map((ev, i) => {
          const cfg = getConfig(ev.status);
          const isLast = i === deduped.length - 1;
          const isDisputed = ev.status === "disputed";

          return (
            <div key={`${ev.status}-${i}`} className="flex items-center shrink-0">
              {/* Step */}
              <div className="flex flex-col items-center gap-0.5">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ${
                    isDisputed ? "ring-2 ring-red-500/40" : ""
                  }`}
                />
                <span className={`text-[9px] font-semibold ${cfg.color} whitespace-nowrap`}>
                  {cfg.label}
                </span>
                <span className="text-[8px] text-[var(--color-text-quaternary)] whitespace-nowrap">
                  {formatTime(ev.timestamp)}
                </span>
                <span className="text-[7px] text-[var(--color-text-quaternary)] whitespace-nowrap">
                  {formatDate(ev.timestamp)}
                </span>
              </div>

              {/* Connector with time delta */}
              {!isLast && (
                <div className="flex flex-col items-center mx-1">
                  <div className="w-8 h-px bg-[var(--color-border-medium)] relative">
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                      <span className="text-[8px] font-mono text-muted whitespace-nowrap bg-muted-bg px-0.5">
                        {deduped[i + 1]?.deltaFormatted || ""}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
