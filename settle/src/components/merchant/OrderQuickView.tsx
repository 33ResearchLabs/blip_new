"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Shield,
  Lock,
  Clock,
  MessageCircle,
  Smartphone,
  Building2,
  CreditCard,
  Zap,
  ExternalLink,
  Loader2,
  Copy,
  Hourglass,
  Users,
  User,
  ChevronRight,
  Banknote,
  Coins,
  Info,
  Wallet,
  FileText,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  Headphones,
  RotateCw,
  Star,
  Lightbulb,
  Flag,
} from "lucide-react";
import {
  useState as useLocalState,
  useEffect as useLocalEffect,
  useRef as useLocalRef,
  Fragment,
} from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
// Backend-driven: action buttons read from dbOrder.primaryAction/secondaryAction
import type { Order } from "@/types/merchant";
import { CopyableBankDetails } from "@/components/shared/CopyableBankDetails";
import { ReceivingAccountPicker, detailString } from "@/components/shared/trade/ReceivingAccountPicker";
import { useMerchantReceivingMethods } from "@/components/shared/trade/useMerchantReceivingMethods";
import { maskAccountDetail } from "@/lib/mask";
import { SURFACES } from "@/components/shared/limits/types";

/** Map fiat currency code to display symbol */
function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "د.إ";
    default: return (code || "AED").toUpperCase();
  }
}

