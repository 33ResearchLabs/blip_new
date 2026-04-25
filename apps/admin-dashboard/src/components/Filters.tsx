import type { TimeRange, UserType } from "../data/mockData";

const RANGE_OPTIONS: { id: TimeRange; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

const USER_OPTIONS: { id: UserType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "buyer", label: "Buyers" },
  { id: "seller", label: "Sellers" },
];

interface Props {
  range: TimeRange;
  userType: UserType;
  liveOn: boolean;
  onRange: (r: TimeRange) => void;
  onUserType: (u: UserType) => void;
  onToggleLive: () => void;
  onRefresh: () => void;
}

function SegGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 font-medium transition ${
            value === o.id
              ? "bg-brand-500/20 text-brand-200"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Filters({
  range,
  userType,
  liveOn,
  onRange,
  onUserType,
  onToggleLive,
  onRefresh,
}: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/80 px-5 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-700 text-xs font-bold">
            B
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-100">
              Blip Admin
            </div>
            <div className="text-[10px] text-slate-500">
              Operational analytics
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">Range</span>
        <SegGroup options={RANGE_OPTIONS} value={range} onChange={onRange} />
        <span className="ml-2 text-xs text-slate-500">User</span>
        <SegGroup options={USER_OPTIONS} value={userType} onChange={onUserType} />
        <button
          onClick={onToggleLive}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
            liveOn
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200"
          }`}
        >
          <span
            className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
              liveOn ? "bg-emerald-400" : "bg-slate-500"
            }`}
          >
            {liveOn ? (
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
            ) : null}
          </span>
          {liveOn ? "Live" : "Paused"}
        </button>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-slate-100"
        >
          ↻ Refresh
        </button>
      </div>
    </header>
  );
}
