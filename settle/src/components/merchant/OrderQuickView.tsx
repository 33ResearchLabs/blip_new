"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  ArrowLeft,
  Shield,
  Rocket,
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
  Sparkles,
  HelpCircle,
} from "lucide-react";
import {
  useState as useLocalState,
  useEffect as useLocalEffect,
  useRef as useLocalRef,
  createContext,
  useContext,
  Fragment,
} from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { formatCrypto, formatCount } from "@/lib/format";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
// Backend-driven: action buttons read from dbOrder.primaryAction/secondaryAction
import type { Order } from "@/types/merchant";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { CopyableBankDetails } from "@/components/shared/CopyableBankDetails";
import {
  ReceivingAccountPicker,
  detailString,
} from "@/components/shared/trade/ReceivingAccountPicker";
import { useMerchantReceivingMethods } from "@/components/shared/trade/useMerchantReceivingMethods";
import { PaymentMethodModal } from "@/components/merchant/PaymentMethodModal";
import { useMerchantStore } from "@/stores/merchantStore";
import { maskAccountDetail } from "@/lib/mask";
import { SURFACES } from "@/components/shared/limits/types";
import { ProfileSheet } from "@/components/shared/profile/ProfileSheet";
import type { ProfileEntityType } from "@/components/shared/profile/types";
import { deriveCounterparty } from "@/components/shared/profile/counterparty";

// ── Counterparty profile wiring ──────────────────────────────────────────────
// The popup is one big tree of sub-component bodies (CounterpartyTrustCard,
// ActiveOrderBody, …). Rather than thread an onOpenProfile callback through every
// one, the root provides openProfile() via context and renders a single
// <ProfileSheet>. Any descendant calls useContext(ProfileOpenContext)(et, id).
const ProfileOpenContext = createContext<
  (entityType: ProfileEntityType, id: string) => void
>(() => {});

// `deriveCounterparty(db, merchantId)` (shared with the mobile cards + the
// desktop pending panel) resolves whose profile the merchant wants to open from
// the raw DB row. Pass merchantId so an M2M order viewed from the buyer slot
// opens the seller, not the viewer themselves.

/** Map fiat currency code to display symbol */
function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR":
      return "₹";
    case "USD":
      return "$";
    case "AED":
      return "د.إ";
    default:
      return (code || "AED").toUpperCase();
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
          Send {currency || "AED"} Here
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

// "Where to send the fiat" card for the BUYER side (the merchant paying a sell
// order): the seller's locked receiving account, shown with copy buttons so the
// merchant knows exactly where to pay. Priority chain mirrors the popup body's
// resolution (explicit merchant method → locked user method → legacy bank/account)
// and falls back to a neutral line when no account is attached yet.
function SellerPayToCard({
  order,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
}) {
  const ccy = order.toCurrency || "AED";
  const amt = Math.round(order.total || 0);
  const sym = fiatSymbol(ccy);
  const iconFor = (t: string) =>
    t === "upi" ? (
      <Smartphone className="w-4 h-4 text-[#f5f5f7]" />
    ) : t === "bank" ? (
      <Building2 className="w-4 h-4 text-white/60" />
    ) : (
      <CreditCard className="w-4 h-4 text-white/60" />
    );

  // Priority 1: seller's explicitly-added merchant payment method.
  if (order.sellerPaymentMethod) {
    const spm = order.sellerPaymentMethod;
    if (spm.type === "bank" && spm.details && typeof spm.details === "object") {
      return (
        <CopyableBankDetails
          title={`Send ${ccy} to this account`}
          currencySymbol={sym}
          bankName={spm.details.bank_name}
          accountName={spm.details.account_name}
          iban={spm.details.iban}
          amount={amt}
        />
      );
    }
    const detailStr =
      typeof spm.details === "string" ? spm.details : JSON.stringify(spm.details);
    return (
      <div className="bg-white/[0.06] border border-white/[0.09] rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-white/60 uppercase tracking-wide">
          {iconFor(spm.type)}
          <span>Seller&apos;s Payment Method</span>
        </div>
        <div className="text-sm text-foreground font-medium">{spm.name}</div>
        <div className="text-xs text-white/60">{detailStr}</div>
        <div className="text-right text-sm font-semibold text-[#f5f5f7]">
          {amt} {ccy}
        </div>
      </div>
    );
  }

  // Priority 2: locked payment method (user payment-method system).
  if (order.lockedPaymentMethod) {
    const lpm = order.lockedPaymentMethod;
    if (lpm.type === "bank") {
      return (
        <CopyableBankDetails
          title={`Send ${ccy} to this account`}
          currencySymbol={sym}
          bankName={lpm.details.bank_name}
          accountName={lpm.details.account_name}
          iban={lpm.details.iban}
          amount={amt}
        />
      );
    }
    return (
      <LockedPaymentMethodCard
        lpm={lpm}
        amount={amt}
        typeIcon={iconFor(lpm.type)}
        currency={ccy}
      />
    );
  }

  // Priority 3: legacy seller bank details from the offer.
  if (order.sellerBankDetails) {
    return (
      <CopyableBankDetails
        title={`Send ${ccy} to this account`}
        currencySymbol={sym}
        bankName={order.sellerBankDetails.bank_name}
        accountName={order.sellerBankDetails.account_name}
        iban={order.sellerBankDetails.iban}
        amount={amt}
      />
    );
  }

  // Priority 4: legacy user bank details / freeform account string.
  if (order.userBankDetails || order.userBankAccount) {
    const details = order.userBankDetails;
    return (
      <CopyableBankDetails
        title={`Send ${ccy} to this account`}
        currencySymbol={sym}
        bankName={details?.bank_name}
        accountName={details?.account_name}
        iban={details?.iban}
        fallbackText={!details ? order.userBankAccount : undefined}
        amount={amt}
      />
    );
  }

  // Neutral fallback — no destination account attached yet.
  return (
    <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-2">
      <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
        Seller Payment Method
      </span>
      <p className="text-xs text-foreground/40 leading-snug">
        Payment details will appear here once the seller shares them — check chat if they&apos;re delayed.
      </p>
    </div>
  );
}

