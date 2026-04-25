export const fmtNumber = (n: number) =>
  new Intl.NumberFormat("en-US").format(Math.round(n));

export const fmtCurrency = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);

export const fmtCompact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

export const fmtPct = (n: number, digits = 1) =>
  `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;

export const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};
