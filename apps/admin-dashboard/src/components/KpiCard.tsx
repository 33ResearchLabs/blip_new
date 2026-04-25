import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { Kpi } from "../data/mockData";
import { fmtCompact, fmtCurrency, fmtNumber, fmtPct } from "../lib/format";

const formatValue = (v: number, fmt: Kpi["format"]) => {
  if (fmt === "currency") return fmtCurrency(v);
  if (fmt === "compact") return fmtCompact(v);
  return fmtNumber(v);
};

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const positive = kpi.delta >= 0;
  const deltaClass = positive ? "pill-up" : "pill-down";
  const stroke = positive ? "#10b981" : "#ef4444";
  const fillId = `kpi-${kpi.label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="card card-pad flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {kpi.label}
        </span>
        <span className={deltaClass}>
          {positive ? "▲" : "▼"} {fmtPct(kpi.delta)}
        </span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tabular-nums text-slate-50">
          {formatValue(kpi.value, kpi.format)}
        </div>
        <div className="h-10 w-24 -mb-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={kpi.series}>
              <defs>
                <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="value"
                stroke={stroke}
                strokeWidth={1.5}
                fill={`url(#${fillId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