// On-chain escrow proof — shown to the merchant on the sell-order claim and the
// buyer-pays / payment-sent screens so they can verify the seller's USDT is
// genuinely locked. Lists the on-chain identifiers (tx signature, escrow/trade
// PDAs, trade id) as COPYABLE rows + explorer links so anyone can independently
// verify on Solana. Renders nothing until an escrow tx exists. Emerald = the
// merchant theme's "secured/positive" tone.
function EscrowInfoCard({
  order,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any;
}) {
  const [expanded, setExpanded] = useLocalState(false);
  const [copiedKey, setCopiedKey] = useLocalState<string | null>(null);
  if (!order.escrowTxHash) return null;

  const copy = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };
  const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s);

  const amountLabel =
    order.amount != null && order.amount !== ""
      ? `${order.amount} USDT locked in escrow`
      : "USDT locked securely in escrow";

  const rows: { label: string; value: string; key: string; href?: string }[] = [
    {
      label: "Transaction ID",
      value: order.escrowTxHash,
      key: "tx",
      href: getSolscanTxUrl(order.escrowTxHash),
    },
  ];
  if (order.escrowPda)
    rows.push({
      label: "Escrow Account",
      value: order.escrowPda,
      key: "pda",
      href: getBlipscanTradeUrl(order.escrowPda),
    });
  if (order.escrowTradePda)
    rows.push({ label: "Trade Account", value: order.escrowTradePda, key: "trade" });
  if (order.escrowTradeId != null && order.escrowTradeId !== "")
    rows.push({ label: "Trade ID", value: String(order.escrowTradeId), key: "tid" });

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] overflow-hidden">
      {/* Header — tap to reveal the on-chain details. */}
      <button
        type="button"
        onClick={() => setExpanded((o) => !o)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2.5 p-4 text-left"
      >
        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Escrow Secured</p>
          <p className="text-[11px] text-foreground/45">{amountLabel}</p>
        </div>
        <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400 shrink-0">
          Details
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </span>
      </button>

      {/* On-chain details — copyable so anyone can verify the lock on Solana. */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-3 border-t border-emerald-500/15 space-y-2">
              {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-foreground/45 shrink-0">{r.label}</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => copy(r.value, r.key)}
                className="flex items-center gap-1 font-mono text-[11px] text-foreground/70 hover:text-foreground transition-colors min-w-0"
                title="Copy"
              >
                <span className="truncate">{short(r.value)}</span>
                {copiedKey === r.key ? (
                  <Check className="w-3 h-3 text-emerald-400 shrink-0" strokeWidth={3} />
                ) : (
                  <Copy className="w-3 h-3 text-foreground/30 shrink-0" />
                )}
              </button>
              {r.href && (
                <a
                  href={r.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
                  title="View on explorer"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        ))}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] text-foreground/45 shrink-0">Network</span>
                <span className="text-[11px] text-foreground/70">Solana</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
            Your order is visible to all merchants. Once a merchant accepts,
            they will lock USDT in escrow and provide payment details.
          </p>
        </div>
      </div>

      {/* Mobile: stack the two meta lines so neither phrase wraps
          mid-text; sm+: keep them on one justified row. */}
      <div className="flex flex-col gap-1 pt-1 text-[11px] sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <span className="flex items-center gap-1 text-foreground/40 whitespace-nowrap">
          <Clock className="w-3 h-3 shrink-0" /> Order expires in{" "}
          {expiryMs > 0 && (
            <span className="text-[var(--accent)] font-mono font-bold">
              {mm}:{ss}
            </span>
          )}
        </span>
        {createdLabel && (
          <span className="text-foreground/30 whitespace-nowrap">Created on {createdLabel}</span>
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
  const [member, setMember] = useLocalState<{
    isOnline: boolean;
    lastSeen: string | null;
  } | null>(null);
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
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              online ? "bg-emerald-400" : "bg-foreground/30"
            }`}
          />
          <span
            className={`font-semibold ${
              online ? "text-emerald-400" : "text-foreground/60"
            }`}
          >
            {online
              ? "Online"
              : lastSeen
              ? `last seen ${formatLastSeen(lastSeen, now)}`
              : "Offline"}
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
                className={`w-3 h-3 ${
                  i <= Math.round(ratingNum)
                    ? "text-amber-400 fill-amber-400"
                    : "text-foreground/20"
                }`}
              />
            ))}
            <span className="font-semibold text-foreground/80 ml-1">
              {ratingNum.toFixed(1)}
            </span>
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
            {copied ? (
              <Check className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      )}
    </>
  );
}

// Order-creator profile + trust card for the open-market accept views. Shows
// WHO placed the order (avatar, name, username, KYC badge) plus their trust
// stats (completed trades, rating, success rate, account age, online status,
// wallet). All values come from `db.user`, which the merchant feed populates
// for both buy and sell broadcasts (and sources from the buyer-merchant on
// merchant-placed orders). `heading` flips "Buyer Trust" / "Seller Trust".
function CounterpartyTrustCard({
  db,
  now,
  heading,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  now: number;
  heading: string;
}) {
  const openProfile = useContext(ProfileOpenContext);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const cp = deriveCounterparty(db, merchantId);
  const u = db.user || {};
  const trades = u.total_trades ?? 0;
  const disputes = u.dispute_count ?? 0;
  const verified = !!u.is_verified;
  const ratingNum = typeof u.rating === "number" ? u.rating : null;
  // Rating is 0-5; surface as an x/100 trust score when present.
  const trustScore =
    ratingNum != null && ratingNum > 0 ? Math.round((ratingNum / 5) * 100) : null;
  // Success rate from completed vs disputed trades; null (→ hidden) when none.
  const successRate =
    trades > 0 ? Math.round(((trades - disputes) / trades) * 100) : null;
  // Account age from the creator's join date.
  const ageLabel = (() => {
    const iso = u.account_created_at;
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
  const presence = useCounterpartyPresence(
    db.id,
    db.buyer_merchant_id ? "merchant" : "user",
    db.buyer_merchant_id || db.user_id || null,
  );
  const online = presence.isOnline || !!u.is_online;
  const wallet: string | null = u.wallet_address || db.buyer_wallet_address || null;
  const name = u.name || u.display_name || u.username || "User";
  const username =
    u.username && u.username !== name ? `@${u.username}` : null;

  return (
    <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
      {/* Identity header — tap avatar/name to open the creator's profile */}
      <div
        className={`flex items-center gap-3 ${cp ? "cursor-pointer" : ""}`}
        onClick={cp ? () => openProfile(cp.entityType, cp.id) : undefined}
        role={cp ? "button" : undefined}
      >
        <UserAvatar src={u.avatar_url || null} seed={name} size={40} style={{ borderRadius: 12 }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate">{name}</p>
          {username && (
            <p className="text-[11px] text-foreground/45 truncate">{username}</p>
          )}
        </div>
        {trustScore != null && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">
            {trustScore}/100
          </span>
        )}
      </div>

      {/* Trust stats */}
      <div className="pt-1 flex items-center gap-2">
        <Shield className="w-4 h-4 text-emerald-400" />
        <span className="text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
          {heading}
        </span>
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
          wallet={wallet}
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
            className={`font-semibold ${
              verified ? "text-emerald-400" : "text-foreground/50"
            }`}
          >
            {verified ? "Verified" : "Unverified"}
          </span>
        </div>
      </div>
    </div>
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
    const r = Math.max(
      0,
      Math.floor((new Date(target).getTime() - now) / 1000),
    );
    return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(
      r % 60,
    ).padStart(2, "0")}`;
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

  const createdLabel = db.created_at
    ? new Date(db.created_at).toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const orderIdShort =
    // Show the canonical DB order_number (matches lists, chat, ledger, the user
    // app, and support lookups). Fall back to a derived ref only if it's absent.
    typeof db.order_number === "string" && db.order_number
      ? db.order_number
      : typeof db.id === "string" ? `BLP-${db.id.slice(0, 8).toUpperCase()}` : "—";

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
            <span className="text-2xl font-bold text-foreground">
              {order.amount}
            </span>
            <span className="text-sm font-semibold text-foreground/60">
              USDT
            </span>
            {/* Accepting a BUY order makes the merchant the SELLER: they lock/
                give USDT and receive the fiat. */}
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-foreground/35">
              You pay
            </span>
          </div>
          <div className="flex items-baseline gap-2 text-lg font-bold text-foreground">
            <span>
              {sym} {total.toLocaleString()}{" "}
              <span className="text-xs font-medium text-foreground/40">
                {ccy}
              </span>
            </span>
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-foreground/35">
              You get
            </span>
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
                <span className="font-mono text-amber-400 font-bold">
                  {expiresIn}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span className="text-foreground/40">Order ID</span>
              <span className="font-mono text-foreground/60 truncate">
                {orderIdShort}
              </span>
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
              const m = PM_META[t] ?? {
                label: t.toUpperCase(),
                Icon: CreditCard,
              };
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
              <p className="text-[11px] text-foreground/40 mb-1">
                Preferred Method
              </p>
              <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] uppercase">
                {PM_META[preferred]?.label ?? preferred}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Who placed this order — profile + trust */}
      <CounterpartyTrustCard db={db} now={now} heading="Buyer Trust" />

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
          <p className="text-sm font-semibold text-foreground">
            Escrow Protection
          </p>
          <p className="text-xs text-foreground/45 mt-0.5">
            Your USDT will be securely locked in escrow. Release happens only
            after you confirm you have received the payment.
          </p>
        </div>
      </div>
    </>
  );
}

