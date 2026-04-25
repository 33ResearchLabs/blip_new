import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PricingPoint } from "../../data/mockData";

const tooltipStyle = {
  background: "rgb(15 23 42 / 0.95)",
  border: "1px solid rgb(51 65 85)",
  borderRadius: 8,
  fontSize: 12,
};

export function PricingChart({ data }: { data: PricingPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
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
          width={32}
          tickFormatter={(v) => `$${v}`}
          domain={["dataMin - 4", "dataMax + 4"]}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: "#cbd5e1" }}
          formatter={(v: number) => `$${v.toFixed(2)}`}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          iconType="circle"
          iconSize={8}
        />
        <Line
          type="monotone"
          dataKey="buyer"
          stroke="#329dff"
          strokeWidth={2}
          dot={false}
          name="Buyer"
        />
        <Line
          type="monotone"
          dataKey="merchant"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={false}
          name="Merchant"
        />
        <Line
          type="monotone"
          dataKey="final"
          stroke="#10b981"
          strokeWidth={2.2}
          dot={false}
          name="Final"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
