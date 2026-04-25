import { useEffect, useMemo, useState } from "react";
import { Filters } from "./components/Filters";
import { KpiCard } from "./components/KpiCard";
import { ChartCard } from "./components/ChartCard";
import { OrderTrendsChart } from "./components/charts/OrderTrendsChart";
import { StatusDonut } from "./components/charts/StatusDonut";
import { Funnel } from "./components/charts/Funnel";
import { DisputesChart } from "./components/charts/DisputesChart";
import { PricingChart } from "./components/charts/PricingChart";
import { LiveFeed } from "./components/LiveFeed";
import { generateData, type TimeRange, type UserType } from "./data/mockData";

const rangeLabel: Record<TimeRange, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export default function App() {
  const [range, setRange] = useState<TimeRange>("7d");
  const [userType, setUserType] = useState<UserType>("all");
  const [liveOn, setLiveOn] = useState(true);
  const [tick, setTick] = useState(0);

  const data = useMemo(
    () => generateData(range, userType),
    [range, userType, tick]
  );

  useEffect(() => {
    if (!liveOn) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [liveOn]);

  const avgResolution = useMemo(() => {
    if (!data.disputes.length) return 0;
    const sum = data.disputes.reduce((s, d) => s + d.avgHours, 0);
    return sum / data.disputes.length;
  }, [data.disputes]);

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-950">
      <Filters
        range={range}
        userType={userType}
        liveOn={liveOn}
        onRange={setRange}
        onUserType={setUserType}
        onToggleLive={() => setLiveOn((v) => !v)}
        onRefresh={() => setTick((t) => t + 1)}
      />

      <main className="flex-1 space-y-4 px-5 py-4">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {data.kpis.map((kpi) => (
            <KpiCard key={kpi.label} kpi={kpi} />
          ))}
        </section>

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <ChartCard
            title="Order Trends"
            subtitle={rangeLabel[range]}
            className="h-[280px] lg:col-span-6"
          >
            <OrderTrendsChart data={data.orderTrends} />
          </ChartCard>
          <ChartCard
            title="Order Status Distribution"
            subtitle="Share of total orders"
            className="h-[280px] lg:col-span-3"
          >
            <StatusDonut data={data.statusDistribution} />
          </ChartCard>
          <ChartCard
            title="Transaction Funnel"
            subtitle="Created → Paid → Escrow → Completed"
            className="h-[280px] lg:col-span-3"
          >
            <Funnel data={data.funnel} />
          </ChartCard>
        </section>

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <ChartCard
            title="Disputes"
            subtitle={`Avg resolution ${avgResolution.toFixed(1)}h`}
            className="h-[280px] lg:col-span-4"
          >
            <DisputesChart data={data.disputes} />
          </ChartCard>
          <ChartCard
            title="Pricing"
            subtitle="Buyer vs Merchant vs Final"
            className="h-[280px] lg:col-span-4"
          >
            <PricingChart data={data.pricing} />
          </ChartCard>
          <ChartCard
            title="Live Activity"
            subtitle={liveOn ? "Streaming" : "Paused"}
            className="h-[280px] lg:col-span-4"
          >
            <LiveFeed initial={data.live} paused={!liveOn} />
          </ChartCard>
        </section>

        <footer className="pt-2 text-center text-[11px] text-slate-600">
          Mock data · Range: {rangeLabel[range]} · User: {userType} · Auto-refresh{" "}
          {liveOn ? "30s" : "off"}
        </footer>
      </main>
    </div>
  );
}
