import type { FunnelDatum } from "../../data/mockData";
import { fmtCompact } from "../../lib/format";

const COLORS = ["#329dff", "#1c7df0", "#7c3aed", "#10b981"];

export function Funnel({ data }: { data: FunnelDatum[] }) {
  const max = data[0]?.value ?? 1;
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      {data.map((d, i) => {
        const width = Math.max(8, (d.value / max) * 100);
        const drop = i > 0 ? data[i - 1].value - d.value : 0;
        const dropPct = i > 0 ? (drop / data[i - 1].value) * 100 : 0;
        return (
          <div key={d.name} className="space-y-1">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium text-slate-300">{d.name}</span>
              <span className="tabular-nums text-slate-400">
                {fmtCompact(d.value)}{" "}
                <span className="text-slate-500">({d.pct.toFixed(0)}%)</span>
              </span>
            </div>
            <div className="relative h-7 overflow-hidden rounded-md bg-slate-800/50">
              <div
                className="h-full rounded-md transition-all"
                style={{
                  width: `${width}%`,
                  background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}, ${COLORS[i % COLORS.length]}AA)`,
                }}
              />
              {i > 0 && drop > 0 ? (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-rose-300/90">
                  −{dropPct.toFixed(0)}%
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
