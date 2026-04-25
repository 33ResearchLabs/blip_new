import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OrderTrendPoint } from "../../data/mockData";
import { fmtCompact } from "../../lib/format";

const tooltipStyle = {
  background: "rgb(15 23 42 / 0.95)",
  border: "1px solid rgb(51 65 85)",
  borderRadius: 8,
  fontSize: 12,
};

export function OrderTrendsChart({ data }: { data: OrderTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="ordersFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#329dff" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#329dff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t"
          stroke="#64748b"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="#64748b"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => fmtCompact(v as number)}
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: "#cbd5e1" }}
          formatter={(v: number) => fmtCompact(v)}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          iconType="circle"
          iconSize={8}
        />
        <Area
          type="monotone"
          dataKey="orders"
          stroke="#329dff"
          fill="url(#ordersFill)"
          strokeWidth={2}
          name="Orders"
        />
        <Line
          type="monotone"
          dataKey="completed"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
          name="Completed"
        />
        <Line
          type="monotone"
          dataKey="cancelled"
          stroke="#ef4444"
          strokeWidth={2}
          dot={false}
          name="Cancelled"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
