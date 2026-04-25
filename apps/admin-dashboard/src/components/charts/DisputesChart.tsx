import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DisputePoint } from "../../data/mockData";

const tooltipStyle = {
  background: "rgb(15 23 42 / 0.95)",
  border: "1px solid rgb(51 65 85)",
  borderRadius: 8,
  fontSize: 12,
};

export function DisputesChart({ data }: { data: DisputePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="t"
          stroke="#64748b"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          yAxisId="left"
          stroke="#64748b"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={32}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke="#64748b"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={32}
          tickFormatter={(v) => `${v}h`}
        />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#cbd5e1" }} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          iconType="circle"
          iconSize={8}
        />
        <Bar
          yAxisId="left"
          dataKey="opened"
          fill="#f97316"
          name="Opened"
          radius={[3, 3, 0, 0]}
          barSize={10}
        />
        <Bar
          yAxisId="left"
          dataKey="resolved"
          fill="#10b981"
          name="Resolved"
          radius={[3, 3, 0, 0]}
          barSize={10}
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="avgHours"
          stroke="#a78bfa"
          strokeWidth={2}
          dot={false}
          name="Avg Hours"
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
