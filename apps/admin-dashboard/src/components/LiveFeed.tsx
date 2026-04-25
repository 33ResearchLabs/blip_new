import { useEffect, useRef, useState } from "react";
import type { LiveActivity } from "../data/mockData";
import { fmtCurrency, fmtTime } from "../lib/format";

const KIND_META: Record<
  LiveActivity["kind"],
  { label: string; dot: string; pill: string }
> = {
  order: {
    label: "Order",
    dot: "bg-brand-400",
    pill: "bg-brand-500/10 text-brand-300",
  },
  payment: {
    label: "Payment",
    dot: "bg-emerald-400",
    pill: "bg-emerald-500/10 text-emerald-300",
  },
  dispute: {
    label: "Dispute",
    dot: "bg-amber-400",
    pill: "bg-amber-500/10 text-amber-300",
  },
  error: {
    label: "Error",
    dot: "bg-rose-400",
    pill: "bg-rose-500/10 text-rose-300",
  },
};

export function LiveFeed({
  initial,
  paused,
}: {
  initial: LiveActivity[];
  paused: boolean;
}) {
  const [items, setItems] = useState<LiveActivity[]>(initial);
  const counter = useRef(0);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      counter.current += 1;
      const kinds: LiveActivity["kind"][] = ["order", "payment", "dispute", "error"];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      const messages: Record<LiveActivity["kind"], string[]> = {
        order: [
          `New order #BL-${10000 + Math.floor(Math.random() * 80000)} created`,
          `Order #BL-${10000 + Math.floor(Math.random() * 80000)} marked in progress`,
        ],
        payment: [
          `Escrow locked for #BL-${10000 + Math.floor(Math.random() * 80000)}`,
          `Payout released to merchant ${100 + Math.floor(Math.random() * 9000)}`,
        ],
        dispute: [
          `Dispute opened on #BL-${10000 + Math.floor(Math.random() * 80000)}`,
          `Dispute resolved: released to buyer`,
        ],
        error: [
          `Webhook retry attempt 3`,
          `Capture timeout on order #BL-${10000 + Math.floor(Math.random() * 80000)}`,
        ],
      };
      const message =
        messages[kind][Math.floor(Math.random() * messages[kind].length)];
      const next: LiveActivity = {
        id: `live-${Date.now()}-${counter.current}`,
        ts: new Date().toISOString(),
        kind,
        message,
        amount:
          kind === "payment" || kind === "order"
            ? Math.round(40 + Math.random() * 800)
            : undefined,
      };
      setItems((curr) => [next, ...curr].slice(0, 30));
    }, 2400);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <ul className="scrollbar-thin flex h-full flex-col gap-2 overflow-y-auto pr-1">
      {items.map((it) => {
        const meta = KIND_META[it.kind];
        return (
          <li
            key={it.id}
            className="flex items-start gap-2 rounded-lg border border-slate-800/70 bg-slate-900/40 px-2.5 py-2"
          >
            <span
              className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className={`pill ${meta.pill}`}>{meta.label}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {fmtTime(it.ts)}
                </span>
              </div>
              <div className="mt-1 truncate text-xs text-slate-300">
                {it.message}
              </div>
              {it.amount !== undefined ? (
                <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                  {fmtCurrency(it.amount)}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
