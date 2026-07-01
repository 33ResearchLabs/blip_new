"use client";

// Seller's receiving-account selector for the Lock Escrow flow. Presentational +
// single-select; the chosen account is the one the buyer is told to pay into.
// Accounts are grouped by kind (UPI / Bank / Other) with section headers. Themed
// via shared SurfaceTokens (reads in both the Lock Escrow modal and the
// OrderQuickView card model). Details are masked for display (maskAccountDetail).

import { Smartphone, Building2, Wallet, Plus, Loader2 } from "lucide-react";
import { maskAccountDetail } from "@/lib/mask";
import type { SurfaceTokens } from "@/components/shared/limits/types";

export interface RecvAccount {
  id: string;
  type: string;
  name: string;
  /** Freeform per merchant_payment_methods (string), or a structured object. */
  details: string | Record<string, string>;
  is_default?: boolean;
}

interface Props {
  methods: RecvAccount[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddNew: () => void;
  loading?: boolean;
  surfaces: SurfaceTokens;
  /** Inline validation error, e.g. "Please select a receiving account…". */
  error?: string | null;
  /** When set, renders a "Retry" affordance next to the error — used when the
   *  error is a load failure (vs. a validation message) that a refetch can fix. */
  onRetry?: () => void;
  className?: string;
  /** Header/CTA copy overrides (default to the Lock Escrow wording). The
   *  merchant-mobile full-screen Lock Escrow uses "Receive Payment In" etc. */
  title?: string;
  subtitle?: string;
  addLabel?: string;
  /** Compact rows (tighter padding + smaller tiles) for the merchant-mobile
   *  full-screen Lock Escrow. Defaults to the roomier modal sizing. */
  dense?: boolean;
}

export function detailString(d: RecvAccount["details"]): string {
  if (typeof d === "string") return d;
  if (!d) return "";
  return d.upi_id || d.vpa || d.iban || d.account_number || d.bank_name || "";
}

type GroupKey = "upi" | "bank" | "other";

const GROUP_LABEL: Record<GroupKey, string> = {
  upi: "UPI Accounts",
  bank: "Bank Accounts",
  other: "Other Accounts",
};

// Order sections appear in the list.
const GROUP_ORDER: GroupKey[] = ["upi", "bank", "other"];

/** Infer the account kind from its type + detail shape (data is freeform). */
function classify(a: RecvAccount): GroupKey {
  const t = (a.type || "").toLowerCase();
  const d = detailString(a.details).toLowerCase();
  if (t === "bank") return "bank";
  if (t === "card") return "other";
  if (d.includes("@")) return "upi";
  if (
    t === "upi" ||
    t === "mobile" ||
    t.includes("upi") ||
    t.includes("pay") ||
    t.includes("phonepe") ||
    t.includes("gpay")
  ) {
    return "upi";
  }
  // Long digit string → bank account number; short → phone-style UPI.
  const digits = d.replace(/\D/g, "");
  if (digits.length >= 11) return "bank";
  return "upi";
}

function AccountIcon({ group }: { group: GroupKey }) {
  if (group === "bank") return <Building2 className="w-4 h-4" />;
  if (group === "other") return <Wallet className="w-4 h-4" />;
  return <Smartphone className="w-4 h-4" />;
}

export function ReceivingAccountPicker({
  methods,
  selectedId,
  onSelect,
  onAddNew,
  loading,
  surfaces,
  error,
  onRetry,
  className = "",
  title = "Select Receiving Account",
  subtitle = "Buyer will pay to the account you select below.",
  addLabel = "Add New Account",
  dense = false,
}: Props) {
  // Group while preserving the server order within each group.
  const groups = GROUP_ORDER.map((key) => ({
    key,
    items: methods.filter((m) => classify(m) === key),
  })).filter((g) => g.items.length > 0);

  return (
    <div className={`rounded-2xl border ${error ? "border-error" : "border-border-subtle"} ${surfaces.card} ${dense ? "p-3" : "p-4"} ${className}`}>
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className={`text-[11px] text-text-tertiary mt-0.5 ${dense ? "mb-2" : "mb-3"}`}>
        {subtitle}
      </p>

      {loading && methods.length === 0 ? (
        <div className="flex items-center gap-2 py-2">
          <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
          <span className="text-[12px] text-text-tertiary">Loading your accounts…</span>
        </div>
      ) : methods.length === 0 ? (
        <p className="text-[12px] text-text-tertiary">
          No saved accounts yet — add one to lock escrow.
        </p>
      ) : (
        <div className={dense ? "space-y-3" : "space-y-4"} role="radiogroup" aria-label="Receiving account">
          {groups.map((group) => (
            <div key={group.key} className={dense ? "space-y-1.5" : "space-y-2"}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
                {GROUP_LABEL[group.key]}
              </p>
              {group.items.map((a) => {
                const selected = selectedId === a.id;
                const masked = maskAccountDetail(a.type, detailString(a.details));
                // Masked identifier headlines the row; the account name (nickname /
                // bank) is the subtitle. Fall back to name when there's no detail.
                const title = masked || a.name;
                const subtitle = masked ? a.name : "";
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onSelect(a.id)}
                    className={`w-full flex items-center ${dense ? "gap-2.5 p-2" : "gap-3 p-3"} rounded-xl border text-left transition-colors ${
                      selected
                        ? "border-accent bg-accent/10"
                        : `border-border-subtle ${surfaces.inset} ${surfaces.hover}`
                    }`}
                  >
                    <div
                      className={`${dense ? "w-8 h-8" : "w-9 h-9"} rounded-lg flex items-center justify-center shrink-0 ${
                        selected ? "bg-accent/15 text-accent-text" : `${surfaces.chip} text-text-secondary`
                      }`}
                    >
                      <AccountIcon group={group.key} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-text-primary truncate font-mono">{title}</p>
                      {subtitle && (
                        <p className="text-[11px] text-text-tertiary truncate">{subtitle}</p>
                      )}
                    </div>
                    {a.is_default && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-success-dim text-success shrink-0">
                        Recommended
                      </span>
                    )}
                    <span
                      className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                        selected ? "border-accent" : "border-border-medium"
                      }`}
                    >
                      {selected && <span className="w-2 h-2 rounded-full bg-accent" />}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 mt-2">
          <p className="text-[11px] text-error">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="text-[11px] font-semibold text-accent-text underline underline-offset-2"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onAddNew}
        className={`${dense ? "mt-2 py-2" : "mt-3 py-2.5"} w-full rounded-xl border border-dashed border-border-medium flex items-center justify-center gap-1.5 text-[13px] font-medium text-text-secondary ${surfaces.hover} transition-colors`}
      >
        <Plus className="w-4 h-4" />
        {addLabel}
      </button>
    </div>
  );
}
