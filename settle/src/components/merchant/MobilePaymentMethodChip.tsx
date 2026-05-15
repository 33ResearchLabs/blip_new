"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Wallet as WalletIcon,
  CreditCard,
  DollarSign,
  Smartphone,
  ChevronDown,
  Plus,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import type { PaymentMethod } from "@/components/merchant/PaymentMethodModal";

// "Default payment" chip for the merchant Home view.
//
// Behaviour:
//   • No methods configured → "+ Add payment method" button that routes
//     to Settings → Payments where the rich add/edit/delete UI lives.
//   • One or more methods   → tappable summary pill showing the current
//     default. Tapping the chip expands it inline to reveal the method's
//     details (type-aware: bank account, mobile number, wallet address,
//     etc.). The expanded view exposes a "View more" button that routes
//     to Settings → Payments for full management. We deliberately keep
//     the switch-default flow out of the chip — Settings owns that — so
//     the chip stays a read-only summary surface.

const SETTINGS_PAYMENTS_HREF = "/merchant/settings?tab=payments";

interface MobilePaymentMethodChipProps {
  merchantId: string | null;
}

function iconFor(type: PaymentMethod["type"]) {
  switch (type) {
    case "bank":
      return Building2;
    case "cash":
      return DollarSign;
    case "crypto":
      return WalletIcon;
    case "card":
      return CreditCard;
    case "mobile":
      return Smartphone;
    default:
      return WalletIcon;
  }
}

// Type-aware label so the chip reads naturally for any method shape.
function typeLabel(type: PaymentMethod["type"]): string {
  switch (type) {
    case "bank":
      return "Bank";
    case "cash":
      return "Cash";
    case "crypto":
      return "Crypto Wallet";
    case "card":
      return "Card";
    case "mobile":
      return "Mobile Money";
    default:
      return type;
  }
}

// Pretty-print the method's `details` field for the expanded panel.
// Methods are stored with type-specific composition (see
// PaymentMethodModal's writers). We surface useful fields without
// leaking the full account number / wallet address — Settings shows
// the unmasked version. For long opaque strings (wallet addresses) we
// truncate the middle so the prefix/suffix the merchant uses to
// recognise the wallet is still visible.
function detailRows(method: PaymentMethod): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  switch (method.type) {
    case "bank": {
      // details = `${accountName} - ${accountNumber} (IBAN)`
      const ibanMatch = method.details.match(/\(([^)]+)\)\s*$/);
      const withoutIban = method.details.replace(/\s*\([^)]+\)\s*$/, "");
      const dashIdx = withoutIban.lastIndexOf(" - ");
      const accountName = dashIdx >= 0 ? withoutIban.slice(0, dashIdx).trim() : withoutIban.trim();
      const accountNumber = dashIdx >= 0 ? withoutIban.slice(dashIdx + 3).trim() : "";
      rows.push({ label: "Bank", value: method.name });
      if (accountName) rows.push({ label: "Holder", value: accountName });
      if (accountNumber) {
        const masked = accountNumber.length > 4
          ? `••••${accountNumber.slice(-4)}`
          : accountNumber;
        rows.push({ label: "Account", value: masked });
      }
      if (ibanMatch?.[1]) rows.push({ label: "IBAN", value: ibanMatch[1].trim() });
      break;
    }
    case "cash":
      rows.push({ label: "Location", value: method.details || "—" });
      break;
    case "crypto": {
      const addr = method.details;
      const short = addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
      rows.push({ label: "Address", value: short });
      break;
    }
    case "card": {
      // details = `${cardholderName} - **** ${last4}`
      const m = method.details.match(/^(.*?)\s*-\s*\*+\s*(\d{4})\s*$/);
      if (m) {
        rows.push({ label: "Holder", value: m[1].trim() });
        rows.push({ label: "Card", value: `•••• ${m[2]}` });
      } else {
        rows.push({ label: "Card", value: method.details });
      }
      break;
    }
    case "mobile": {
      rows.push({ label: "Provider", value: method.name });
      // Mask the middle of the phone number — keep country code + last 4.
      const num = method.details;
      const masked = num.length > 6
        ? `${num.slice(0, 3)}••••${num.slice(-4)}`
        : num;
      rows.push({ label: "Number", value: masked });
      break;
    }
  }
  return rows;
}

export function MobilePaymentMethodChip({ merchantId }: MobilePaymentMethodChipProps) {
  const router = useRouter();
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!merchantId) return;
    setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/merchant/me/payment-methods`);
      const json = await res.json();
      const data: PaymentMethod[] = json?.data ?? json ?? [];
      setMethods(Array.isArray(data) ? data : []);
    } catch {
      setMethods([]);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    load();
  }, [load]);

  const goToSettings = () => router.push(SETTINGS_PAYMENTS_HREF);

  // Empty state — no methods yet.
  if (!loading && methods && methods.length === 0) {
    return (
      <button
        onClick={goToSettings}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-foreground/15 hover:border-foreground/30 text-foreground/60 hover:text-foreground/80 transition-colors"
      >
        <Plus className="w-4 h-4" />
        <span className="text-[12px] font-semibold">Add payment method</span>
      </button>
    );
  }

  // Loading or hydrating — stable height so the layout doesn't shift.
  if (loading && !methods) {
    return (
      <div className="w-full h-[42px] rounded-xl bg-foreground/[0.03] border border-foreground/[0.06] flex items-center justify-center">
        <Loader2 className="w-3.5 h-3.5 text-foreground/30 animate-spin" />
      </div>
    );
  }

  if (!methods || methods.length === 0) return null;

  const active = methods.find((m) => m.is_default) ?? methods[0];
  const ActiveIcon = iconFor(active.type);
  const rows = detailRows(active);

  return (
    <div
      className={`w-full rounded-xl border transition-colors overflow-hidden ${
        expanded
          ? "bg-foreground/[0.05] border-foreground/[0.10]"
          : "bg-foreground/[0.04] border-foreground/[0.06]"
      }`}
    >
      {/* Summary row — always visible. Tapping toggles the expanded
          panel below; the chevron rotates to signal state. */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-foreground/[0.02] transition-colors"
        aria-expanded={expanded}
      >
        <div className="w-7 h-7 rounded-lg bg-foreground/[0.05] flex items-center justify-center shrink-0">
          <ActiveIcon className="w-3.5 h-3.5 text-foreground/70" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[9px] text-foreground/40 uppercase tracking-wider font-medium leading-none">
            Default payment · {typeLabel(active.type)}
          </p>
          <p className="text-[12px] font-semibold text-foreground truncate mt-0.5">
            {active.name}
          </p>
        </div>
        {methods.length > 1 && (
          <span className="text-[10px] text-foreground/40 font-mono shrink-0">
            +{methods.length - 1}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-foreground/40 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {/* Expanded panel — type-aware detail rows + View more CTA */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1">
              <div className="rounded-lg bg-background/40 border border-foreground/[0.06] p-2.5 space-y-1.5">
                {rows.length === 0 ? (
                  <p className="text-[11px] text-foreground/40 italic">
                    No details to show
                  </p>
                ) : (
                  rows.map((r) => (
                    <div
                      key={r.label}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="text-[9px] uppercase tracking-wider text-foreground/40 font-medium shrink-0">
                        {r.label}
                      </span>
                      <span className="text-[12px] text-foreground/85 font-medium tabular-nums truncate">
                        {r.value}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <button
                onClick={goToSettings}
                className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-primary/10 hover:bg-primary/15 border border-primary/20 text-primary text-[11px] font-semibold transition-colors"
              >
                <span>View more</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
