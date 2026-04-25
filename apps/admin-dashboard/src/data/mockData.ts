export type TimeRange = "24h" | "7d" | "30d";
export type UserType = "all" | "buyer" | "seller";

const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

export interface SeriesPoint {
  t: string;
  value: number;
}

export interface OrderTrendPoint {
  t: string;
  orders: number;
  revenue: number;
  completed: number;
  cancelled: number;
}

export interface StatusDatum {
  name: string;
  value: number;
  color: string;
}

export interface FunnelDatum {
  name: string;
  value: number;
  pct: number;
}

export interface DisputePoint {
  t: string;
  opened: number;
  resolved: number;
  avgHours: number;
}

export interface PricingPoint {
  t: string;
  buyer: number;
  merchant: number;
  final: number;
}

export interface LiveActivity {
  id: string;
  ts: string;
  kind: "order" | "payment" | "dispute" | "error";
  message: string;
  amount?: number;
}

export interface Kpi {
  label: string;
  value: number;
  format: "number" | "currency" | "compact";
  delta: number;
  series: SeriesPoint[];
}

export interface DashboardData {
  kpis: Kpi[];
  orderTrends: OrderTrendPoint[];
  statusDistribution: StatusDatum[];
  funnel: FunnelDatum[];
  disputes: DisputePoint[];
  pricing: PricingPoint[];
  live: LiveActivity[];
}

const STATUS_COLORS = {
  Pending: "#f59e0b",
  "In Progress": "#3b82f6",
  Completed: "#10b981",
  Cancelled: "#ef4444",
  Expired: "#6b7280",
};