// Merchant's view of a CLAIMABLE sell order in the open market (the user is
// the seller, USDT already locked in escrow; the merchant claims it as the
// BUYER). Mirrors AcceptorBuyOrderBody's rich layout, but the role flips:
// the merchant pays fiat and the steps/protection copy reflect the buyer side.
function AcceptorSellOrderBody({
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

  const ccy = order.toCurrency || "AED";
  const sym = fiatSymbol(ccy);
  const total = Math.round(order.total || 0);

  // The seller (fiat receiver) picked this rail when creating the order — it's
  // where YOU send the fiat. Full account details reveal after you claim.
  const recv = order.lockedPaymentMethod || order.sellerPaymentMethod || null;
  const recvType = String(recv?.type || "").toLowerCase();
  const recvMeta = recvType
    ? PM_META[recvType] ?? { label: recvType.toUpperCase(), Icon: CreditCard }
    : null;

  const createdLabel = db.created_at
    ? new Date(db.created_at).toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const orderIdShort =
    // Show the canonical DB order_number (matches lists, chat, ledger, the user
    // app, and support lookups). Fall back to a derived ref only if it's absent.
    typeof db.order_number === "string" && db.order_number
      ? db.order_number
      : typeof db.id === "string" ? `BLP-${db.id.slice(0, 8).toUpperCase()}` : "—";
  const expiresIn = countdown(db.expires_at);

  const STEPS: { label: string; Icon: typeof Wallet }[] = [
    { label: "Accept\nOrder", Icon: Check },
    { label: `Pay Seller\nin ${ccy}`, Icon: Banknote },
    { label: "Mark Payment\nas Sent", Icon: FileText },
    { label: "Seller Confirms\nReceipt", Icon: Clock },
    { label: "USDT Released\nto You", Icon: CheckCircle2 },
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
            A user has placed a sell order in the open market.
          </p>
          <p className="text-xs text-foreground/45 mt-0.5">
            Their USDT is already locked in escrow — accept to send them payment and receive the USDT.
          </p>
        </div>
      </div>

      {/* On-chain escrow proof */}
      <EscrowInfoCard order={order} />

      {/* Order Summary + Seller's Receiving Method */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
          <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
            Order Summary
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">{order.amount}</span>
            <span className="text-sm font-semibold text-foreground/60">USDT</span>
            {/* Claiming a SELL order makes the merchant the BUYER: they pay fiat
                and receive the USDT. */}
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-foreground/35">
              You get
            </span>
          </div>
          <div className="flex items-baseline gap-2 text-lg font-bold text-foreground">
            <span>
              {sym} {total.toLocaleString()}{" "}
              <span className="text-xs font-medium text-foreground/40">{ccy}</span>
            </span>
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-foreground/35">
              You pay
            </span>
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
            You Pay The Seller Via
          </span>
          {recvMeta ? (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[var(--accent)]/15 flex items-center justify-center shrink-0">
                <recvMeta.Icon className="w-4 h-4 text-[var(--accent)]" />
              </div>
              <span className="text-sm font-medium text-foreground flex-1">{recvMeta.label}</span>
              <Check className="w-4 h-4 text-emerald-400" strokeWidth={3} />
            </div>
          ) : (
            <p className="text-sm text-foreground/50">The seller&apos;s chosen receiving method.</p>
          )}
          <div className="pt-2 border-t border-foreground/[0.04]">
            <p className="text-[11px] text-foreground/40 leading-snug">
              Full account details are revealed after you claim the order.
            </p>
          </div>
        </div>
      </div>

      {/* Who placed this order — profile + trust */}
      <CounterpartyTrustCard db={db} now={now} heading="Seller Trust" />

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
            The seller&apos;s USDT is already locked in escrow. It&apos;s released to you only after the seller confirms your payment.
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
  fullScreen = false,
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
  /** Merchant-mobile full-screen variant. At the lock stage it renders the
   *  dedicated pixel-spec layout (Payment Method + Expected Completion row,
   *  "Receive Payment In" picker, green "Escrow protects both parties" banner,
   *  4-up assurance footer). Desktop/modal (false) keeps the 2-column layout. */
  fullScreen?: boolean;
}) {
  const router = useRouter();
  const merchantId = useMerchantStore((s) => s.merchantId);
  // Merchant's own identity — used to label the "You" side of the completed
  // order's Trade Parties card (seller/buyer breakdown).
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);
  // Counterparty profile opener (provided by the root OrderQuickView) + the
  // resolved target for THIS order's "View Profile" button.
  const openProfile = useContext(ProfileOpenContext);
  const activeCounterparty = deriveCounterparty(db, merchantId);
  const [showAddPayment, setShowAddPayment] = useLocalState(false);
  const [now, setNow] = useLocalState(() => Date.now());
  const [copiedId, setCopiedId] = useLocalState(false);
  // Completed-order rating widget (full-screen merchant view) — posts to
  // /api/ratings, which auto-routes the rating to the counterparty.
  const [rating, setRating] = useLocalState(0);
  const [reviewText, setReviewText] = useLocalState("");
  const [ratingBusy, setRatingBusy] = useLocalState(false);
  const [ratingDone, setRatingDone] = useLocalState(false);
  const [ratingErr, setRatingErr] = useLocalState<string | null>(null);
  // Buyer payment-method list: show up to 3, expand to reveal any extras.
  const [pmExpanded, setPmExpanded] = useLocalState(false);
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
    const r = Math.max(
      0,
      Math.floor((new Date(target).getTime() - now) / 1000),
    );
    return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(
      r % 60,
    ).padStart(2, "0")}`;
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
    // Show the canonical DB order_number (matches lists, chat, ledger, the user
    // app, and support lookups). Fall back to a derived ref only if it's absent.
    typeof db.order_number === "string" && db.order_number
      ? db.order_number
      : typeof db.id === "string" ? `BLP-${db.id.slice(0, 8).toUpperCase()}` : "—";

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
        return {
          heading: "Action Required",
          title: `Lock ${amount} USDT in escrow to start the trade.`,
          sub: "Buyer cannot send payment until escrow is locked.",
          Icon: Hourglass,
          urgent: true,
        };
      if (status === "escrowed")
        return {
          heading: "Escrow Locked",
          title: "Waiting for the buyer to send payment.",
          sub: "You'll be notified the moment they mark it as paid.",
          Icon: Clock,
          urgent: false,
        };
      if (status === "payment_sent")
        return {
          heading: "Action Required",
          title: `Buyer marked the ${ccy} payment as sent.`,
          sub: "Verify it landed in your account, then release the USDT.",
          Icon: ShieldCheck,
          urgent: true,
        };
    } else {
      if (status === "accepted")
        return {
          heading: "Please Wait",
          title: "Seller is locking USDT in escrow.",
          sub: `You can send ${ccy} once escrow is locked.`,
          Icon: Clock,
          urgent: false,
        };
      if (status === "escrowed")
        return {
          heading: "Action Required",
          title: `Send ${sym}${total.toLocaleString()} to the seller.`,
          sub: "Mark the payment as sent once you've paid.",
          Icon: Banknote,
          urgent: true,
        };
      if (status === "payment_sent")
        return {
          heading: "Please Wait",
          title: "Seller is verifying your payment.",
          sub: "USDT will be released to you once confirmed.",
          Icon: Clock,
          urgent: false,
        };
    }
    return {
      heading: "In Progress",
      title: "Trade in progress.",
      sub: "",
      Icon: Clock,
      urgent: false,
    };
  })();
  const BannerIcon = banner.Icon;

  // ---- counterparty trust (the buyer, when we're the seller) ----
  const cp = db.user || {};
  const trades = cp.total_trades ?? 0;
  const disputes = cp.dispute_count ?? 0;
  const verified = !!cp.is_verified;
  const ratingNum = typeof cp.rating === "number" ? cp.rating : null;
  const trustScore =
    ratingNum != null && ratingNum > 0
      ? Math.round((ratingNum / 5) * 100)
      : null;
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
    recv.methods.find((m) => m.is_default)?.id ??
    recv.methods[0]?.id ??
    null;

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
  const paymentMethodCard = !isSeller ? (
    // BUYER side (sell order): the merchant pays the seller, so show the
    // seller's locked receiving account with copy buttons — not a rails list.
    <SellerPayToCard order={order} />
  ) : (
    <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4 space-y-3">
      <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold">
        {pmHeading}
      </span>
      {payTypes.length > 0 ? (
        <div className="space-y-2.5">
          {payTypes.map((t) => {
            const m = PM_META[t] ?? {
              label: t.toUpperCase(),
              Icon: CreditCard,
            };
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
              <p className="text-[11px] text-foreground/40 mb-1">
                Preferred Method
              </p>
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

  // Important + What-happens-next guidance cards, extracted so they can be
  // rendered either in the normal spots (buyer / full-width) or parked in the
  // right column for the seller's escrowed/verify stages — where the right
  // column would otherwise sit empty beside the taller left column.
  const importantCard = (
    <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3 flex items-start gap-2.5">
      <AlertTriangle className="w-4 h-4 text-foreground/60 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-bold text-foreground">Important</p>
        <p className="text-xs text-foreground/50 mt-0.5">
          {isSeller
            ? "Do not release USDT until you have received the payment in your account."
            : status === "payment_sent"
            ? "Payment marked as sent. Your USDT is released automatically once the seller confirms it — no further action needed."
            : `Only mark as paid after you've actually sent the ${ccy}.`}
        </p>
      </div>
    </div>
  );

  const whatHappensNextCard = (
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
  );

  // Seller's escrowed/verify stages (everything except the lock stage): park
  // the guidance cards in the right column so it isn't left mostly empty.
  const guidanceInRight = isSeller && !needsLock;

  // Relative "created … ago" for the full-screen summary (mock: "2 min ago").
  const createdAgo = (() => {
    if (!db.created_at) return "";
    const diff = Math.max(0, now - new Date(db.created_at).getTime());
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr${h > 1 ? "s" : ""} ago`;
    const d = Math.floor(h / 24);
    return `${d} day${d > 1 ? "s" : ""} ago`;
  })();

  // ── Merchant-mobile FULL-SCREEN "Order Completed" layout (pixel spec) ─────
  // Shown once the trade is done (status `completed`): success hero, order
  // details, counterparty card, a star-rating widget (posts to /api/ratings),
  // and a tip. The app-bar title/Order-ID/Help and the "Back to Home" CTA are
  // rendered by the wrapper. Desktop/modal keep their own completed layout.
  if (fullScreen && status === "completed") {
    const completedAt = db.completed_at || db.updated_at || null;
    const fmtDT = (iso: string) => {
      const d = new Date(iso);
      const t = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      const dt = d.toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      return { t, dt, full: `${t}, ${dt}` };
    };
    const comp = completedAt ? fmtDT(completedAt) : null;
    const cryptoStr = `${formatCrypto(Number(amount) || 0)} USDT`;
    const fiatStr = `${sym}${formatCrypto(Number(order.total) || 0)} ${ccy}`;
    const pmText = PM_META[preferred ?? "bank"]?.label ?? "Bank Transfer";
    const releasedWord = isSeller ? "Released" : "Received";
    const heroSub = isSeller
      ? "You have confirmed the payment. The crypto has been released to the buyer."
      : "The seller confirmed your payment and released the crypto to you.";
    const cpName = (order.user as string) || (cp.name as string) || "Trader";
    // My own display name for the "You" row of the Trade Parties card.
    const meName =
      merchantInfo?.username ||
      merchantInfo?.display_name ||
      merchantInfo?.business_name ||
      "You";
    const meSeed =
      merchantInfo?.username || merchantInfo?.display_name || merchantId || "merchant";
    // Seller always funds escrow, buyer always pays fiat. Order the card
    // Seller-first so it reads top-to-bottom in trade order. `isYou` flags the
    // merchant's side; the counterparty side carries trust stats + View Profile.
    const parties: {
      role: "Seller" | "Buyer";
      name: string;
      seed: string;
      src?: string | null;
      isYou: boolean;
    }[] = [
      isSeller
        ? { role: "Seller", name: meName, seed: meSeed, isYou: true }
        : { role: "Seller", name: cpName, seed: cpName, src: order.user_avatar, isYou: false },
      isSeller
        ? { role: "Buyer", name: cpName, seed: cpName, src: order.user_avatar, isYou: false }
        : { role: "Buyer", name: meName, seed: meSeed, isYou: true },
    ];
    const cpHasStats =
      (ratingNum != null && ratingNum > 0) || trades > 0 || successRate != null;

    const submitRating = async () => {
      if (ratingBusy || ratingDone || rating < 1 || !merchantId) return;
      setRatingBusy(true);
      setRatingErr(null);
      try {
        const res = await fetchWithAuth("/api/ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: db.id,
            rater_type: "merchant",
            rater_id: merchantId,
            rating,
            review_text: reviewText.trim() || undefined,
          }),
        });
        const json = await res.json().catch(() => null);
        const msg = String(
          json?.error || json?.errors?.[0] || "",
        ).toLowerCase();
        // Treat "already rated" as success so a re-tap doesn't dead-end.
        if (res.ok || msg.includes("already")) {
          setRatingDone(true);
        } else {
          setRatingErr(
            json?.error ||
              json?.errors?.[0] ||
              "Couldn't submit rating. Please retry.",
          );
        }
      } catch {
        setRatingErr(
          "Couldn't submit rating. Check your connection and retry.",
        );
      } finally {
        setRatingBusy(false);
      }
    };

    return (
      <>
        {/* Success hero */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
          <div className="relative inline-flex items-center justify-center mb-4">
            <Sparkles className="w-4 h-4 text-emerald-400 absolute -left-6 -top-1" />
            <Sparkles className="w-3 h-3 text-emerald-400/80 absolute -right-6 top-0" />
            <Sparkles className="w-2.5 h-2.5 text-emerald-400/60 absolute -right-7 bottom-0" />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                damping: 12,
                stiffness: 200,
                delay: 0.05,
              }}
              className="w-16 h-16 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20 flex items-center justify-center"
            >
              <Check className="w-8 h-8 text-white" strokeWidth={3} />
            </motion.div>
          </div>
          <p className="text-2xl font-bold text-foreground mb-1.5">
            {cryptoStr} {releasedWord}
          </p>
          <p className="text-[13px] text-foreground/55 leading-snug px-2">
            {heroSub}
          </p>
          {comp && (
            <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-center gap-2 text-[12px] text-foreground/55">
              <Clock className="w-4 h-4 text-emerald-400" />
              Completed at {comp.t} • {comp.dt}
            </div>
          )}
        </div>

        {/* Order Details */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          <div className="flex items-center gap-2 px-4 pt-4 pb-1.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-[15px] font-semibold text-foreground">
              Order Details
            </p>
          </div>
          <div className="divide-y divide-white/[0.06] px-4">
            {[
              { label: isSeller ? "You Received" : "You Paid", value: fiatStr },
              {
                label: isSeller ? "You Released" : "You Received",
                value: cryptoStr,
              },
              {
                label: "Rate",
                value: `${sym}${formatCrypto(Number(order.rate) || 0)}`,
              },
              { label: "Payment Method", value: pmText },
              { label: "Completed", value: comp?.full ?? "—" },
            ].map((r) => (
              <div
                key={r.label}
                className="flex items-center justify-between gap-4 py-3"
              >
                <span className="text-[13px] text-foreground/55 shrink-0">
                  {r.label}
                </span>
                <span className="text-[13px] font-semibold text-foreground text-right">
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Trade Parties — seller (funded escrow) + buyer (paid fiat). Both
            sides are labeled so the completed record is self-explanatory; the
            counterparty row keeps trust stats + View Profile, my row gets a
            "You" badge. */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.06]">
          <div className="flex items-center gap-2 px-4 pt-4 pb-3">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <Users className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-[15px] font-semibold text-foreground">
              Trade Parties
            </p>
          </div>
          {parties.map((p) => (
            <div key={p.role} className="p-4 flex items-center gap-3">
              <div className="relative shrink-0">
                <UserAvatar seed={p.seed} src={p.src} size={44} />
                {!p.isYou && online && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#0e0e10]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground/40">
                    {p.role}
                  </span>
                  {p.isYou && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      YOU
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-[15px] font-semibold text-foreground truncate">
                    {p.name}
                  </p>
                  {!p.isYou && verified && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                </div>
                {!p.isYou && cpHasStats && (
                  <div className="flex items-center gap-1 text-[12px] text-foreground/55 mt-0.5">
                    {ratingNum != null && ratingNum > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                        {formatCrypto(ratingNum, { decimals: 1 })}
                      </span>
                    )}
                    {trades > 0 && <span>({formatCount(trades)} trades)</span>}
                    {successRate != null && (
                      <span>· {successRate}% completion</span>
                    )}
                  </div>
                )}
              </div>
              {!p.isYou && activeCounterparty && (
                <button
                  type="button"
                  onClick={() =>
                    openProfile(
                      activeCounterparty.entityType,
                      activeCounterparty.id,
                    )
                  }
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl text-[13px] font-semibold bg-foreground/[0.06] text-foreground border border-white/[0.08] hover:bg-foreground/[0.1] transition-colors"
                >
                  View Profile
                  <ChevronRight className="w-4 h-4 text-foreground/40" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* On-chain escrow proof — Tx ID, escrow/trade accounts, trade id with
            explorer links. Renders nothing when no escrow tx exists. */}
        <EscrowInfoCard order={order} />

        {/* Rating */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-400/15 flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-foreground">
                How was your trading experience?
              </p>
              <p className="text-[12px] text-foreground/45">
                Your feedback helps us improve Blip P2P
              </p>
            </div>
          </div>

          {ratingDone ? (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-emerald-400">
              <Check className="w-4 h-4" /> Thanks! You rated this trade{" "}
              {rating} star
              {rating === 1 ? "" : "s"}.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-1 mt-4 px-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={ratingBusy}
                    onClick={() => setRating(s)}
                    aria-label={`Rate ${s} star${s === 1 ? "" : "s"}`}
                    className="disabled:cursor-default"
                  >
                    <Star
                      className={`w-9 h-9 ${
                        s <= rating
                          ? "text-amber-400 fill-amber-400"
                          : "text-foreground/20"
                      }`}
                    />
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between px-1 mt-1.5">
                <span className="text-[10px] text-foreground/40">
                  Very Poor
                </span>
                <span className="text-[10px] text-foreground/40">
                  Excellent
                </span>
              </div>
              <div className="relative mt-3">
                <textarea
                  placeholder="Leave optional feedback…"
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  maxLength={300}
                  rows={2}
                  className="w-full p-3 pr-12 rounded-xl text-[13px] text-foreground bg-foreground/[0.04] border border-foreground/[0.08] resize-none outline-none placeholder:text-foreground/30 focus:border-foreground/20"
                />
                <span className="absolute bottom-2 right-3 text-[10px] text-foreground/30">
                  {reviewText.length}/300
                </span>
              </div>
              {ratingErr && (
                <p className="text-[11px] text-red-400 mt-2">{ratingErr}</p>
              )}
              {rating > 0 && (
                <button
                  type="button"
                  onClick={submitRating}
                  disabled={ratingBusy}
                  className="mt-3 w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-[13px] flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
                >
                  {ratingBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Star className="w-4 h-4" />
                  )}
                  Submit Rating
                </button>
              )}
            </>
          )}
        </div>

        {/* Tip */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 flex gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
            <Lightbulb className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground mb-0.5">
              Tip
            </p>
            <p className="text-[12px] text-foreground/55 leading-snug">
              Your positive feedback and ratings help build trust in the
              community.
            </p>
          </div>
        </div>
      </>
    );
  }

  // ── Merchant-mobile FULL-SCREEN "Verify Payment" layout (pixel spec) ──────
  // Seller's payment_sent stage: buyer marked fiat as sent, seller verifies it
  // landed and releases. Polished single-column stack: green Action-Required
  // banner, stepper (Verify Payment = CURRENT), counterparty + You Locked /
  // Buyer Will Pay, details grid, verify guidance, escrow + warning. Footer
  // (Confirm & Release / Raise Appeal / Need Help) is rendered by the wrapper.
  if (fullScreen && isSeller && status === "payment_sent") {
    const pmText = PM_META[preferred ?? "bank"]?.label ?? "Bank Transfer";
    const recvM = order.sellerPaymentMethod;
    const recvMasked = recvM ? maskAccountDetail(recvM.type, detailString(recvM.details)) : "";
    const recvT = (recvM?.type || "").toLowerCase();
    const RecvIcon = recvT === "bank" ? Building2 : recvT === "card" ? CreditCard : Smartphone;
    const VERIFY_STEPS: { label: string; Icon: typeof Lock }[] = [
      { label: "Accepted", Icon: Check },
      { label: "Escrow Locked", Icon: Lock },
      { label: "Buyer Pays", Icon: Banknote },
      { label: "Verify Payment", Icon: ShieldCheck },
      { label: "Release USDT", Icon: Rocket },
    ];
    return (
      <>
        {/* Action Required banner */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
          <div className="flex items-start gap-3">
            <div className="w-14 h-14 rounded-full border-2 border-emerald-500/40 flex items-center justify-center shrink-0">
              <Lock className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-emerald-400">Escrow Locked Successfully</p>
              <p className="text-[13px] text-foreground/80 mt-1 leading-snug">
                You have locked {formatCrypto(Number(amount) || 0)} USDT in escrow.
              </p>
              <p className="text-[13px] text-foreground/80 leading-snug">Waiting for buyer to make payment.</p>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              {expiresIn && (
                <span className="flex items-center gap-1 text-[10px] text-foreground/40 whitespace-nowrap">
                  <Clock className="w-3 h-3" /> Expires in{" "}
                  <span className="font-mono font-bold text-emerald-400">{expiresIn}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stepper — Verify Payment current */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-start justify-between">
            {VERIFY_STEPS.map((s, i) => {
              const done = i < currentStep;
              const current = i === currentStep;
              const Icon = s.Icon;
              return (
                <Fragment key={i}>
                  <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center ${
                        done || current
                          ? "bg-emerald-500 text-white"
                          : "bg-white/[0.04] text-foreground/30 border border-white/[0.06]"
                      }`}
                    >
                      {done ? <Check className="w-4 h-4" strokeWidth={3} /> : <Icon className="w-4 h-4" />}
                    </div>
                    <span
                      className={`text-[9px] text-center leading-tight ${
                        done ? "text-foreground/60" : current ? "text-emerald-400 font-semibold" : "text-foreground/30"
                      }`}
                    >
                      {s.label}
                    </span>
                    {current && (
                      <span className="text-[8px] text-emerald-400 font-bold uppercase tracking-wide">Current</span>
                    )}
                  </div>
                  {i < VERIFY_STEPS.length - 1 && (
                    <ChevronRight
                      className={`w-3 h-3 mt-3 shrink-0 ${i < currentStep ? "text-emerald-500/50" : "text-foreground/15"}`}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* Amounts — You Locked / Buyer Will Pay (merchant-profile card skipped per request) */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-0.5 border-r border-white/[0.06] pr-4">
              <p className="text-[10px] text-foreground/40">You Locked</p>
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-bold text-foreground leading-none">{formatCrypto(Number(amount) || 0)}</span>
                <span className="text-sm font-semibold text-foreground/60">USDT</span>
                <Coins className="w-3.5 h-3.5 text-emerald-400/70" />
              </div>
              <p className="text-[12px] text-foreground/70">
                ≈ {sym}{formatCrypto(Number(order.total) || 0)} {ccy}
              </p>
              <p className="text-[10px] text-foreground/40">@ {formatCrypto(Number(order.rate) || 0)} {ccy}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-foreground/40 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Buyer Will Pay
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-bold text-foreground leading-none">
                  {sym}{formatCrypto(Number(order.total) || 0)}
                </span>
                <span className="text-sm font-semibold text-foreground/60">{ccy}</span>
              </div>
              <p className="text-[10px] text-foreground/40">@ {formatCrypto(Number(order.rate) || 0)} {ccy}</p>
            </div>
          </div>
        </div>

        {/* Details grid */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            <div className="flex items-start gap-2 border-r border-white/[0.06] pr-4">
              <FileText className="w-3.5 h-3.5 text-foreground/40 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Order ID</p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(orderIdShort);
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 2000);
                  }}
                  className="flex items-center gap-1 font-mono text-[12px] text-foreground/70 hover:text-foreground"
                >
                  <span className="truncate">{orderIdShort}</span>
                  {copiedId ? (
                    <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <Copy className="w-3 h-3 text-foreground/30 shrink-0" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 text-foreground/40 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Rate (Locked)</p>
                <p className="text-[12px] font-mono text-foreground/70">1 USDT = {formatCrypto(Number(order.rate) || 0)} {ccy}</p>
              </div>
            </div>
            <div className="flex items-start gap-2 border-r border-white/[0.06] pr-4">
              <Building2 className="w-3.5 h-3.5 text-foreground/40 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Payment Method</p>
                <p className="text-[12px] text-foreground/70">{pmText}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="w-3.5 h-3.5 text-foreground/40 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Created</p>
                <p className="text-[12px] text-foreground/70">{createdAgo || "—"}</p>
              </div>
            </div>
            {recvM && (
              <div className="flex items-start gap-2 border-r border-white/[0.06] pr-4">
                <RecvIcon className="w-3.5 h-3.5 text-foreground/40 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-foreground/40">Receive Payment In</p>
                  <p className="text-[12px] font-mono text-foreground/70 truncate">{recvMasked || recvM.name}</p>
                  {recvMasked && recvM.name && (
                    <p className="text-[10px] text-foreground/40 truncate">{recvM.name}</p>
                  )}
                </div>
              </div>
            )}
            <div className="flex items-start gap-2">
              <Clock className="w-3.5 h-3.5 text-emerald-400/70 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-foreground/40">Expected Completion</p>
                <p className="text-[12px] text-foreground/70">~ 10 min</p>
              </div>
            </div>
          </div>
        </div>

        {/* Escrow protects */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-400">Escrow protects both parties</p>
            <p className="text-[12px] text-foreground/50 mt-0.5 leading-snug">
              Your funds are secured in escrow. They will be released to buyer once you confirm payment.
            </p>
          </div>
        </div>

        {/* Do-not-release warning */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-foreground/50 mt-0.5 shrink-0" />
          <p className="text-[12px] text-foreground/55 leading-snug">
            <span className="text-foreground/80 font-medium">
              Do not release USDT until you have received the payment in your account.
            </span>{" "}
            Releasing before payment may result in loss of funds.
          </p>
        </div>
      </>
    );
  }

  // ── Merchant-mobile FULL-SCREEN lock layout (pixel spec) ──────────────────
  // Bespoke single-column stack matching the Lock Escrow mock: green Action
  // Required banner, green-accented stepper, 2-col Order Summary, Payment
  // Method + Expected Completion row, "Receive Payment In" picker, green
  // "Escrow protects both parties" banner, and the 4-up assurance footer. Only
  // the lock stage (seller, accepted) uses this; other stages + desktop fall
  // through to the standard layout below, so nothing else changes.
  if (fullScreen && needsLock) {
    return (
      <>
        {/* Action Required banner */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-bold text-emerald-400">
                  Action Required
                </p>
                {expiresIn && (
                  <span className="flex items-center gap-1 text-[10px] text-foreground/40 shrink-0 whitespace-nowrap">
                    <Clock className="w-3 h-3" /> Expires in{" "}
                    <span className="font-mono font-bold text-emerald-400">
                      {expiresIn}
                    </span>
                  </span>
                )}
              </div>
              <p className="text-[13px] font-semibold text-foreground mt-1 leading-snug">
                Lock {amount} USDT in escrow to start the trade.
              </p>
              <p className="text-[11px] text-foreground/45 mt-0.5">
                Buyer cannot send payment until escrow is locked.
              </p>
            </div>
          </div>
        </div>

        {/* Progress stepper (green current) */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-start justify-between">
            {STEPS.map((s, i) => {
              const done = i < currentStep;
              const current = i === currentStep;
              // Final step renders a rocket and "Buyer Pays" (index 2) a card,
              // per the mock; others use the stage icon. Full-screen only.
              const Icon =
                i === STEPS.length - 1 ? Rocket : i === 2 ? CreditCard : s.Icon;
              return (
                <Fragment key={i}>
                  <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center ${
                        done || current
                          ? "bg-emerald-500 text-white"
                          : "bg-white/[0.04] text-foreground/30 border border-white/[0.06]"
                      }`}
                    >
                      {done ? (
                        <Check className="w-4 h-4" strokeWidth={3} />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                    </div>
                    <span
                      className={`text-[9px] text-center leading-tight ${
                        done
                          ? "text-foreground/60"
                          : current
                          ? "text-emerald-400 font-semibold"
                          : "text-foreground/30"
                      }`}
                    >
                      {s.label}
                    </span>
                    {current && (
                      <span className="text-[8px] text-emerald-400 font-bold uppercase tracking-wide">
                        Current
                      </span>
                    )}
                  </div>
                  {i < STEPS.length - 1 && (
                    <ChevronRight
                      className={`w-3 h-3 mt-3 shrink-0 ${
                        i < currentStep
                          ? "text-emerald-500/50"
                          : "text-foreground/15"
                      }`}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* Order Summary — 2 columns (amount | rate/id/created) */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <span className="block text-[10px] text-foreground/40 uppercase tracking-wide font-bold mb-3">
            Order Summary
          </span>
          <div className="grid grid-cols-[4fr_6fr] gap-4">
            <div className="space-y-1 border-r border-white/[0.06] pr-4">
              <p className="text-[10px] text-foreground/40">You Lock</p>
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-bold text-foreground leading-none">
                  {amount}
                </span>
                <span className="text-sm font-semibold text-foreground/60">
                  USDT
                </span>
                <Coins className="w-3.5 h-3.5 text-emerald-400/70" />
              </div>
              <p className="text-[12px] text-foreground/70">
                ≈ {sym}
                {total.toLocaleString()} {ccy}
              </p>
              <p className="text-[10px] text-foreground/40">
                @ {order.rate} {ccy}
              </p>
            </div>
            <div className="space-y-2 text-[11px] min-w-0">
              <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-0.5">
                <span className="text-foreground/40 flex items-center gap-1 whitespace-nowrap shrink-0">
                  <Lock className="w-3 h-3 shrink-0" /> Rate (Locked)
                </span>
                <span className="font-mono text-foreground/70 text-right whitespace-nowrap">
                  1 USDT = {order.rate} {ccy}
                </span>
              </div>
              <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-0.5">
                <span className="text-foreground/40 whitespace-nowrap shrink-0">Order ID</span>
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
              {createdAgo && (
                <div className="flex flex-wrap justify-between items-center gap-x-2 gap-y-0.5">
                  <span className="text-foreground/40 whitespace-nowrap shrink-0">Created</span>
                  <span className="text-foreground/60 whitespace-nowrap">{createdAgo}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Payment Method + Expected Completion */}
        <div className="grid grid-cols-2 gap-3">
          {/* Payment Method — mock spec: tile + method + check + descriptor +
              "Preferred Method" pill. Bespoke here (the shared card lists all
              rails) so desktop is untouched. */}
          {(() => {
            // Show up to 3 of the buyer's selected pay methods; if they picked
            // more, "+N more" expands the rest. Compact half-width list.
            const visible = pmExpanded ? payTypes : payTypes.slice(0, 3);
            const extra = payTypes.length - 3;
            return (
              <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
                <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold mb-2.5">
                  Buyer Payment Method
                </span>
                {payTypes.length > 0 ? (
                  <div className="space-y-2">
                    {visible.map((t) => {
                      const m = PM_META[t] ?? { label: t.toUpperCase(), Icon: CreditCard };
                      const Icon = m.Icon;
                      return (
                        <div key={t} className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-foreground/[0.06] border border-foreground/[0.06] flex items-center justify-center shrink-0">
                            <Icon className="w-3 h-3 text-foreground/70" />
                          </div>
                          <span className="text-xs font-semibold text-foreground flex-1 min-w-0 truncate">
                            {m.label}
                          </span>
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={3} />
                        </div>
                      );
                    })}
                    {extra > 0 && (
                      <button
                        type="button"
                        onClick={() => setPmExpanded((v) => !v)}
                        className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        {pmExpanded ? "Show less" : `+${extra} more`}
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-[12px] text-foreground/40">
                    Shared in chat once escrow is locked.
                  </p>
                )}
              </div>
            );
          })()}
          <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
            <span className="block text-[11px] text-foreground/40 uppercase tracking-wide font-bold mb-2">
              Expected Completion
            </span>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-foreground/50" />
              <span className="text-base font-bold text-foreground">
                ~ 10 min
              </span>
            </div>
            <p className="text-[12px] text-foreground/45 mt-1 leading-snug">
              Usually completed in 5–10 min
            </p>
          </div>
        </div>

        {/* Receive Payment In — seller's receiving-account picker */}
        <ReceivingAccountPicker
          methods={recv.methods}
          selectedId={recvSelectedId}
          onSelect={setRecvPickedId}
          onAddNew={() => {
            if (merchantId) setShowAddPayment(true);
            else router.push("/market/settings");
          }}
          loading={recv.loading}
          surfaces={SURFACES.merchant}
          title="Receive Payment In"
          subtitle="Choose account where you want to receive payment"
          addLabel="Add Another Account / UPI"
          dense
        />
        {merchantId && (
          <PaymentMethodModal
            isOpen={showAddPayment}
            merchantId={merchantId}
            onClose={() => {
              setShowAddPayment(false);
              recv.refetch();
            }}
          />
        )}

        {/* Escrow protects both parties */}
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-400">
                Escrow protects both parties
              </p>
              <p className="text-[12px] text-foreground/50 mt-0.5 leading-snug">
                Your funds are secured in escrow until payment is confirmed.
              </p>
            </div>
          </div>
        </div>

        {/* Assurance footer: You Must Lock (top) + 3 guarantees (full-width row
            below). Stacked so the guarantees fit on a phone instead of being
            pushed off the right edge. */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3 space-y-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full border border-foreground/15 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-foreground/60" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-foreground/50">You Must Lock</p>
              <p className="text-[15px] font-bold text-foreground leading-tight">
                {amount} USDT
              </p>
              <p className="text-[10px] text-foreground/40 leading-tight">
                This amount will be secured in escrow.
              </p>
            </div>
          </div>
          <div className="flex items-start justify-between gap-2 pt-2.5 border-t border-white/[0.06]">
            {[
              {
                Icon: Shield,
                title: "Escrow Protection",
                sub: "Your funds are 100% secure",
              },
              {
                Icon: RotateCw,
                title: "Auto Release",
                sub: "Funds released after confirmation",
              },
              {
                Icon: Headphones,
                title: "24/7 Support",
                sub: "We're here to help you",
              },
            ].map((f) => {
              const Icon = f.Icon;
              return (
                <div
                  key={f.title}
                  className="flex flex-col items-center text-center gap-0.5 flex-1 min-w-0"
                >
                  <Icon className="w-3.5 h-3.5 text-foreground/50" />
                  <span className="text-[9px] font-semibold text-foreground/70 leading-tight">
                    {f.title}
                  </span>
                  <span className="text-[8px] text-foreground/35 leading-tight">
                    {f.sub}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  }

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
              className={`w-5 h-5 ${
                banner.urgent ? "text-foreground/70" : "text-foreground/50"
              }`}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p
                className={`text-sm font-bold ${
                  banner.urgent ? "text-foreground" : "text-foreground/70"
                }`}
              >
                {banner.heading}
              </p>
              {expiresIn && (
                <span className="flex items-center gap-1 text-[11px] text-foreground/40 shrink-0 whitespace-nowrap">
                  <Clock className="w-3 h-3" /> Expires in{" "}
                  <span className="font-mono font-bold text-foreground/70">
                    {expiresIn}
                  </span>
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
                    {done ? (
                      <Check className="w-4 h-4" strokeWidth={3} />
                    ) : (
                      <Icon className="w-4 h-4" />
                    )}
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
                    className={`w-3 h-3 mt-3 shrink-0 ${
                      i < currentStep
                        ? "text-emerald-500/50"
                        : "text-foreground/15"
                    }`}
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
              <span className="text-2xl font-bold text-foreground">
                {amount}
              </span>
              <span className="text-sm font-semibold text-foreground/60">
                USDT
              </span>
              <Coins className="w-4 h-4 text-emerald-400/70" />
              {/* Seller gives USDT / receives fiat; buyer gets USDT / pays fiat. */}
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-foreground/35">
                {isSeller ? "You pay" : "You get"}
              </span>
            </div>
            <div className="flex items-baseline gap-2 text-lg font-bold text-foreground">
              <span>
                {sym} {total.toLocaleString()}{" "}
                <span className="text-xs font-medium text-foreground/40">
                  {ccy}
                </span>
              </span>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-foreground/35">
                {isSeller ? "You get" : "You pay"}
              </span>
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
                  <span className="font-mono text-emerald-400 font-bold">
                    {expiresIn}
                  </span>
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
                // Open the Add Payment Method modal inline instead of leaving
                // the lock flow — the new account shows up in this picker on
                // close (recv.refetch). Falls back to settings nav only if the
                // merchant id isn't hydrated yet.
                if (merchantId) setShowAddPayment(true);
                else router.push("/market/settings");
              }}
              loading={recv.loading}
              surfaces={SURFACES.merchant}
            />
          )}

          {/* Add Payment Method — opens inline over the lock flow; refetch on
              close so a newly added account appears in the picker immediately. */}
          {merchantId && (
            <PaymentMethodModal
              isOpen={showAddPayment}
              merchantId={merchantId}
              onClose={() => {
                setShowAddPayment(false);
                recv.refetch();
              }}
            />
          )}

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
              const RecvIcon =
                t === "bank"
                  ? Building2
                  : t === "card"
                  ? CreditCard
                  : Smartphone;
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
                        <p className="text-[11px] text-foreground/40 truncate">
                          {m.name}
                        </p>
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
              the right replaces this. For the seller's escrowed/verify stages it
              moves to the right column (guidanceInRight); the buyer keeps it here. */}
          {!needsLock && !guidanceInRight && importantCard}
        </div>

        {/* Right column */}
        <div className="space-y-3">
          {/* Counterparty payment method — at the lock stage this moves to the
              left column (below) so the two columns stay balanced. */}
          {!needsLock && paymentMethodCard}

          {/* On-chain escrow proof — buyer side (paying a sell order): show the
              seller's USDT is genuinely locked while you pay / wait for release. */}
          {!isSeller && !needsLock && <EscrowInfoCard order={order} />}

          {/* Seller's escrowed/verify stages: guidance cards live here so the
              right column isn't left empty beside the taller left column. */}
          {guidanceInRight && importantCard}
          {guidanceInRight && whatHappensNextCard}

          {/* Lock-stage right-side cards — mirror the Lock Escrow modal */}
          {needsLock && (
            <>
              {/* Buyer payment method — informational at the lock stage, so it
                  lives in the right column with the guidance cards. This keeps
                  the two columns balanced (left = summary + account picker) and
                  removes the empty space that appeared when the right column
                  only held Tips + Important. */}
              {paymentMethodCard}

              {/* Tips */}
              <div className="bg-foreground/[0.02] border border-foreground/[0.04] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-foreground/50" />
                  <span className="text-[13px] font-semibold text-foreground">
                    Tips
                  </span>
                </div>
                <ul className="space-y-1.5 text-[12px] text-foreground/50 list-disc pl-4">
                  <li>
                    Choose the account where you can quickly verify payments.
                  </li>
                  <li>
                    This account cannot be changed after escrow is locked.
                  </li>
                </ul>
              </div>

              {/* Important */}
              <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-foreground/60" />
                  <span className="text-[13px] font-semibold text-foreground">
                    Important
                  </span>
                </div>
                <ul className="space-y-1.5 text-[12px] text-foreground/60 list-disc pl-4">
                  <li>
                    Only lock escrow if you are available to complete this
                    trade.
                  </li>
                  <li>
                    Do not release USDT until funds arrive in your bank account.
                  </li>
                </ul>
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
              {
                Icon: Shield,
                title: "Escrow Protection",
                sub: "Your funds are 100% secure",
              },
              {
                Icon: RotateCw,
                title: "Auto Release",
                sub: "Funds released after confirmation",
              },
              {
                Icon: Headphones,
                title: "24/7 Support",
                sub: "We're here to help you",
              },
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

      {/* What happens next — full width for the buyer; the seller's copy lives
          in the right column (guidanceInRight). The lock stage has its own. */}
      {!needsLock && !guidanceInRight && whatHappensNextCard}
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
  /** Presentation mode. `"modal"` (default) = centered/bottom-sheet popup used
   *  everywhere (desktop + the existing mobile flows). `"fullscreen"` = a full
   *  in-app screen with a back-arrow app-bar header — used ONLY for active /
   *  in-progress orders on merchant mobile (see MerchantModals mobileOrderDetail).
   *  Body, footer and all handlers are identical; only the wrapper/header differ. */
  presentation?: "modal" | "fullscreen";
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
  presentation = "modal",
}: OrderQuickViewProps) {
  const router = useRouter();
  // Receiving account the seller picked in ActiveOrderBody — bubbled up so the
  // footer "Lock Escrow" button can pass it to the inline lock.
  const [lockMethodId, setLockMethodId] = useLocalState<string | null>(null);

  // Whether the seller's waiting stage has passed its deadline — bubbled up
  // from ActiveOrderBody so the footer can show Need Help / Raise Appeal.
  const [waitingTimedOut, setWaitingTimedOut] = useLocalState(false);

  // Copy feedback for the Order ID shown in the completed-order app-bar.
  const [hdrCopied, setHdrCopied] = useLocalState(false);

  // Counterparty profile sheet — opened from the header avatar/name, the
  // CounterpartyTrustCard, or the "View Profile" button (all via context).
  const [profileTarget, setProfileTarget] = useLocalState<{
    entityType: ProfileEntityType;
    id: string;
  } | null>(null);
  const openProfile = (entityType: ProfileEntityType, id: string) =>
    setProfileTarget({ entityType, id });

  // After an inline lock for THIS order finishes successfully (was locking →
  // no longer locking, no error), close the popup. The popup's `selectedOrder`
  // copy is stale (still "accepted"), so leaving it open would show the Lock
  // button again and risk a second lock; the order list reflects the escrowed
  // state. On error we keep it open so the inline message shows.
  const wasLockingRef = useLocalRef(false);
  useLocalEffect(() => {
    const isLockingThis =
      !!selectedOrder && lockingEscrowOrderId === selectedOrder.id;
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
  const qvStatus = String(
    qvDb.status || qvDb.minimal_status || "",
  ).toLowerCase();
  const isAcceptableBuyOrder =
    !!selectedOrder &&
    !isOwnPendingBuy &&
    qvDb.buyer_merchant_id !== merchantId &&
    !qvDb.accepted_at &&
    ![
      "accepted",
      "escrowed",
      "payment_sent",
      "completed",
      "cancelled",
      "expired",
      "disputed",
    ].includes(qvStatus) &&
    Array.isArray(qvDb.buyer_payment_types) &&
    qvDb.buyer_payment_types.length > 0;
  // A SELL order sitting in the open market that this merchant can CLAIM as the
  // buyer: the seller already funded escrow (status 'escrowed') and no buyer
  // merchant has taken it yet. Drives the rich AcceptorSellOrderBody (mirrors
  // the buy-claim layout) instead of the bare fallback body.
  //
  // The `type` column is reliable only for U2M. For M2M the role is by slot —
  // merchant_id is ALWAYS the seller, buyer_merchant_id ALWAYS the buyer — so an
  // M2M sell-side open slot legitimately carries type='buy' and the bare
  // type==='sell' literal would drop it into the old fallback body. Detect M2M
  // by the placeholder user and accept it regardless of the type string; the
  // remaining conditions (escrowed + buyer slot still open + viewer is a
  // non-party observer) already pin it to a claimable seller-funded order.
  const qvUsername = String((qvDb as { user?: { username?: string } }).user?.username || "");
  const qvIsM2MPlaceholder =
    qvUsername.startsWith("open_order_") || qvUsername.startsWith("m2m_");
  const isClaimableSellOrder =
    !!selectedOrder &&
    !isOwnPendingBuy &&
    !isAcceptableBuyOrder &&
    (String(qvDb.type || "").toLowerCase() === "sell" || qvIsM2MPlaceholder) &&
    qvStatus === "escrowed" &&
    !qvDb.buyer_merchant_id &&
    qvDb.merchant_id !== merchantId &&
    selectedOrder.myRole !== "seller" &&
    selectedOrder.myRole !== "buyer";
  // In-progress order the merchant is party to (seller or buyer): drives the
  // rich, stage-aware ActiveOrderBody. Excludes the pending/acceptable cases
  // above and observer-claimable orders (those keep their own flows).
  const isActiveOrder =
    !!selectedOrder &&
    !isOwnPendingBuy &&
    !isAcceptableBuyOrder &&
    !isClaimableSellOrder &&
    (selectedOrder.myRole === "seller" || selectedOrder.myRole === "buyer") &&
    (["accepted", "escrowed", "payment_sent"].includes(qvStatus) ||
      // Completed orders get the rich body too, but only on the full-screen
      // mobile view (its "Order Completed" layout). Desktop/modal completed
      // orders keep their existing standard layout — no regression.
      (presentation === "fullscreen" && qvStatus === "completed"));
  const activeRole: "buyer" | "seller" =
    selectedOrder?.myRole === "buyer" ? "buyer" : "seller";
  // Full-screen presentation (merchant mobile, active orders) — see prop doc.
  const isFull = presentation === "fullscreen";
  // Stage-aware app-bar title for the full-screen header. Mirrors the active
  // stage shown in ActiveOrderBody so the title stays accurate as the order
  // moves accepted → escrowed → payment_sent.
  const fullScreenTitle = (() => {
    if (!selectedOrder) return "Order";
    if (qvStatus === "completed") return "Order Completed";
    if (isActiveOrder) {
      if (qvStatus === "accepted") return "Lock Escrow";
      if (qvStatus === "escrowed") return "Buyer Pays";
      // payment_sent: the SELLER verifies; the BUYER is just waiting for release.
      if (qvStatus === "payment_sent")
        return activeRole === "buyer" ? "Payment Sent" : "Verify Payment";
    }
    return "Order Details";
  })();
  const fullScreenOrderId =
    // Canonical DB order_number (consistent with every other surface); derived
    // ref only as a fallback when order_number is missing.
    typeof qvDb.order_number === "string" && qvDb.order_number
      ? qvDb.order_number
      : typeof qvDb.id === "string"
      ? `BLP-${qvDb.id.slice(0, 8).toUpperCase()}`
      : "—";
  // Profile target for the popup header avatar/name (null → not tappable).
  const qvCounterparty = deriveCounterparty(qvDb, merchantId);
  return (
    <ProfileOpenContext.Provider value={openProfile}>
    <AnimatePresence>
      {selectedOrder && (
        <>
          {/* Dim click-to-close overlay — modal only. Full screen fills the
              viewport with its own opaque background, so no overlay. */}
          {!isFull && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={onClose}
            />
          )}
          <motion.div
            initial={
              isFull
                ? { opacity: 0, x: 24 }
                : { opacity: 0, scale: 0.95, y: 20 }
            }
            animate={
              isFull ? { opacity: 1, x: 0 } : { opacity: 1, scale: 1, y: 0 }
            }
            exit={
              isFull
                ? { opacity: 0, x: 24 }
                : { opacity: 0, scale: 0.95, y: 20 }
            }
            className={
              isFull
                ? "fixed inset-0 z-50 w-full h-dvh max-h-dvh flex flex-col overflow-hidden pb-safe"
                : `fixed z-50 inset-x-0 bottom-0 mx-auto w-full ${
                    isActiveOrder
                      ? "max-w-2xl"
                      : isAcceptableBuyOrder
                      ? "max-w-xl"
                      : "max-w-md"
                  } lg:inset-x-auto lg:bottom-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-[90%] max-h-[90dvh] flex flex-col overflow-hidden rounded-t-2xl lg:rounded-2xl shadow-2xl pb-safe lg:pb-0`
            }
            style={{
              background: "#0e0e10",
              border: isFull ? "none" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {/* Header — full-screen app-bar (back arrow + stage title + shield)
                on merchant mobile; the rich avatar/name header otherwise. */}
            {isFull ? (
              <div className="px-4 py-3 border-b border-foreground/[0.06] flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    onClick={onClose}
                    aria-label="Back"
                    className="p-1.5 -ml-1.5 rounded-lg hover:bg-foreground/[0.06] transition-colors shrink-0"
                  >
                    <ArrowLeft className="w-5 h-5 text-foreground" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-foreground truncate leading-tight">
                      {fullScreenTitle}
                    </p>
                    {qvStatus === "completed" && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(fullScreenOrderId);
                          setHdrCopied(true);
                          setTimeout(() => setHdrCopied(false), 2000);
                        }}
                        className="flex items-center gap-1 text-[11px] text-foreground/45 hover:text-foreground/70 transition-colors"
                      >
                        Order ID:{" "}
                        <span className="font-mono">{fullScreenOrderId}</span>
                        {hdrCopied ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3 text-foreground/30" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
                {qvStatus === "completed" ? (
                  <button
                    onClick={() => {
                      // Carry the order id so "back" from the support screen
                      // reopens this exact order (see /market reopen effect)
                      // instead of dropping the merchant on the settings list.
                      const returnOrderId = isFull ? selectedOrder?.id : null;
                      onClose();
                      router.push(
                        returnOrderId
                          ? `/market/settings?tab=support&returnOrder=${returnOrderId}`
                          : "/market/settings?tab=support",
                      );
                    }}
                    className="flex items-center gap-1.5 px-2.5 h-9 rounded-lg bg-foreground/5 border border-foreground/[0.06] text-foreground/70 hover:text-foreground transition-colors shrink-0"
                  >
                    <HelpCircle className="w-4 h-4" />
                    <span className="text-[13px] font-medium">Help</span>
                  </button>
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-foreground/5 border border-foreground/[0.06] flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Header — avatar + name tap to open the counterparty profile */}
                <div className="px-5 py-4 border-b border-foreground/[0.04] flex items-center justify-between shrink-0">
                  <div
                    className={`flex items-center gap-3 ${
                      qvCounterparty ? "cursor-pointer" : ""
                    }`}
                    onClick={
                      qvCounterparty
                        ? () =>
                            openProfile(
                              qvCounterparty.entityType,
                              qvCounterparty.id,
                            )
                        : undefined
                    }
                    role={qvCounterparty ? "button" : undefined}
                  >
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
                        {selectedOrder.myRole &&
                          selectedOrder.myRole !== "observer" && (
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
              </>
            )}

            {/* Scrollable middle — fills remaining height between pinned header & footer */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {/* Body — tighter gutters on the full-screen mobile view (less
                space under the app-bar and at the screen edges). */}
              <div
                className={
                  isFull ? "px-4 pt-3 pb-4 space-y-4" : "p-5 space-y-4"
                }
              >
                {isAcceptableBuyOrder ? (
                  <AcceptorBuyOrderBody order={selectedOrder} db={qvDb} />
                ) : isClaimableSellOrder ? (
                  <AcceptorSellOrderBody order={selectedOrder} db={qvDb} />
                ) : isActiveOrder ? (
                  <ActiveOrderBody
                    order={selectedOrder}
                    db={qvDb}
                    role={activeRole}
                    onRecvSelectionChange={setLockMethodId}
                    onWaitingTimeout={setWaitingTimedOut}
                    fullScreen={isFull}
                  />
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
                              href={getBlipscanTradeUrl(
                                selectedOrder.escrowPda,
                              )}
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
                          1 USDT = {selectedOrder.rate}{" "}
                          {selectedOrder.toCurrency || "AED"}
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
                        return (
                          <BuyerPayTypesCard types={qvDb.buyer_payment_types} />
                        );
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
                              title={`Send ${
                                selectedOrder.toCurrency || "AED"
                              } to this account`}
                              currencySymbol={fiatSymbol(
                                selectedOrder.toCurrency,
                              )}
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
                            <div className="text-xs text-white/60">
                              {detailStr}
                            </div>
                            <div className="text-right text-sm font-semibold text-[#f5f5f7]">
                              {Math.round(selectedOrder.total)}{" "}
                              {selectedOrder.toCurrency || "AED"}
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
                              title={`Send ${
                                selectedOrder.toCurrency || "AED"
                              } to this account`}
                              currencySymbol={fiatSymbol(
                                selectedOrder.toCurrency,
                              )}
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
                            title={`Send ${
                              selectedOrder.toCurrency || "AED"
                            } to this account`}
                            currencySymbol={fiatSymbol(
                              selectedOrder.toCurrency,
                            )}
                            bankName={selectedOrder.sellerBankDetails.bank_name}
                            accountName={
                              selectedOrder.sellerBankDetails.account_name
                            }
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
                            title={`Send ${
                              selectedOrder.toCurrency || "AED"
                            } to this account`}
                            currencySymbol={fiatSymbol(
                              selectedOrder.toCurrency,
                            )}
                            bankName={details?.bank_name}
                            accountName={details?.account_name}
                            iban={details?.iban}
                            fallbackText={
                              !details
                                ? selectedOrder.userBankAccount
                                : undefined
                            }
                            amount={Math.round(selectedOrder.total)}
                          />
                        );
                      }

                      return (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                          <p className="text-xs text-red-400">
                            No payment details provided. Chat to get bank
                            details.
                          </p>
                        </div>
                      );
                    })()}

                    {/* Status message for SELLER waiting for buyer */}
                    {(() => {
                      const popupSellerRole =
                        selectedOrder.myRole || "observer";
                      const popupStatus = selectedOrder.dbOrder?.status;
                      const popupAccepted =
                        !!selectedOrder.dbOrder?.accepted_at;

                      if (
                        popupSellerRole === "seller" &&
                        (popupStatus === "escrowed" ||
                          popupStatus === "accepted")
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
                const extBy = dbOrder?.extension_requested_by as
                  | string
                  | null
                  | undefined;
                const extMin = dbOrder?.extension_minutes as
                  | number
                  | null
                  | undefined;
                if (!extBy) return null;

                // Did I request it, or did the counterparty?
                const iAmMerchant = !!merchantId;
                const iRequested =
                  (extBy === "merchant" && iAmMerchant) ||
                  (extBy === "user" && !iAmMerchant);

                if (!iRequested) {
                  // Counterparty requested — I need to respond
                  const durationLabel =
                    extMin && extMin >= 60
                      ? `${Math.round(extMin / 60)} hour${
                          Math.round(extMin / 60) !== 1 ? "s" : ""
                        }`
                      : `${extMin || 15} minutes`;
                  return (
                    <div className="mx-5 mb-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-amber-400" />
                        <span className="text-sm font-semibold text-amber-400">
                          {extBy === "user" ? "Buyer" : "Merchant"} requested +
                          {durationLabel} extension
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <motion.button
                          whileTap={{ scale: 0.98 }}
                          onClick={async () => {
                            try {
                              const res = await fetchWithAuth(
                                `/api/orders/${selectedOrder.id}/extension`,
                                {
                                  method: "PUT",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    actor_type: iAmMerchant
                                      ? "merchant"
                                      : "user",
                                    actor_id:
                                      merchantId ||
                                      selectedOrder.dbOrder?.user_id,
                                    accept: true,
                                  }),
                                },
                              );
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
                              const res = await fetchWithAuth(
                                `/api/orders/${selectedOrder.id}/extension`,
                                {
                                  method: "PUT",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    actor_type: iAmMerchant
                                      ? "merchant"
                                      : "user",
                                    actor_id:
                                      merchantId ||
                                      selectedOrder.dbOrder?.user_id,
                                    accept: false,
                                  }),
                                },
                              );
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
                      <p className="text-sm font-medium text-amber-400">
                        Extension Request Sent
                      </p>
                      <p className="text-xs text-foreground/40">
                        Waiting for counterparty to respond
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>
            {/* End scrollable middle */}

            {/* Actions — Backend-driven: only show what enrichOrderResponse allows */}
            <div
              className={`${
                isFull ? "px-4 pt-3 pb-4" : "px-5 pt-4 pb-5"
              } space-y-2 shrink-0 border-t border-foreground/[0.04]`}
            >
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
              {!isOwnPendingBuy &&
                !isAcceptableBuyOrder &&
                (() => {
                  // Completed order on the full-screen mobile view → a single
                  // "Back to Home" CTA (the trade is done; nothing left to act on).
                  if (isFull && qvStatus === "completed") {
                    return (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          onClose();
                          router.push("/market");
                        }}
                        className="w-full py-3 rounded-xl bg-[#f5f5f7] hover:bg-white text-black font-semibold text-sm transition-all"
                      >
                        Back to Home
                      </motion.button>
                    );
                  }
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
                      ? "Confirm Payment and Release"
                      : primary.type === "SEND_PAYMENT"
                      ? "I've Sent the Payment"
                      : primary.label
                    : primary.label;

                  return (
                    <>
                      {/* Primary Action — from backend. At the lock stage it's
                        paired with a Cancel button (like the lock screen). */}
                      {primary.type && primary.enabled ? (
                        (() => {
                          const primaryBtn = (
                            <motion.button
                              whileTap={{ scale: 0.98 }}
                              disabled={loading}
                              onClick={() => ACTION_HANDLER[primary.type!]?.()}
                              className={`${
                                primary.type === "LOCK_ESCROW"
                                  ? "flex-[2]"
                                  : "w-full"
                              } ${
                                isActiveOrder ? "py-3 text-sm" : "py-3"
                              } rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                                loading ? PRIMARY_LOADING : PRIMARY_STYLE
                              }`}
                            >
                              {loading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : primary.type === "LOCK_ESCROW" ? (
                                <Lock className="w-3.5 h-3.5" />
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
                                    onCancelOrderWithoutEscrow(
                                      selectedOrder.id,
                                    );
                                    onClose();
                                  }}
                                  disabled={loading}
                                  className="flex-1 py-3 rounded-xl border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] text-[#f5f5f7] font-semibold text-sm disabled:opacity-50 transition-all"
                                >
                                  Cancel
                                </button>
                                {primaryBtn}
                              </div>
                            );
                          }
                          return primaryBtn;
                        })()
                      ) : primary.label &&
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
                      {secondary?.type &&
                        (() => {
                          const st =
                            (selectedOrder.dbOrder as any)?.status ||
                            (selectedOrder.dbOrder as any)?.minimal_status;
                          if (
                            secondary.type === "CANCEL" &&
                            (st === "accepted" || st === "escrowed")
                          )
                            return null;
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
                      {isActiveOrder &&
                        (() => {
                          const st =
                            (selectedOrder.dbOrder as any)?.status ||
                            (selectedOrder.dbOrder as any)?.minimal_status;
                          const showAppeal =
                            st === "payment_sent" ||
                            (st === "escrowed" && waitingTimedOut);
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
                                  // Open the merchant Support panel (help/ticketing),
                                  // which lives in settings under the `support` tab.
                                  // Use client-side nav (not window.location) so the
                                  // in-memory merchant auth store survives — a hard
                                  // reload bounces to /market/login before the async
                                  // /api/auth/me restore repopulates the store.
                                  // Carry the order id so "back" from support reopens
                                  // this exact order instead of the settings list.
                                  const returnOrderId = isFull ? selectedOrder?.id : null;
                                  onClose();
                                  router.push(
                                    returnOrderId
                                      ? `/market/settings?tab=support&returnOrder=${returnOrderId}`
                                      : "/market/settings?tab=support",
                                  );
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
    {/* Counterparty profile — layered above the popup (z-[140] > z-50). */}
    <ProfileSheet
      open={!!profileTarget}
      entityType={profileTarget?.entityType ?? null}
      id={profileTarget?.id ?? null}
      variant="merchant"
      onClose={() => setProfileTarget(null)}
    />
    </ProfileOpenContext.Provider>
  );
}
