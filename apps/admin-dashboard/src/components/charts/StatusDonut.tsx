import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { StatusDatum } from "../../data/mockData";
import { fmtCompact } from "../../lib/format";

const tooltipStyle = {
  background: "rgb(15 23 42 / 0.95)",
  border: "1px solid rgb(51 65 85)",
  borderRadius: 8,
  fontSize: 12,
};

export function StatusDonut({ data }: { data: StatusDatum[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex h-full items-center gap-4">
      <div className="relative h-full min-h-[160px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: number, n) => [fmtCompact(v), n]}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              stroke="none"
              paddingAngle={2}
              isAnimationActive={false}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-xs text-slate-400">Total</div>
          <div className="text-lg font-semibold text-slate-100 tabular-nums">
            {fmtCompact(total)}
          </div>
        </div>
      </div>
      <ul className="flex w-32 flex-col gap-1.5 text-xs">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: d.color }}
              />
              {d.name}
            </span>
            <span className="tabular-nums text-slate-400">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