const labelsForRange = (range: TimeRange): string[] => {
  if (range === "24h") {
    return Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, "0")}:00`);
  }
  if (range === "7d") {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days;
  }
  return Array.from({ length: 30 }, (_, i) => `D${i + 1}`);
};

const sparkline = (rng: () => number, base: number, points = 14): SeriesPoint[] => {
  const arr: SeriesPoint[] = [];
  let v = base;
  for (let i = 0; i < points; i++) {
    v = Math.max(0, v + (rng() - 0.45) * base * 0.18);
    arr.push({ t: `${i}`, value: v });
  }
  return arr;
};

export function generateData(range: TimeRange, userType: UserType): DashboardData {
  const seed =
    range.charCodeAt(0) * 7 + range.length * 31 + userType.charCodeAt(0) * 13;
  const rng = seeded(seed);
  const userScale = userType === "all" ? 1 : userType === "buyer" ? 0.62 : 0.38;
  const rangeScale = range === "24h" ? 0.06 : range === "7d" ? 0.45 : 1;
  const k = userScale * rangeScale;

  const labels = labelsForRange(range);

  const orderTrends: OrderTrendPoint[] = labels.map((t) => {
    const orders = Math.round((400 + rng() * 600) * k);
    const completed = Math.round(orders * (0.62 + rng() * 0.18));
    const cancelled = Math.round(orders * (0.06 + rng() * 0.08));
    const revenue = Math.round(completed * (90 + rng() * 60));
    return { t, orders, revenue, completed, cancelled };
  });

  const totalOrders = orderTrends.reduce((s, p) => s + p.orders, 0);
  const totalCompleted = orderTrends.reduce((s, p) => s + p.completed, 0);
  const totalCancelled = orderTrends.reduce((s, p) => s + p.cancelled, 0);
  const totalRevenue = orderTrends.reduce((s, p) => s + p.revenue, 0);
  const activeUsers = Math.round((8200 + rng() * 4800) * userScale);
  const totalDisputes = Math.round(totalOrders * (0.018 + rng() * 0.012));

  const kpis: Kpi[] = [
    {
      label: "Total Orders",
      value: totalOrders,
      format: "compact",
      delta: 8.4,
      series: sparkline(rng, totalOrders / labels.length),
    },
    {
      label: "Completed",
      value: totalCompleted,
      format: "compact",
      delta: 11.2,
      series: sparkline(rng, totalCompleted / labels.length),
    },
    {
      label: "Cancelled",
      value: totalCancelled,
      format: "compact",
      delta: -4.7,
      series: sparkline(rng, totalCancelled / labels.length),
    },
    {
      label: "Revenue",
      value: totalRevenue,
      format: "currency",
      delta: 14.6,
      series: sparkline(rng, totalRevenue / labels.length),
    },
    {
      label: "Active Users",
      value: activeUsers,
      format: "compact",
      delta: 3.1,
      series: sparkline(rng, activeUsers / 10),
    },
    {
      label: "Open Disputes",
      value: totalDisputes,
      format: "number",
      delta: -2.3,
      series: sparkline(rng, totalDisputes / labels.length),
    },
  ];

  const statusDistribution: StatusDatum[] = (
    [
      ["Completed", 0.64],
      ["In Progress", 0.14],
      ["Pending", 0.1],
      ["Cancelled", 0.08],
      ["Expired", 0.04],
    ] as const
  ).map(([name, share]) => ({
    name,
    value: Math.round(totalOrders * share),
    color: STATUS_COLORS[name as keyof typeof STATUS_COLORS],
  }));

  const created = totalOrders;
  const paid = Math.round(created * 0.86);
  const escrow = Math.round(paid * 0.94);
  const completed = Math.round(escrow * 0.91);
  const funnel: FunnelDatum[] = [
    { name: "Order Created", value: created, pct: 100 },
    { name: "Payment Done", value: paid, pct: (paid / created) * 100 },
    { name: "Escrow Locked", value: escrow, pct: (escrow / created) * 100 },
    { name: "Completed", value: completed, pct: (completed / created) * 100 },
  ];

  const disputes: DisputePoint[] = labels.map((t, i) => {
    const opened = Math.round((6 + rng() * 18) * (range === "24h" ? 0.4 : 1));
    const resolved = Math.max(0, Math.round(opened * (0.7 + rng() * 0.25)));
    const avgHours = +(8 + rng() * 18).toFixed(1);
    return { t, opened, resolved, avgHours };
  });

  const pricing: PricingPoint[] = labels.map((t) => {
    const buyer = +(95 + rng() * 12).toFixed(2);
    const merchant = +(82 + rng() * 10).toFixed(2);
    const final = +((buyer + merchant) / 2 + (rng() - 0.5) * 3).toFixed(2);
    return { t, buyer, merchant, final };
  });

  const liveKinds: LiveActivity["kind"][] = ["order", "payment", "dispute", "error"];
  const liveMessages = {
    order: [
      "New order #BL-{n} from buyer @{u}",
      "Order #BL-{n} marked in progress",
      "Order #BL-{n} created by merchant",
    ],
    payment: [
      "Payment captured for #BL-{n}",
      "Escrow locked for #BL-{n}",
      "Payout released for #BL-{n}",
    ],
    dispute: [
      "Dispute opened on #BL-{n}",
      "Dispute resolved: refunded to seller",
      "Dispute resolved: released to buyer",
    ],
    error: [
      "Webhook retry for #BL-{n} (attempt 3)",
      "Stripe 502 on capture for #BL-{n}",
      "KYC service timeout for @{u}",
    ],
  };
  const live: LiveActivity[] = Array.from({ length: 14 }, (_, i) => {
    const kind = liveKinds[Math.floor(rng() * liveKinds.length)];
    const tmpls = liveMessages[kind];
    const tmpl = tmpls[Math.floor(rng() * tmpls.length)];
    const message = tmpl
      .replace("{n}", `${10000 + Math.floor(rng() * 80000)}`)
      .replace("{u}", `user${Math.floor(rng() * 9999)}`);
    return {
      id: `${Date.now()}-${i}`,
      ts: new Date(Date.now() - i * 23000 - Math.floor(rng() * 17000)).toISOString(),
      kind,
      message,
      amount:
        kind === "payment"
          ? Math.round(40 + rng() * 800)
          : kind === "order"
            ? Math.round(40 + rng() * 800)
            : undefined,
    };
  });

  return {
    kpis,
    orderTrends,
    statusDistribution,
    funnel,
    disputes,
    pricing,
    live,
  };
}