// Inline component for non-bank locked payment methods (UPI, Cash, Other)
function LockedPaymentMethodCard({
  lpm,
  amount,
  typeIcon,
  currency,
}: {
  lpm: { type: string; label: string; details: Record<string, string> };
  amount: number;
  typeIcon: React.ReactNode;
  currency?: string;
}) {
  const [copiedKey, setCopiedKey] = useLocalState<string | null>(null);
  const copyField = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fields: {
    label: string;
    value: string;
    key: string;
    mono?: boolean;
  }[] = [];
  if (lpm.type === "upi") {
    if (lpm.details.upi_id)
      fields.push({
        label: "UPI ID",
        value: lpm.details.upi_id,
        key: "upi_id",
        mono: true,
      });
    if (lpm.details.provider)
      fields.push({
        label: "Provider",
        value: lpm.details.provider,
        key: "provider",
      });
  } else if (lpm.type === "cash") {
    if (lpm.details.location_name)
      fields.push({
        label: "Location",
        value: lpm.details.location_name,
        key: "location",
      });
    if (lpm.details.location_address)
      fields.push({
        label: "Address",
        value: lpm.details.location_address,
        key: "address",
      });
    if (lpm.details.meeting_instructions)
      fields.push({
        label: "Instructions",
        value: lpm.details.meeting_instructions,
        key: "instructions",
      });
  } else {
    if (lpm.details.method_name)
      fields.push({
        label: "Method",
        value: lpm.details.method_name,
        key: "method",
      });
    if (lpm.details.account_identifier)
      fields.push({
        label: "Account",
        value: lpm.details.account_identifier,
        key: "account",
        mono: true,
      });
    if (lpm.details.instructions)
      fields.push({
        label: "Instructions",
        value: lpm.details.instructions,
        key: "instructions",
      });
  }

  return (
    <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 text-[#f5f5f7]" />
        <span className="text-[11px] text-[#f5f5f7] uppercase tracking-wide font-bold">
          Send {currency || 'AED'} Here
        </span>
      </div>
      <div className="flex items-center gap-2">
        {typeIcon}
        <span className="text-sm text-foreground font-medium">{lpm.label}</span>
        <span className="text-[10px] text-foreground/30 uppercase">
          {lpm.type}
        </span>
      </div>
      {fields.map(({ label, value, key, mono }) => (
        <div key={key} className="flex justify-between items-center">
          <span className="text-foreground/50 text-sm">{label}</span>
          <button
            onClick={() => copyField(value, key)}
            className="flex items-center gap-1 text-foreground hover:text-foreground/70 transition-colors"
          >
            <span className={`text-sm ${mono ? "font-mono" : ""}`}>
              {value}
            </span>
            {copiedKey === key ? (
              <Check className="w-3 h-3 text-[#f5f5f7]" />
            ) : (
              <Copy className="w-3 h-3 text-foreground/30" />
            )}
          </button>
        </div>
      ))}
      <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.04]">
        <span className="text-foreground/50 text-sm">Amount</span>
        <span className="text-base font-semibold text-foreground">
          {fiatSymbol(currency)} {amount.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// Shown to a merchant viewing their OWN pending BUY order (broadcast). Before a
// seller accepts there is no destination account yet, so we surface the payment
// rails the merchant chose at order time (buyer_payment_types). Accent-themed
// (var(--accent)) — deliberately NO hardcoded purple.
function BuyerPayTypesCard({ types }: { types: string[] }) {
  const META: Record<string, { label: string; Icon: typeof Building2 }> = {
    bank: { label: "Bank Transfer", Icon: Building2 },
    upi: { label: "UPI", Icon: Smartphone },
    cash: { label: "Cash", Icon: Banknote },
  };
  return (
    <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
      <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
        Payment Method (You Will Pay Using)
      </span>
      <div className="flex flex-wrap gap-2">
        {types.map((t) => {
          const m = META[t] ?? { label: t.toUpperCase(), Icon: CreditCard };
          const Icon = m.Icon;
          return (
            <div
              key={t}
              className="flex items-center gap-2 pr-3.5 rounded-full bg-foreground/[0.04] border border-foreground/[0.06]"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center">
                <Icon className="w-4 h-4 text-[var(--accent)]" />
              </div>
              <span className="text-sm font-medium text-foreground">
                {m.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-start gap-2 pt-2 border-t border-foreground/[0.04]">
        <Info className="w-3.5 h-3.5 text-foreground/30 mt-0.5 shrink-0" />
        <p className="text-xs text-foreground/40">
          You can pay using any of the above methods after a merchant accepts.
        </p>
      </div>
    </div>
  );
}

// "What happens next" for a broadcast BUY order, from the buyer's perspective.
const BUY_FLOW_STEPS: { label: string; Icon: typeof User }[] = [
  { label: "Waiting for\nMerchant", Icon: User },
  { label: "Merchant\nAccepts", Icon: Users },
  { label: "Escrow\nLocked", Icon: Lock },
  { label: "You Pay\nFiat", Icon: Banknote },
  { label: "USDT\nReleased", Icon: Coins },
];

// Status + 5-step progress shown on a merchant's OWN pending BUY order.
function OpenMarketWaitingCard({
  createdAt,
  expiresAt,
  currentStep = 0,
}: {
  createdAt?: string | Date | null;
  expiresAt?: string | Date | null;
  currentStep?: number;
}) {
  const [now, setNow] = useLocalState(() => Date.now());
  useLocalEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const expiryMs = expiresAt ? new Date(expiresAt).getTime() : 0;
  const remaining = Math.max(0, Math.floor((expiryMs - now) / 1000));
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const createdLabel = createdAt
    ? new Date(createdAt).toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  return (
    <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-full border-2 border-[var(--accent)]/40 flex items-center justify-center shrink-0">
          <Hourglass className="w-5 h-5 text-[var(--accent)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-foreground leading-snug">
              Open Market – Waiting for Merchant Acceptance
            </p>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] shrink-0 whitespace-nowrap">
              Step {currentStep + 1} of {BUY_FLOW_STEPS.length}
            </span>
          </div>
          <p className="text-xs text-foreground/45 mt-1 leading-relaxed">
            Your order is visible to all merchants. Once a merchant accepts, they
            will lock USDT in escrow and provide payment details.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 text-[11px]">
        <span className="flex items-center gap-1 text-foreground/40">
          <Clock className="w-3 h-3" /> Order expires in{" "}
          {expiryMs > 0 && (
            <span className="text-[var(--accent)] font-mono font-bold">
              {mm}:{ss}
            </span>
          )}
        </span>
        {createdLabel && (
          <span className="text-foreground/30">Created on {createdLabel}</span>
        )}
      </div>

      <div className="pt-3 border-t border-foreground/[0.04]">
        <p className="text-[10px] text-foreground/35 uppercase tracking-wide font-bold mb-3">
          What happens next
        </p>
        <div className="flex items-start justify-between">
          {BUY_FLOW_STEPS.map((s, i) => {
            const active = i <= currentStep;
            const Icon = s.Icon;
            return (
              <Fragment key={i}>
                <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center ${
                      active
                        ? "bg-[var(--accent)] text-[var(--accent-text)]"
                        : "bg-foreground/[0.04] text-foreground/30 border border-foreground/[0.06]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span
                    className={`text-[9px] text-center leading-tight whitespace-pre-line ${
                      active ? "text-foreground/70" : "text-foreground/30"
                    }`}
                  >
                    {`${i + 1}. ${s.label}`}
                  </span>
                </div>
                {i < BUY_FLOW_STEPS.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-foreground/15 mt-3 shrink-0" />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Seller's view of a NEW pending BUY order they can accept (someone else placed
// it). The mirror of the buyer-side modal: the buyer's chosen rails, the
// buyer's trust, and the steps that follow acceptance. Accent-themed
// (var(--accent)) — no purple; the green Accept CTA lives in the action row.
/** Relative "last seen" label from an ISO timestamp. */
function formatLastSeen(iso: string | null, now: number): string {
  if (!iso) return "a while ago";
  const diff = now - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Live presence for one order participant — mirrors OrderDetailsPanel's poll
 *  of GET /api/orders/[id]/presence. Returns {isOnline, lastSeen}; best-effort. */
function useCounterpartyPresence(
  orderId: string | undefined,
  actorType: string | null,
  actorId: string | null,
): { isOnline: boolean; lastSeen: string | null } {
  const [member, setMember] = useLocalState<{ isOnline: boolean; lastSeen: string | null } | null>(null);
  useLocalEffect(() => {
    if (!orderId || !actorType || !actorId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}/presence`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.success) return;
        const found = (data.data?.members || []).find(
          (m: { actorType: string; actorId: string }) =>
            m.actorType === actorType && m.actorId === actorId,
        );
        setMember(
          found
            ? { isOnline: !!found.isOnline, lastSeen: found.lastSeen ?? null }
            : { isOnline: false, lastSeen: null },
        );
      } catch {
        /* best-effort presence */
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId, actorType, actorId]);
  return { isOnline: !!member?.isOnline, lastSeen: member?.lastSeen ?? null };
}

/** Status (online/last-seen) + rating stars + copyable wallet rows, shared by
 *  the acceptor and active counterparty trust cards. */
function PresenceRatingWalletRows({
  online,
  lastSeen,
  now,
  ratingNum,
  wallet,
}: {
  online: boolean;
  lastSeen: string | null;
  now: number;
  ratingNum: number | null;
  wallet: string | null;
}) {
  const [copied, setCopied] = useLocalState(false);
  return (
    <>
      <div className="flex justify-between gap-2 items-center">
        <span className="text-foreground/45">Status</span>
        <span className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-foreground/30"}`} />
          <span className={`font-semibold ${online ? "text-emerald-400" : "text-foreground/60"}`}>
            {online ? "Online" : lastSeen ? `last seen ${formatLastSeen(lastSeen, now)}` : "Offline"}
          </span>
        </span>
      </div>
      {ratingNum != null && (
        <div className="flex justify-between gap-2 items-center">
          <span className="text-foreground/45">Rating</span>
          <span className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star
                key={i}
                className={`w-3 h-3 ${i <= Math.round(ratingNum) ? "text-amber-400 fill-amber-400" : "text-foreground/20"}`}
              />
            ))}
            <span className="font-semibold text-foreground/80 ml-1">{ratingNum.toFixed(1)}</span>
          </span>
        </div>
      )}
      {wallet && (
        <div className="flex justify-between gap-2 items-center">
          <span className="text-foreground/45">Wallet</span>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(wallet);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex items-center gap-1 font-mono text-foreground/70 hover:text-foreground transition-colors"
          >
            {wallet.slice(0, 4)}…{wallet.slice(-4)}
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}
    </>
  );
}

function AcceptorBuyOrderBody({
  order,
  db,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
}) {
  const [now, setNow] = useLocalState(() => Date.now());
  useLocalEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const countdown = (target: string | undefined) => {
    if (!target) return null;
    const r = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
    return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
  };

  const PM_META: Record<string, { label: string; Icon: typeof Building2 }> = {
    bank: { label: "Bank Transfer", Icon: Building2 },
    upi: { label: "UPI", Icon: Smartphone },
    cash: { label: "Cash", Icon: Banknote },
  };
  const types: string[] = Array.isArray(db.buyer_payment_types)
    ? db.buyer_payment_types
    : [];
  // No "preferred" flag in the model — treat the first chosen rail as preferred.
  const preferred = types[0];

  const ccy = order.toCurrency || "AED";
  const sym = fiatSymbol(ccy);
  const total = Math.round(order.total || 0);

  const buyer = db.user || {};
  const trades = buyer.total_trades ?? 0;
  const disputes = buyer.dispute_count ?? 0;
  const verified = !!buyer.is_verified;
  const ratingNum = typeof buyer.rating === "number" ? buyer.rating : null;
  // Rating is 0-5; surface as an x/100 trust score when present.
  const trustScore =
    ratingNum != null && ratingNum > 0 ? Math.round((ratingNum / 5) * 100) : null;
  // Success rate from completed vs disputed trades; null (→ hidden) when none.
  const successRate =
    trades > 0 ? Math.round(((trades - disputes) / trades) * 100) : null;
  // Account age from the buyer's join date.
  const ageLabel = (() => {
    const iso = buyer.account_created_at;
    if (!iso) return null;
    const months = Math.floor(
      (now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30.44),
    );
    if (months < 1) return "New";
    if (months < 12) return `${months} Month${months > 1 ? "s" : ""}`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem ? `${years}y ${rem}m` : `${years} Year${years > 1 ? "s" : ""}`;
  })();

  // Live presence + identity extras for the buyer (online/last-seen, rating,
  // wallet) so the merchant has full counterparty context inline.
  const presence = useCounterpartyPresence(
    db.id,
    db.buyer_merchant_id ? "merchant" : "user",
    db.buyer_merchant_id || db.user_id || null,
  );
  const online = presence.isOnline || !!buyer.is_online;
  const buyerWallet: string | null =
    buyer.wallet_address || db.buyer_wallet_address || null;

  const createdLabel = db.created_at
    ? new Date(db.created_at).toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const orderIdShort =
    typeof db.id === "string" ? `BLP-${db.id.slice(0, 8).toUpperCase()}` : "—";

  const expiresIn = countdown(db.expires_at);

  const STEPS: { label: string; Icon: typeof Wallet }[] = [
    { label: "Select Receiving\nAccount", Icon: Wallet },
    { label: "Lock USDT\nin Escrow", Icon: Lock },
    { label: "Buyer Receives\nPayment Details", Icon: FileText },
    { label: `Buyer Sends\n${ccy} Payment`, Icon: Banknote },
    { label: "You Confirm &\nUSDT Released", Icon: CheckCircle2 },
  ];

  return (
    <>
      {/* Banner */}
      <div className="rounded-xl border border-[var(--accent)]/20 bg-[var(--accent)]/[0.06] p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
          <Users className="w-4 h-4 text-[var(--accent)]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--accent)]">
            A user has placed a buy order in the open market.
          </p>
          <p className="text-xs text-foreground/45 mt-0.5">
            Accept the order to lock USDT in escrow and provide payment details.
          </p>
        </div>
      </div>

      {/* Order Summary + Buyer Payment Method (2-col on desktop, stacked on mobile) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
          <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
            Order Summary
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">{order.amount}</span>
            <span className="text-sm font-semibold text-foreground/60">USDT</span>
          </div>
          <div className="text-lg font-bold text-foreground">
            {sym} {total.toLocaleString()}{" "}
            <span className="text-xs font-medium text-foreground/40">{ccy}</span>
          </div>
          <div className="pt-2 border-t border-foreground/[0.04] space-y-1.5 text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-foreground/40">Rate (Locked)</span>
              <span className="font-mono text-foreground/70">
                1 USDT = {order.rate} {ccy}
              </span>
            </div>
            {expiresIn && (
              <div className="flex justify-between gap-2">
                <span className="text-foreground/40">Order Expires In</span>
                <span className="font-mono text-amber-400 font-bold">{expiresIn}</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span className="text-foreground/40">Order ID</span>
              <span className="font-mono text-foreground/60 truncate">{orderIdShort}</span>
            </div>
            {createdLabel && (
              <div className="flex justify-between gap-2">
                <span className="text-foreground/40">Created</span>
                <span className="text-foreground/60">{createdLabel}</span>
              </div>
            )}
          </div>
        </div>

        <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
          <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
            Buyer Payment Method
          </span>
          <div className="space-y-2.5">
            {types.map((t) => {
              const m = PM_META[t] ?? { label: t.toUpperCase(), Icon: CreditCard };
              const Icon = m.Icon;
              return (
                <div key={t} className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-[var(--accent)]" />
                  </div>
                  <span className="text-sm font-medium text-foreground flex-1">
                    {m.label}
                  </span>
                  <Check className="w-4 h-4 text-emerald-400" strokeWidth={3} />
                </div>
              );
            })}
          </div>
          {preferred && (
            <div className="pt-2 border-t border-foreground/[0.04]">
              <p className="text-[11px] text-foreground/40 mb-1">Preferred Method</p>
              <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] uppercase">
                {PM_META[preferred]?.label ?? preferred}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Buyer Trust */}
      <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span className="text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
            Buyer Trust
          </span>
          {trustScore != null && (
            <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
              {trustScore}/100
            </span>
          )}
        </div>
        <div className="space-y-1.5 text-[12px]">
          <div className="flex justify-between gap-2">
            <span className="text-foreground/45">Completed Trades</span>
            <span className="font-semibold text-foreground/80">{trades}</span>
          </div>
          <PresenceRatingWalletRows
            online={online}
            lastSeen={presence.lastSeen}
            now={now}
            ratingNum={ratingNum}
            wallet={buyerWallet}
          />
          {successRate != null && (
            <div className="flex justify-between gap-2">
              <span className="text-foreground/45">Success Rate</span>
              <span className="font-semibold text-emerald-400">{successRate}%</span>
            </div>
          )}
          {ageLabel && (
            <div className="flex justify-between gap-2">
              <span className="text-foreground/45">Account Age</span>
              <span className="font-semibold text-foreground/80">{ageLabel}</span>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <span className="text-foreground/45">KYC Status</span>
            <span className={`font-semibold ${verified ? "text-emerald-400" : "text-foreground/50"}`}>
              {verified ? "Verified" : "Unverified"}
            </span>
          </div>
        </div>
      </div>

      {/* After you accept */}
      <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
        <p className="text-[10px] text-foreground/35 uppercase tracking-wide font-bold mb-3">
          After you accept this order
        </p>
        <div className="flex items-start justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.Icon;
            return (
              <Fragment key={i}>
                <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-[var(--accent)]/15 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-[var(--accent)]" />
                  </div>
                  <span className="text-[9px] text-center leading-tight whitespace-pre-line text-foreground/45">
                    {`${i + 1}. ${s.label}`}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-foreground/15 mt-3 shrink-0" />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Escrow Protection */}
      <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-[var(--accent)]" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Escrow Protection</p>
          <p className="text-xs text-foreground/45 mt-0.5">
            Your USDT will be securely locked in escrow. Release happens only
            after you confirm you have received the payment.
          </p>
        </div>
      </div>
    </>
  );
}

// Merchant's view of an IN-PROGRESS order they're party to (accepted →
// escrowed → payment_sent). Mirrors AcceptorBuyOrderBody's rich layout but is
// driven by a per-status STAGE map so every active stage reuses ONE design:
// the stepper highlights the current step and the banner adapts. The actual
// CTA (Lock Escrow / Confirm Payment / I've Paid) is rendered by the
// backend-driven footer below — this body is presentation only.
function ActiveOrderBody({
  order,
  db,
  role,
  onRecvSelectionChange,
  onWaitingTimeout,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  role: "buyer" | "seller";
  /** Reports the effective receiving account up so the footer can lock with it. */
  onRecvSelectionChange?: (methodId: string | null) => void;
  /** Reports when a seller's waiting stage (escrowed/payment_sent) has passed
   *  its deadline, so the footer can surface Need Help / Raise Appeal. */
  onWaitingTimeout?: (timedOut: boolean) => void;
}) {
  const [now, setNow] = useLocalState(() => Date.now());
  const [copiedId, setCopiedId] = useLocalState(false);
  useLocalEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isSeller = role === "seller";
  const ccy = order.toCurrency || "AED";
  const sym = fiatSymbol(ccy);
  const amount = order.amount;
  const total = Math.round(order.total || 0);
  const status = String(db.status || db.minimal_status || "").toLowerCase();

  const countdown = (target: string | undefined) => {
    if (!target) return null;
    const r = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
    return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}`;
  };
  const expiresIn = countdown(db.expires_at);

  // Seller is waiting for the buyer (escrow locked / payment marked) and the
  // order's deadline has passed → surface Need Help / Raise Appeal in the
  // footer. Uses the ticking `now` so it flips live without impure render math.
  const isWaitingStage =
    isSeller && (status === "escrowed" || status === "payment_sent");
  const isWaitingTimedOut =
    isWaitingStage &&
    !!db.expires_at &&
    new Date(db.expires_at).getTime() - now <= 0;
  useLocalEffect(() => {
    onWaitingTimeout?.(isWaitingTimedOut);
  }, [isWaitingTimedOut, onWaitingTimeout]);

  const createdLabel = db.created_at
    ? new Date(db.created_at).toLocaleString("en-US", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";
  const orderIdShort =
    typeof db.id === "string" ? `BLP-${db.id.slice(0, 8).toUpperCase()}` : "—";

  // ---- progress stepper ----
  const STEPS: { label: string; Icon: typeof Lock }[] = isSeller
    ? [
        { label: "Accepted", Icon: Check },
        { label: "Lock Escrow", Icon: Lock },
        { label: "Buyer Pays", Icon: Banknote },
        { label: "Verify Payment", Icon: ShieldCheck },
        { label: "Release USDT", Icon: Coins },
      ]
    : [
        { label: "Accepted", Icon: Check },
        { label: "Seller Locks", Icon: Lock },
        { label: "You Pay", Icon: Banknote },
        { label: "Seller Verifies", Icon: ShieldCheck },
        { label: "USDT Released", Icon: Coins },
      ];
  const STEP_BY_STATUS: Record<string, number> = {
    accepted: 1,
    escrowed: 2,
    payment_sent: 3,
    completed: 4,
  };
  const currentStep = STEP_BY_STATUS[status] ?? 1;

  // ---- action / status banner (per stage + role) ----
  const banner = (() => {
    if (isSeller) {
      if (status === "accepted")
        return { heading: "Action Required", title: `Lock ${amount} USDT in escrow to start the trade.`, sub: "Buyer cannot send payment until escrow is locked.", Icon: Hourglass, urgent: true };
      if (status === "escrowed")
        return { heading: "Escrow Locked", title: "Waiting for the buyer to send payment.", sub: "You'll be notified the moment they mark it as paid.", Icon: Clock, urgent: false };
      if (status === "payment_sent")
        return { heading: "Action Required", title: `Buyer marked the ${ccy} payment as sent.`, sub: "Verify it landed in your account, then release the USDT.", Icon: ShieldCheck, urgent: true };
    } else {
      if (status === "accepted")
        return { heading: "Please Wait", title: "Seller is locking USDT in escrow.", sub: `You can send ${ccy} once escrow is locked.`, Icon: Clock, urgent: false };
      if (status === "escrowed")
        return { heading: "Action Required", title: `Send ${sym}${total.toLocaleString()} to the seller.`, sub: "Mark the payment as sent once you've paid.", Icon: Banknote, urgent: true };
      if (status === "payment_sent")
        return { heading: "Please Wait", title: "Seller is verifying your payment.", sub: "USDT will be released to you once confirmed.", Icon: Clock, urgent: false };
    }
    return { heading: "In Progress", title: "Trade in progress.", sub: "", Icon: Clock, urgent: false };
  })();
  const BannerIcon = banner.Icon;

  // ---- counterparty trust (the buyer, when we're the seller) ----
  const cp = db.user || {};
  const trades = cp.total_trades ?? 0;
  const disputes = cp.dispute_count ?? 0;
  const verified = !!cp.is_verified;
  const ratingNum = typeof cp.rating === "number" ? cp.rating : null;
  const trustScore =
    ratingNum != null && ratingNum > 0 ? Math.round((ratingNum / 5) * 100) : null;
  const successRate =
    trades > 0 ? Math.round(((trades - disputes) / trades) * 100) : null;
  const ageLabel = (() => {
    const iso = cp.account_created_at;
    if (!iso) return null;
    const months = Math.floor(
      (now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24 * 30.44),
    );
    if (months < 1) return "New";
    if (months < 12) return `${months} Month${months > 1 ? "s" : ""}`;
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem ? `${years}y ${rem}m` : `${years} Year${years > 1 ? "s" : ""}`;
  })();

  // Live presence + identity extras for the counterparty (online/last-seen,
  // rating, wallet) so the merchant has full context inline.
  const presence = useCounterpartyPresence(db.id, "user", db.user_id || null);
  const online = presence.isOnline || !!cp.is_online;
  const cpWallet: string | null =
    cp.wallet_address || db.buyer_wallet_address || null;

  // Merchant's own receiving accounts — shown at the lock stage so the seller
  // picks where the buyer pays (mirrors the Lock Escrow modal).
  const needsLock = isSeller && status === "accepted";
  const recv = useMerchantReceivingMethods(needsLock);
  const [recvPickedId, setRecvPickedId] = useLocalState<string | null>(null);
  const recvSelectedId =
    recvPickedId ??
    (recv.methods.find((m) => m.is_default)?.id ?? recv.methods[0]?.id ?? null);

  // Bubble the effective receiving account up to the popup footer so its
  // "Lock Escrow" button locks into the account the seller selected here.
  useLocalEffect(() => {
    onRecvSelectionChange?.(recvSelectedId);
  }, [recvSelectedId, onRecvSelectionChange]);

  // ---- counterparty payment rails ----
  const PM_META: Record<string, { label: string; Icon: typeof Building2 }> = {
    bank: { label: "Bank Transfer", Icon: Building2 },
    upi: { label: "UPI", Icon: Smartphone },
    cash: { label: "Cash", Icon: Banknote },
  };
  const payTypes: string[] = Array.isArray(db.buyer_payment_types)
    ? db.buyer_payment_types
    : [];
  const preferred = payTypes[0];
  const pmHeading = isSeller ? "Buyer Payment Method" : "Seller Payment Method";
  const trustHeading = isSeller ? "Buyer Trust" : "Seller Trust";

  // Buyer/seller payment-method card. Rendered in the right column normally,
  // but moved to the left column at the lock stage to balance the layout (the
  // right column then holds the Tips / Important / What-happens-next cards).
  const paymentMethodCard = (
    <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
      <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
        {pmHeading}
      </span>
      {payTypes.length > 0 ? (
        <div className="space-y-2.5">
          {payTypes.map((t) => {
            const m = PM_META[t] ?? { label: t.toUpperCase(), Icon: CreditCard };
            const Icon = m.Icon;
            return (
              <div key={t} className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[var(--accent)]" />
                </div>
                <span className="text-sm font-medium text-foreground flex-1">
                  {m.label}
                </span>
                <Check className="w-4 h-4 text-emerald-400" strokeWidth={3} />
              </div>
            );
          })}
          {preferred && (
            <div className="pt-2 border-t border-foreground/[0.04]">
              <p className="text-[11px] text-foreground/40 mb-1">Preferred Method</p>
              <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] uppercase">
                {PM_META[preferred]?.label ?? preferred}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-foreground/40">
          Shared in chat once escrow is locked.
        </p>
      )}
    </div>
  );

  return (
    <>
      {/* Action / status banner */}
      <div
        className={`rounded-xl border p-4 ${
          banner.urgent
            ? "border-foreground/[0.10] bg-foreground/[0.03]"
            : "border-foreground/[0.06] bg-foreground/[0.02]"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-11 h-11 rounded-full border-2 flex items-center justify-center shrink-0 ${
              banner.urgent ? "border-foreground/25" : "border-foreground/15"
            }`}
          >
            <BannerIcon
              className={`w-5 h-5 ${banner.urgent ? "text-foreground/70" : "text-foreground/50"}`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p
                className={`text-sm font-bold ${banner.urgent ? "text-foreground" : "text-foreground/70"}`}
              >
                {banner.heading}
              </p>
              {expiresIn && (
                <span className="flex items-center gap-1 text-[11px] text-foreground/40 shrink-0 whitespace-nowrap">
                  <Clock className="w-3 h-3" /> Expires in{" "}
                  <span className="font-mono font-bold text-foreground/70">{expiresIn}</span>
                </span>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground mt-0.5 leading-snug">
              {banner.title}
            </p>
            {banner.sub && (
              <p className="text-xs text-foreground/45 mt-0.5">{banner.sub}</p>
            )}
          </div>
        </div>
      </div>

      {/* Progress stepper */}
      <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
        <div className="flex items-start justify-between">
          {STEPS.map((s, i) => {
            const done = i < currentStep;
            const current = i === currentStep;
            const Icon = s.Icon;
            return (
              <Fragment key={i}>
                <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                      done
                        ? "bg-emerald-500 text-white"
                        : current
                          ? "bg-[#f5f5f7] text-black"
                          : "bg-foreground/[0.04] text-foreground/30 border border-foreground/[0.06]"
                    }`}
                  >
                    {done ? <Check className="w-4 h-4" strokeWidth={3} /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span
                    className={`text-[9px] text-center leading-tight ${
                      done
                        ? "text-foreground/60"
                        : current
                          ? "text-foreground font-semibold"
                          : "text-foreground/30"
                    }`}
                  >
                    {s.label}
                  </span>
                  {current && (
                    <span className="text-[8px] text-foreground/60 font-bold uppercase tracking-wide">
                      Current
                    </span>
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight
                    className={`w-3 h-3 mt-3 shrink-0 ${i < currentStep ? "text-emerald-500/50" : "text-foreground/15"}`}
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* Two-column: order summary + counterparty payment/trust */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Left column */}
        <div className="space-y-3">
          <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
            <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
              Order Summary
            </span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-foreground">{amount}</span>
              <span className="text-sm font-semibold text-foreground/60">USDT</span>
              <Coins className="w-4 h-4 text-emerald-400/70" />
            </div>
            <div className="text-lg font-bold text-foreground">
              {sym} {total.toLocaleString()}{" "}
              <span className="text-xs font-medium text-foreground/40">{ccy}</span>
            </div>
            <div className="pt-2 border-t border-foreground/[0.04] space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="text-foreground/40 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Rate (Locked)
                </span>
                <span className="font-mono text-foreground/70">
                  1 USDT = {order.rate} {ccy}
                </span>
              </div>
              {expiresIn && (
                <div className="flex justify-between gap-2">
                  <span className="text-foreground/40">Rate Locked For</span>
                  <span className="font-mono text-emerald-400 font-bold">{expiresIn}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-foreground/40">Order ID</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(orderIdShort);
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 2000);
                  }}
                  className="flex items-center gap-1 font-mono text-foreground/60 hover:text-foreground/80 transition-colors max-w-[60%]"
                >
                  <span className="truncate">{orderIdShort}</span>
                  {copiedId ? (
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 text-foreground/30 shrink-0" />
                  )}
                </button>
              </div>
              {createdLabel && (
                <div className="flex justify-between gap-2">
                  <span className="text-foreground/40">Created At</span>
                  <span className="text-foreground/60">{createdLabel}</span>
                </div>
              )}
            </div>
          </div>

          {/* Select Receiving Account — seller picks where the buyer pays (lock stage) */}
          {needsLock && (
            <ReceivingAccountPicker
              methods={recv.methods}
              selectedId={recvSelectedId}
              onSelect={setRecvPickedId}
              onAddNew={() => {
                window.location.href = "/market/settings";
              }}
              loading={recv.loading}
              surfaces={SURFACES.merchant}
            />
          )}

          {/* Buyer payment method — moved here from the right column at the lock
              stage to keep the two columns balanced. */}
          {needsLock && paymentMethodCard}

          {/* Your chosen receiving account — read-only after escrow is locked, so
              the seller can see which of their accounts the buyer was told to pay
              into (picked at lock time, persisted as sellerPaymentMethod). */}
          {isSeller &&
            (status === "escrowed" || status === "payment_sent") &&
            order.sellerPaymentMethod &&
            (() => {
              const m = order.sellerPaymentMethod;
              const masked = maskAccountDetail(m.type, detailString(m.details));
              const t = (m.type || "").toLowerCase();
              const RecvIcon = t === "bank" ? Building2 : t === "card" ? CreditCard : Smartphone;
              return (
                <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
                  <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold mb-2.5">
                    Your Receiving Account
                  </span>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
                      <RecvIcon className="w-4 h-4 text-foreground/60" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate font-mono">
                        {masked || m.name}
                      </p>
                      {masked && m.name && (
                        <p className="text-[11px] text-foreground/40 truncate">{m.name}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-foreground/40 mt-2.5">
                    The buyer was told to pay into this account.
                  </p>
                </div>
              );
            })()}

          {/* Important warning — at the lock stage the richer bulleted card on
              the right replaces this, so only show it for other stages. */}
          {!needsLock && (
            <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-foreground/60 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-foreground">Important</p>
                <p className="text-xs text-foreground/50 mt-0.5">
                  {isSeller
                    ? "Do not release USDT until you have received the payment in your account."
                    : `Only mark as paid after you've actually sent the ${ccy}.`}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-3">
          {/* Counterparty payment method — at the lock stage this moves to the
              left column (below) so the two columns stay balanced. */}
          {!needsLock && paymentMethodCard}

          {/* Counterparty trust */}
          <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <span className="text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
                {trustHeading}
              </span>
              {trustScore != null && (
                <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                  {trustScore}/100
                </span>
              )}
            </div>
            <div className="space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="text-foreground/45">Completed Trades</span>
                <span className="font-semibold text-foreground/80">{trades}</span>
              </div>
              <PresenceRatingWalletRows
                online={online}
                lastSeen={presence.lastSeen}
                now={now}
                ratingNum={ratingNum}
                wallet={cpWallet}
              />
              {successRate != null && (
                <div className="flex justify-between gap-2">
                  <span className="text-foreground/45">Success Rate</span>
                  <span className="font-semibold text-emerald-400">{successRate}%</span>
                </div>
              )}
              {ageLabel && (
                <div className="flex justify-between gap-2">
                  <span className="text-foreground/45">Account Age</span>
                  <span className="font-semibold text-foreground/80">{ageLabel}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-foreground/45">KYC Status</span>
                <span
                  className={`font-semibold ${verified ? "text-emerald-400" : "text-foreground/50"}`}
                >
                  {verified ? "Verified" : "Unverified"}
                </span>
              </div>
            </div>
          </div>

          {/* Lock-stage right-side cards — mirror the Lock Escrow modal */}
          {needsLock && (
            <>
              {/* Tips */}
              <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-foreground/50" />
                  <span className="text-[13px] font-semibold text-foreground">Tips</span>
                </div>
                <ul className="space-y-1.5 text-[12px] text-foreground/50 list-disc pl-4">
                  <li>Choose the account where you can quickly verify payments.</li>
                  <li>This account cannot be changed after escrow is locked.</li>
                </ul>
              </div>

              {/* Important */}
              <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-foreground/60" />
                  <span className="text-[13px] font-semibold text-foreground">Important</span>
                </div>
                <ul className="space-y-1.5 text-[12px] text-foreground/60 list-disc pl-4">
                  <li>Only lock escrow if you are available to complete this trade.</li>
                  <li>Do not release USDT until funds arrive in your bank account.</li>
                </ul>
              </div>

              {/* What Happens Next */}
              <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">
                  What Happens Next?
                </p>
                <ol className="space-y-2.5">
                  {[
                    "Your selected account is shared with the buyer",
                    `Escrow locks ${amount} USDT`,
                    `Buyer sends ${ccy} payment`,
                    "Buyer marks payment as sent",
                    "You verify payment in your account",
                    "Release USDT to complete trade",
                  ].map((step, i) => (
                    <li key={step} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <span className="text-[12px] text-foreground/60 leading-snug">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </div>
      </div>

      {/* "You must lock" feature strip — only at the lock-escrow stage */}
      {isSeller && status === "accepted" && (
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-12 h-12 rounded-full border-2 border-foreground/15 flex items-center justify-center">
              <Lock className="w-5 h-5 text-foreground/60" />
            </div>
            <div>
              <p className="text-[11px] text-foreground/50">You Must Lock</p>
              <p className="text-xl font-bold text-foreground leading-tight">
                {amount} USDT
              </p>
              <p className="text-[11px] text-foreground/40">
                This amount will be secured in escrow.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-5 sm:ml-auto">
            {[
              { Icon: Shield, title: "Escrow Protection", sub: "Your funds are 100% secure" },
              { Icon: RotateCw, title: "Auto Release", sub: "Funds released after confirmation" },
              { Icon: Headphones, title: "24/7 Support", sub: "We're here to help you" },
            ].map((f) => {
              const Icon = f.Icon;
              return (
                <div
                  key={f.title}
                  className="flex flex-col items-center text-center gap-1 max-w-[88px]"
                >
                  <Icon className="w-4 h-4 text-foreground/50" />
                  <span className="text-[11px] font-semibold text-foreground/70 leading-tight">
                    {f.title}
                  </span>
                  <span className="text-[9px] text-foreground/35 leading-tight">
                    {f.sub}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* What happens next — at the lock stage the numbered card on the right
          replaces this; keep the short summary for all other stages. */}
      {!needsLock && (
        <div className="rounded-xl border border-foreground/[0.04] bg-foreground/[0.02] p-4">
          <p className="text-[10px] uppercase font-bold text-foreground/35 tracking-wide">
            What happens next?
          </p>
          <p className="text-xs text-foreground/50 mt-1 leading-relaxed">
            {isSeller
              ? status === "accepted"
                ? `Once you lock escrow, the buyer gets your payment details and sends you ${ccy}.`
                : status === "escrowed"
                  ? "Once the buyer pays, you verify and release the USDT from escrow."
                  : `Confirm the ${ccy} has arrived, then release the USDT to complete the trade.`
              : status === "escrowed"
                ? `Send the ${ccy}, mark it as paid, and the seller releases your USDT.`
                : "The seller releases your USDT once your payment is confirmed."}
          </p>
        </div>
      )}
    </>
  );
}

export interface OrderQuickViewProps {
  selectedOrder: Order | null;
  merchantId: string | null;
  markingDone: boolean;
  acceptingOrderId?: string | null;
  confirmingOrderId?: string | null;
  cancellingOrderId?: string | null;
  lockingEscrowOrderId?: string | null;
  isRequestingCancel?: boolean;
  onClose: () => void;
  onAcceptOrder: (order: Order) => void;
  onOpenEscrowModal: (order: Order) => void;
  /** Lock escrow inline from this popup (the new UI) — `methodId` is the
   *  seller's chosen receiving account. When provided, the footer "Lock Escrow"
   *  button locks here instead of opening the bottom-sheet modal. */
  onLockEscrow?: (order: Order, methodId?: string) => void;
  /** Surfaced inline at the lock stage so a failed lock shows in this popup. */
  escrowError?: string | null;
  onMarkFiatPaymentSent: (order: Order) => void;
  onConfirmPayment: (orderId: string) => Promise<void>;
  onCancelOrderWithoutEscrow: (orderId: string) => void;
  onRespondToCancel?: (orderId: string, accept: boolean) => void;
  onOpenChat: (order: Order) => void;
  /** @deprecated The new model shows full buyer context inline; the
   *  "View Full Details" hop was removed. Kept optional so callers compile. */
  onViewFullDetails?: (orderId: string) => void;
  onOpenDispute?: (orderId: string) => void;
}

export function OrderQuickView({
  selectedOrder,
  merchantId,
  markingDone,
  acceptingOrderId,
  confirmingOrderId,
  cancellingOrderId,
  lockingEscrowOrderId,
  isRequestingCancel,
  onClose,
  onAcceptOrder,
  onOpenEscrowModal,
  onLockEscrow,
  escrowError,
  onMarkFiatPaymentSent,
  onConfirmPayment,
  onCancelOrderWithoutEscrow,
  onRespondToCancel,
  onOpenChat,
  onOpenDispute,
}: OrderQuickViewProps) {
  // Receiving account the seller picked in ActiveOrderBody — bubbled up so the
  // footer "Lock Escrow" button can pass it to the inline lock.
  const [lockMethodId, setLockMethodId] = useLocalState<string | null>(null);

  // Whether the seller's waiting stage has passed its deadline — bubbled up
  // from ActiveOrderBody so the footer can show Need Help / Raise Appeal.
  const [waitingTimedOut, setWaitingTimedOut] = useLocalState(false);

  // After an inline lock for THIS order finishes successfully (was locking →
  // no longer locking, no error), close the popup. The popup's `selectedOrder`
  // copy is stale (still "accepted"), so leaving it open would show the Lock
  // button again and risk a second lock; the order list reflects the escrowed
  // state. On error we keep it open so the inline message shows.
  const wasLockingRef = useLocalRef(false);
  useLocalEffect(() => {
    const isLockingThis = !!selectedOrder && lockingEscrowOrderId === selectedOrder.id;
    const finishedOk = wasLockingRef.current && !isLockingThis && !escrowError;
    wasLockingRef.current = isLockingThis;
    if (finishedOk) onClose();
  }, [lockingEscrowOrderId, selectedOrder, escrowError, onClose]);
  // Detect the merchant's OWN pending broadcast BUY order (they are the buyer,
  // no seller has accepted yet). This drives the dedicated "you'll pay using"
  // + "waiting for merchant" layout. `dbOrder` is the raw row (snake_case);
  // the feed selects o.* so buyer_payment_types rides along, and my_role is
  // already 'buyer' for the creator (see getAllPendingOrdersForMerchant).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qvDb = (selectedOrder?.dbOrder ?? {}) as any;
  const isOwnPendingBuy =
    !!selectedOrder &&
    selectedOrder.myRole === "buyer" &&
    !!merchantId &&
    qvDb.buyer_merchant_id === merchantId &&
    !selectedOrder.sellerPaymentMethod &&
    !selectedOrder.lockedPaymentMethod &&
    !qvDb.accepted_at &&
    Array.isArray(qvDb.buyer_payment_types) &&
    qvDb.buyer_payment_types.length > 0;
  // Seller's view: a NEW pending buy order (declared pay types) that I can
  // accept — placed by someone else, not yet taken. Buy orders are the only
  // ones carrying buyer_payment_types, so sell orders never match here.
  const qvStatus = String(qvDb.status || qvDb.minimal_status || "").toLowerCase();
  const isAcceptableBuyOrder =
    !!selectedOrder &&
    !isOwnPendingBuy &&
    qvDb.buyer_merchant_id !== merchantId &&
    !qvDb.accepted_at &&
    !["accepted", "escrowed", "payment_sent", "completed", "cancelled", "expired", "disputed"].includes(qvStatus) &&
    Array.isArray(qvDb.buyer_payment_types) &&
    qvDb.buyer_payment_types.length > 0;
  // In-progress order the merchant is party to (seller or buyer): drives the
  // rich, stage-aware ActiveOrderBody. Excludes the pending/acceptable cases
  // above and observer-claimable orders (those keep their own flows).
  const isActiveOrder =
    !!selectedOrder &&
    !isOwnPendingBuy &&
    !isAcceptableBuyOrder &&
    (selectedOrder.myRole === "seller" || selectedOrder.myRole === "buyer") &&
    ["accepted", "escrowed", "payment_sent"].includes(qvStatus);
  const activeRole: "buyer" | "seller" =
    selectedOrder?.myRole === "buyer" ? "buyer" : "seller";
  return (
    <AnimatePresence>
      {selectedOrder && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={`fixed z-50 inset-x-0 bottom-0 mx-auto w-full ${isActiveOrder ? "max-w-2xl" : isAcceptableBuyOrder ? "max-w-xl" : "max-w-md"} lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[90%] max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-t-2xl lg:rounded-2xl shadow-2xl pb-safe lg:pb-0`} style={{ background: "#0e0e10", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-foreground/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-foreground/5 flex items-center justify-center text-2xl border border-foreground/[0.04]">
                  {selectedOrder.emoji}
                </div>
                <div>
                  <p className="text-base font-semibold text-foreground">
                    {selectedOrder.user}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-foreground/40">
                      {selectedOrder.myRole === "seller"
                        ? "Selling USDT"
                        : selectedOrder.myRole === "buyer"
                          ? "Buying USDT"
                          : "USDT Trade"}
                    </p>
                    {selectedOrder.myRole && selectedOrder.myRole !== "observer" && (
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                          selectedOrder.myRole === "seller"
                            ? "bg-white/[0.06] text-[#f5f5f7] border border-white/[0.09]"
                            : "bg-white/[0.06] text-[#f5f5f7] border border-white/[0.09]"
                        }`}
                      >
                        {selectedOrder.myRole === "seller"
                          ? "YOU SEND"
                          : "YOU PAY"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-foreground/[0.04] rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-foreground/40" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {isAcceptableBuyOrder ? (
                <AcceptorBuyOrderBody order={selectedOrder} db={qvDb} />
              ) : isActiveOrder ? (
                <ActiveOrderBody order={selectedOrder} db={qvDb} role={activeRole} onRecvSelectionChange={setLockMethodId} onWaitingTimeout={setWaitingTimedOut} />
              ) : (
              <>
              {/* Escrow Status */}
              {selectedOrder.escrowTxHash && (
                <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-foreground/5 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-foreground" />
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      Escrow Secured
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href={getSolscanTxUrl(selectedOrder.escrowTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground/80 transition-colors"
                    >
                      View TX <ExternalLink className="w-3 h-3" />
                    </a>
                    {selectedOrder.escrowPda && (
                      <a
                        href={getBlipscanTradeUrl(selectedOrder.escrowPda)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-[#f5f5f7]/70 hover:text-white transition-colors"
                      >
                        BlipScan <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Order Details */}
              <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-foreground/40 uppercase tracking-wide">
                    Amount
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    ${selectedOrder.amount.toLocaleString()} USDT
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-foreground/40 uppercase tracking-wide">
                    Total Fiat
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {fiatSymbol(selectedOrder.toCurrency)}{" "}
                    {Math.round(selectedOrder.total).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-foreground/[0.04]">
                  <span className="text-xs text-foreground/40 flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Rate (Locked)
                  </span>
                  <span className="text-xs font-mono text-foreground/50">
                    1 USDT = {selectedOrder.rate} {selectedOrder.toCurrency || 'AED'}
                  </span>
                </div>
                {selectedOrder.dbOrder?.accepted_at && (
                  <p className="text-[10px] text-foreground/25 text-right -mb-1">
                    Locked at{" "}
                    {new Date(
                      selectedOrder.dbOrder.accepted_at,
                    ).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Payment Method - Show to BUYER (fiat sender) only */}
              {(() => {
                const popupBankRole = selectedOrder.myRole || "observer";
                const iAmBuyerInPopup = popupBankRole === "buyer";
                if (!iAmBuyerInPopup) return null;

                // Merchant's OWN pending broadcast buy — no seller account
                // exists yet, so show the rails they chose at order time.
                if (isOwnPendingBuy) {
                  return <BuyerPayTypesCard types={qvDb.buyer_payment_types} />;
                }

                // Priority 1: Seller's merchant payment method (explicitly added by seller)
                if (selectedOrder.sellerPaymentMethod) {
                  const spm = selectedOrder.sellerPaymentMethod;
                  const typeIcon =
                    spm.type === "upi" ? (
                      <Smartphone className="w-4 h-4 text-[#f5f5f7]" />
                    ) : spm.type === "bank" ? (
                      <Building2 className="w-4 h-4 text-white/60" />
                    ) : (
                      <CreditCard className="w-4 h-4 text-white/60" />
                    );

                  if (
                    spm.type === "bank" &&
                    spm.details &&
                    typeof spm.details === "object"
                  ) {
                    return (
                      <CopyableBankDetails
                        title={`Send ${selectedOrder.toCurrency || 'AED'} to this account`}
                        currencySymbol={fiatSymbol(selectedOrder.toCurrency)}
                        bankName={spm.details.bank_name}
                        accountName={spm.details.account_name}
                        iban={spm.details.iban}
                        amount={Math.round(selectedOrder.total)}
                      />
                    );
                  }

                  // Card / UPI / Cash / Other
                  const detailStr =
                    typeof spm.details === "string"
                      ? spm.details
                      : JSON.stringify(spm.details);
                  return (
                    <div className="bg-white/[0.06] border border-white/[0.09] rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-white/60 uppercase tracking-wide">
                        {typeIcon}
                        <span>Seller&apos;s Payment Method</span>
                      </div>
                      <div className="text-sm text-foreground font-medium">
                        {spm.name}
                      </div>
                      <div className="text-xs text-white/60">{detailStr}</div>
                      <div className="text-right text-sm font-semibold text-[#f5f5f7]">
                        {Math.round(selectedOrder.total)} {selectedOrder.toCurrency || 'AED'}
                      </div>
                    </div>
                  );
                }

                // Priority 2: Locked payment method (user payment method system)
                if (selectedOrder.lockedPaymentMethod) {
                  const lpm = selectedOrder.lockedPaymentMethod;
                  const typeIcon =
                    lpm.type === "upi" ? (
                      <Smartphone className="w-4 h-4 text-[#f5f5f7]" />
                    ) : lpm.type === "bank" ? (
                      <Building2 className="w-4 h-4 text-white/60" />
                    ) : (
                      <CreditCard className="w-4 h-4 text-white/60" />
                    );

                  if (lpm.type === "bank") {
                    return (
                      <CopyableBankDetails
                        title={`Send ${selectedOrder.toCurrency || 'AED'} to this account`}
                        currencySymbol={fiatSymbol(selectedOrder.toCurrency)}
                        bankName={lpm.details.bank_name}
                        accountName={lpm.details.account_name}
                        iban={lpm.details.iban}
                        amount={Math.round(selectedOrder.total)}
                      />
                    );
                  }

                  // UPI / Cash / Other — custom display
                  return (
                    <LockedPaymentMethodCard
                      lpm={lpm}
                      amount={Math.round(selectedOrder.total)}
                      typeIcon={typeIcon}
                      currency={selectedOrder.toCurrency}
                    />
                  );
                }

                // Priority 3: Seller bank details from offer (legacy)
                if (selectedOrder.sellerBankDetails) {
                  return (
                    <CopyableBankDetails
                      title={`Send ${selectedOrder.toCurrency || 'AED'} to this account`}
                      currencySymbol={fiatSymbol(selectedOrder.toCurrency)}
                      bankName={selectedOrder.sellerBankDetails.bank_name}
                      accountName={selectedOrder.sellerBankDetails.account_name}
                      iban={selectedOrder.sellerBankDetails.iban}
                      amount={Math.round(selectedOrder.total)}
                    />
                  );
                }

                // Priority 3: User bank details from payment_details (legacy)
                if (
                  selectedOrder.userBankDetails ||
                  selectedOrder.userBankAccount
                ) {
                  const details = selectedOrder.userBankDetails;
                  return (
                    <CopyableBankDetails
                      title={`Send ${selectedOrder.toCurrency || 'AED'} to this account`}
                      currencySymbol={fiatSymbol(selectedOrder.toCurrency)}
                      bankName={details?.bank_name}
                      accountName={details?.account_name}
                      iban={details?.iban}
                      fallbackText={
                        !details ? selectedOrder.userBankAccount : undefined
                      }
                      amount={Math.round(selectedOrder.total)}
                    />
                  );
                }

                return (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <p className="text-xs text-red-400">
                      No payment details provided. Chat to get bank details.
                    </p>
                  </div>
                );
              })()}

              {/* Status message for SELLER waiting for buyer */}
              {(() => {
                const popupSellerRole = selectedOrder.myRole || "observer";
                const popupStatus = selectedOrder.dbOrder?.status;
                const popupAccepted = !!selectedOrder.dbOrder?.accepted_at;

                if (
                  popupSellerRole === "seller" &&
                  (popupStatus === "escrowed" || popupStatus === "accepted")
                ) {
                  return (
                    <div className="bg-foreground/[0.04] border border-foreground/[0.06] rounded-xl p-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
                        <span className="text-xs">{"\u231B"}</span>
                      </div>
                      <p className="text-xs text-foreground/50">
                        {popupAccepted
                          ? "Waiting for buyer to mark payment as sent..."
                          : "Escrow locked by user. Waiting for a merchant to accept..."}
                      </p>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Merchant's OWN pending broadcast buy — status + what's next. */}
              {isOwnPendingBuy && (
                <OpenMarketWaitingCard
                  createdAt={qvDb.created_at}
                  expiresAt={qvDb.expires_at}
                />
              )}
              </>
              )}
            </div>

            {/* Cancel Request Banner — shown when counterparty requested cancellation */}
            {(() => {
              if (
                !selectedOrder.cancelRequestedBy &&
                !selectedOrder.dbOrder?.cancel_requested_by
              )
                return null;

              const cancelBy =
                selectedOrder.cancelRequestedBy ||
                selectedOrder.dbOrder?.cancel_requested_by;
              const cancelReason =
                selectedOrder.cancelRequestReason ||
                selectedOrder.dbOrder?.cancel_request_reason;

              // Determine if counterparty requested (I need to respond) or I requested (waiting)
              const dbUsername = selectedOrder.dbOrder?.user?.username || "";
              const isPlaceholderUser =
                dbUsername.startsWith("open_order_") ||
                dbUsername.startsWith("m2m_");
              const iRequestedIt = isPlaceholderUser
                ? cancelBy === "merchant" &&
                  selectedOrder.orderMerchantId === merchantId
                : cancelBy === "merchant";
              const counterpartyRequested = !iRequestedIt;

              if (counterpartyRequested) {
                return (
                  <div className="mx-5 mb-2 rounded-xl border border-white/[0.12] bg-white/[0.06] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <X className="w-4 h-4 text-[#f5f5f7]" />
                      <span className="text-sm font-semibold text-[#f5f5f7]">
                        Cancel Requested by{" "}
                        {cancelBy === "user" ? "User" : "Merchant"}
                      </span>
                    </div>
                    {cancelReason && (
                      <p className="text-xs text-foreground/50 mb-3">
                        {cancelReason}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={isRequestingCancel}
                        onClick={() => {
                          onRespondToCancel?.(selectedOrder.id, true);
                          onClose();
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.08] border border-white/[0.12] text-[#f5f5f7] text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        {isRequestingCancel ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        Agree to Cancel
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={isRequestingCancel}
                        onClick={() => {
                          onRespondToCancel?.(selectedOrder.id, false);
                          onClose();
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.08] text-foreground/70 text-sm font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        Continue Order
                      </motion.button>
                    </div>
                  </div>
                );
              }

              // I requested — show waiting status
              return (
                <div className="mx-5 mb-2 rounded-xl border border-white/[0.12] bg-white/[0.06] p-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[#f5f5f7] animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-[#f5f5f7]">
                      Cancel Request Sent
                    </p>
                    <p className="text-xs text-foreground/40">
                      Waiting for counterparty to approve
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Extension Request Banner — shown when counterparty requested time extension */}
            {(() => {
              const dbOrder = selectedOrder.dbOrder as any;
              const extBy = dbOrder?.extension_requested_by as string | null | undefined;
              const extMin = dbOrder?.extension_minutes as number | null | undefined;
              if (!extBy) return null;

              // Did I request it, or did the counterparty?
              const iAmMerchant = !!merchantId;
              const iRequested = (extBy === 'merchant' && iAmMerchant) || (extBy === 'user' && !iAmMerchant);

              if (!iRequested) {
                // Counterparty requested — I need to respond
                const durationLabel = extMin && extMin >= 60
                  ? `${Math.round(extMin / 60)} hour${Math.round(extMin / 60) !== 1 ? 's' : ''}`
                  : `${extMin || 15} minutes`;
                return (
                  <div className="mx-5 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-semibold text-amber-400">
                        {extBy === 'user' ? 'Buyer' : 'Merchant'} requested +{durationLabel} extension
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={async () => {
                          try {
                            const res = await fetchWithAuth(`/api/orders/${selectedOrder.id}/extension`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                actor_type: iAmMerchant ? 'merchant' : 'user',
                                actor_id: merchantId || selectedOrder.dbOrder?.user_id,
                                accept: true,
                              }),
                            });
                            if (res.ok) onClose();
                          } catch {}
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Accept Extension
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={async () => {
                          try {
                            const res = await fetchWithAuth(`/api/orders/${selectedOrder.id}/extension`, {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                actor_type: iAmMerchant ? 'merchant' : 'user',
                                actor_id: merchantId || selectedOrder.dbOrder?.user_id,
                                accept: false,
                              }),
                            });
                            if (res.ok) onClose();
                          } catch {}
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.08] text-foreground/60 text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
                      >
                        <X className="w-3.5 h-3.5" />
                        Decline
                      </motion.button>
                    </div>
                  </div>
                );
              }

              // I requested — show waiting
              return (
                <div className="mx-5 mb-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-amber-400">Extension Request Sent</p>
                    <p className="text-xs text-foreground/40">Waiting for counterparty to respond</p>
                  </div>
                </div>
              );
            })()}

            {/* Actions — Backend-driven: only show what enrichOrderResponse allows */}
            <div className="px-5 pb-5 space-y-2">
              {/* Own pending broadcast buy: the only action is to cancel (no
                  escrow yet). Shown explicitly so it doesn't depend on the
                  feed enriching primary/secondary actions. */}
              {isOwnPendingBuy && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={cancellingOrderId === selectedOrder.id}
                  onClick={() => {
                    onCancelOrderWithoutEscrow(selectedOrder.id);
                    onClose();
                  }}
                  className="w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all bg-[var(--color-error)]/10 hover:bg-[var(--color-error)]/20 border-[var(--color-error)]/30 text-[var(--color-error)] disabled:opacity-50"
                >
                  {cancellingOrderId === selectedOrder.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  Cancel Order
                </motion.button>
              )}
              {/* Seller accepting a new pending buy order — prominent green CTA,
                  shown explicitly (not dependent on feed action enrichment). */}
              {isAcceptableBuyOrder && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={acceptingOrderId === selectedOrder.id}
                  onClick={() => {
                    onAcceptOrder(selectedOrder);
                    onClose();
                  }}
                  className="w-full py-3.5 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                >
                  {acceptingOrderId === selectedOrder.id ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Zap className="w-5 h-5" />
                  )}
                  Accept Order
                </motion.button>
              )}
              {!isOwnPendingBuy && !isAcceptableBuyOrder && (() => {
                // Read backend-computed actions (source of truth)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const enriched = selectedOrder.dbOrder as any;
                const primary = enriched?.primaryAction;
                const secondary = enriched?.secondaryAction;

                // Guard: don't render action buttons until backend data is loaded
                if (!primary) return null;

                // Map backend action type → frontend handler
                const ACTION_HANDLER: Record<string, () => void> = {
                  ACCEPT: () => {
                    onAcceptOrder(selectedOrder);
                    onClose();
                  },
                  CLAIM: () => {
                    onAcceptOrder(selectedOrder);
                    onClose();
                  },
                  LOCK_ESCROW: () => {
                    // Lock inline in this popup (new UI) using the receiving
                    // account picked above — keep the popup open so its loading /
                    // error / result reflect here. Fall back to the old modal if
                    // the inline handler isn't wired.
                    if (onLockEscrow) {
                      onLockEscrow(selectedOrder, lockMethodId ?? undefined);
                    } else {
                      onOpenEscrowModal(selectedOrder);
                      onClose();
                    }
                  },
                  SEND_PAYMENT: () => {
                    onMarkFiatPaymentSent(selectedOrder);
                    onClose();
                  },
                  CONFIRM_PAYMENT: () => {
                    onConfirmPayment(selectedOrder.id).then(onClose);
                  },
                  CANCEL: () => {
                    onCancelOrderWithoutEscrow(selectedOrder.id);
                    onClose();
                  },
                  DISPUTE: () => {
                    onOpenDispute?.(selectedOrder.id);
                    onClose();
                  },
                };

                // Loading state per action type
                const isActionLoading = (type: string | null) => {
                  if (!type) return false;
                  if (type === "ACCEPT" || type === "CLAIM")
                    return acceptingOrderId === selectedOrder.id;
                  if (type === "CONFIRM_PAYMENT")
                    return confirmingOrderId === selectedOrder.id;
                  if (type === "CANCEL")
                    return cancellingOrderId === selectedOrder.id;
                  if (type === "LOCK_ESCROW")
                    return lockingEscrowOrderId === selectedOrder.id;
                  if (type === "SEND_PAYMENT") return markingDone;
                  return false;
                };

                // Action button styles
                const PRIMARY_STYLE = isActiveOrder
                  ? "bg-[#f5f5f7] hover:bg-white border-[#f5f5f7] text-black"
                  : "bg-white/[0.06] hover:bg-white/[0.08] border-white/[0.12] hover:border-white/[0.12] text-[#f5f5f7]";
                const PRIMARY_LOADING =
                  "bg-white/[0.06] border-white/[0.12] text-[#f5f5f7]/50 cursor-wait";
                const SECONDARY_STYLE =
                  "bg-red-500/10 hover:bg-[var(--color-error)]/20 border-red-500/30 hover:border-[var(--color-error)]/40 text-red-400";
                const DISABLED_STYLE =
                  "bg-foreground/[0.04] border-foreground/[0.06] text-foreground/40 cursor-not-allowed";

                const loading = isActionLoading(primary.type);
                // Active orders get a descriptive, amount-aware CTA matching
                // the rich body; other states keep the backend label verbatim.
                const primaryLabel = isActiveOrder
                  ? primary.type === "LOCK_ESCROW"
                    ? `Lock ${selectedOrder.amount} USDT in Escrow`
                    : primary.type === "CONFIRM_PAYMENT"
                      ? "Confirm Payment & Release USDT"
                      : primary.type === "SEND_PAYMENT"
                        ? "I've Sent the Payment"
                        : primary.label
                  : primary.label;

                return (
                  <>
                    {/* Primary Action — from backend. At the lock stage it's
                        paired with a Cancel button (like the lock screen). */}
                    {primary.type && primary.enabled ? (() => {
                      const primaryBtn = (
                        <motion.button
                          whileTap={{ scale: 0.98 }}
                          disabled={loading}
                          onClick={() => ACTION_HANDLER[primary.type!]?.()}
                          className={`${primary.type === "LOCK_ESCROW" ? "flex-[2]" : "w-full"} ${isActiveOrder ? "py-4" : "py-3"} rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                            loading ? PRIMARY_LOADING : PRIMARY_STYLE
                          }`}
                        >
                          {loading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Zap className="w-4 h-4" />
                          )}
                          {primaryLabel}
                        </motion.button>
                      );
                      if (primary.type === "LOCK_ESCROW") {
                        return (
                          <div className="flex gap-3">
                            <button
                              onClick={() => {
                                onCancelOrderWithoutEscrow(selectedOrder.id);
                                onClose();
                              }}
                              disabled={loading}
                              className="flex-1 py-4 rounded-xl border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-[#f5f5f7] font-semibold text-sm disabled:opacity-50 transition-all"
                            >
                              Cancel
                            </button>
                            {primaryBtn}
                          </div>
                        );
                      }
                      return primaryBtn;
                    })() : primary.label &&
                      primary.disabledReason &&
                      !primary.disabledReason.includes(
                        "No actions available",
                      ) ? (
                      /* Disabled informational button (e.g., "Waiting for Payment") — hidden for terminal states */
                      <div
                        className={`w-full py-3 rounded-xl border font-medium flex items-center justify-center gap-2 text-sm ${DISABLED_STYLE}`}
                        title={primary.disabledReason}
                      >
                        <Loader2 className="w-4 h-4 animate-spin opacity-40" />
                        {primary.label}
                      </div>
                    ) : null}

                    {/* Secondary Action — hidden for accepted/escrowed (cancel not surfaced at this stage) */}
                    {secondary?.type && (() => {
                      const st = (selectedOrder.dbOrder as any)?.status || (selectedOrder.dbOrder as any)?.minimal_status;
                      if (secondary.type === "CANCEL" && (st === "accepted" || st === "escrowed")) return null;
                      // Dispute is surfaced as the "Raise Appeal" button below — don't double up.
                      if (secondary.type === "DISPUTE") return null;
                      return true;
                    })() && (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={isActionLoading(secondary.type)}
                        onClick={() => ACTION_HANDLER[secondary.type!]?.()}
                        className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                          isActionLoading(secondary.type)
                            ? PRIMARY_LOADING
                            : SECONDARY_STYLE
                        }`}
                      >
                        {isActionLoading(secondary.type) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                        {secondary.label}
                      </motion.button>
                    )}

                    {/* Inline lock error (new UI locks here, so failures show here). */}
                    {escrowError && primary.type === "LOCK_ESCROW" && (
                      <p className="text-[11px] text-red-400 text-center">
                        {escrowError}
                      </p>
                    )}

                    {/* Raise Appeal (first) + Need Help. Appeal shows at the
                        verify stage (buyer marked paid), or once an escrowed
                        order's deadline has passed (buyer late). Need Help is
                        always available on an active order. */}
                    {isActiveOrder && (() => {
                      const st = (selectedOrder.dbOrder as any)?.status || (selectedOrder.dbOrder as any)?.minimal_status;
                      const showAppeal = st === "payment_sent" || (st === "escrowed" && waitingTimedOut);
                      return (
                        <div className="flex gap-3">
                          {showAppeal && (
                            <button
                              onClick={() => {
                                onOpenDispute?.(selectedOrder.id);
                                onClose();
                              }}
                              className="flex-1 py-3 rounded-xl border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-[#f5f5f7] text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
                            >
                              <Flag className="w-4 h-4" />
                              Raise Appeal
                            </button>
                          )}
                          <button
                            onClick={() => {
                              onOpenChat(selectedOrder);
                              onClose();
                            }}
                            className="flex-1 py-3 rounded-xl border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-[#f5f5f7] text-sm font-semibold flex items-center justify-center gap-1.5 transition-all"
                          >
                            <Headphones className="w-4 h-4" />
                            Need Help
                          </button>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}

              {/* "View Full Details" hop removed — the model now shows full
                  buyer context (presence, rating, trades, wallet) inline. */}

              {/* <button
                onClick={() => {
                  onOpenChat(selectedOrder);
                  onClose();
                }}
                className="w-full py-3 rounded-xl bg-foreground/[0.04] hover:bg-foreground/[0.08] text-foreground text-sm font-medium flex items-center justify-center gap-2 border border-foreground/[0.04] transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Chat
              </button> */}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
