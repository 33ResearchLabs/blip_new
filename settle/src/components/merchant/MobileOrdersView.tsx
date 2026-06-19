"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import {
  X,
  Shield,
  Activity,
  MessageCircle,
  User,
  Search,
  Volume2,
  VolumeX,
  Landmark,
  Zap,
  Banknote,
  CreditCard,
} from "lucide-react";
import { formatFiat } from "@/lib/format";
import { HoldSwipe } from "@/components/merchant/OrderCardParts";
import { useMerchantStore, type PendingFilter } from "@/stores/merchantStore";
import { useSounds } from "@/hooks/useSounds";
import { FilterDropdown } from "@/components/user/screens/ui/FilterDropdown";
import type { Order } from "@/types/merchant";
import { ProfileSheet } from "@/components/shared/profile/ProfileSheet";
import type { ProfileEntityType } from "@/components/shared/profile/types";
import { deriveCounterparty } from "@/components/shared/profile/counterparty";

const PENDING_FILTER_OPTIONS: ReadonlyArray<{
  key: PendingFilter;
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "mineable", label: "Mineable" },
  { key: "premium", label: "Premium" },
  { key: "large", label: "Large" },
  { key: "expiring", label: "Expiring" },
];

// Mirrors `getViewerSide` in PendingOrdersPanel.tsx so the mobile pending
// card uses the same YOU PAY / YOU RECEIVE labels as the desktop layout.
// See CLAUDE.md → Order System → Role system for the role table.
function getViewerSide(
  db: any,
  myId: string | null | undefined,
): "seller" | "buyer" {
  if (!db) return "seller";
  const userIsPlaceholder =
    typeof db.user?.username === "string" &&
    (db.user.username.startsWith("open_order_") ||
      db.user.username.startsWith("m2m_"));
  const isM2M = userIsPlaceholder || !!db.buyer_merchant_id;
  const orderType = String(db.type || "").toLowerCase();
  if (isM2M) {
    if (myId && db.merchant_id === myId) return "seller";
    if (myId && db.buyer_merchant_id === myId) return "buyer";
    if (db.merchant_id && !db.buyer_merchant_id) return "buyer";
    if (!db.merchant_id && db.buyer_merchant_id) return "seller";
    return orderType === "buy" ? "buyer" : "seller";
  }
  if (myId && db.merchant_id === myId) {
    return orderType === "buy" ? "seller" : "buyer";
  }
  return orderType === "buy" ? "seller" : "buyer";
}

// Live countdown — ticks every second from the server-supplied expiresIn.
// Resyncs if the server value shifts by more than 5s (poll correction).
function useCountdown(expiresIn: number): number {
  const [secs, setSecs] = useState(expiresIn);
  const serverRef = useRef(expiresIn);

  useEffect(() => {
    if (Math.abs(expiresIn - serverRef.current) > 5) {
      serverRef.current = expiresIn;
      setSecs(expiresIn);
    }
  }, [expiresIn]);

  useEffect(() => {
    if (secs <= 0) return;
    const id = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [secs > 0]);

  return secs;
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return "00:00";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatTimeTaken(
  createdAt?: string,
  updatedAt?: string,
): string | null {
  if (!createdAt || !updatedAt) return null;
  const diffMs = new Date(updatedAt).getTime() - new Date(createdAt).getTime();
  if (diffMs <= 0) return null;
  const totalSecs = Math.floor(diffMs / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m === 0) return `${s}s`;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/* ── Card with timer hook (no hooks inside .map()) ── */
function OrderCardTimer({
  order,
  merchantId,
  isCreatedByMe,
  onAcceptOrder,
  acceptingOrderId,
  onOpenChat,
  setMobileView,
  onCancelOrder,
  cancellingOrderId,
  onSelectOrder,
  onOpenProfile,
}: {
  order: Order;
  merchantId: string | null;
  isCreatedByMe: (o: Order) => boolean;
  onAcceptOrder: (o: Order) => void;
  acceptingOrderId?: string | null;
  onOpenChat: (o: Order) => void;
  setMobileView: (
    v: "orders" | "escrow" | "chat" | "history" | "marketplace",
  ) => void;
  onCancelOrder?: (o: Order) => void;
  cancellingOrderId?: string | null;
  onSelectOrder?: (o: Order) => void;
  onOpenProfile?: (entityType: ProfileEntityType, id: string) => void;
}) {
  const countdown = useCountdown(order.expiresIn);
  const [dismissed, setDismissed] = useState(false);

  const effStatus: string =
    (order as any).status || (order as any)?.dbOrder?.status || "pending";
  const isExpired = countdown <= 0;
  const isActivelyPending = effStatus === "pending" && countdown > 0;
  const isCompleted = effStatus === "completed";
  const isBad = ["disputed", "cancelled", "expired"].includes(effStatus);
  const isOngoing = !isCompleted && !isBad;
  // Chat only makes sense once the order is accepted — a pending/open broadcast
  // or an expired order has no counterparty to message yet, so hide the chat
  // button until there's someone on the other side.
  const canChat = effStatus !== "pending" && !isExpired;
  const isMine = isCreatedByMe(order);
  const expiringSoon = !isExpired && countdown <= 120;

  // Countdown as fraction of 15-min window for the progress bar
  const timeFrac = Math.min(1, countdown / 900);
  const low = timeFrac < 0.25;

  // User info
  const rawName =
    order.user ||
    (order.dbOrder as any)?.user?.username ||
    (order.dbOrder as any)?.user?.name ||
    "";
  const isPlaceholder =
    rawName.startsWith("open_order_") ||
    rawName.startsWith("m2m_") ||
    rawName === "Unknown";
  const displayName = isPlaceholder ? "Open Order" : rawName;
  const rawAvatarUrl = order.user_avatar ?? undefined;
  const avatarUrl =
    rawAvatarUrl && /^https?:\/\/|^\//.test(rawAvatarUrl)
      ? rawAvatarUrl
      : undefined;

  // Counterparty for the profile sheet (shared with PendingOrdersPanel + the
  // order-info popup): a U2M order's counterparty is the user who placed it; an
  // M2M order's is the OTHER merchant slot — resolved role-aware so an order
  // viewed from the buyer slot opens the seller, not the viewer themselves.
  const cp = deriveCounterparty(order.dbOrder, merchantId);
  const cpEntityType: ProfileEntityType = cp?.entityType ?? "user";
  const cpEntityId: string | null = cp?.id ?? null;
  const handleOpenProfile = (e: { stopPropagation: () => void }) => {
    if (!cpEntityId || !onOpenProfile) return;
    e.stopPropagation();
    onOpenProfile(cpEntityType, cpEntityId);
  };
  // For the merchant's OWN broadcast there is no counterparty yet, so any
  // "counterparty" identity/stats (verified shield, rating, trades, completion)
  // are placeholder/self data — suppress them so own cards don't imply a trader
  // on the other side. The order's own attributes (name, payment method,
  // countdown, "yours" badge) still render.
  const isVerified = isMine
    ? false
    : ((order.dbOrder as any)?.user?.is_verified ?? false);
  const initials = displayName
    .split(" ")
    .map((w: string) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  // Stats — null on own orders (no counterparty yet; see isVerified note above).
  const rating = isMine
    ? null
    : ((order.dbOrder as any)?.user?.rating ??
      (order.dbOrder as any)?.merchant?.rating ??
      null);
  const totalTrades = isMine
    ? null
    : ((order.dbOrder as any)?.user?.total_trades ??
      (order.dbOrder as any)?.merchant?.total_trades ??
      null);
  const completionRate = isMine
    ? null
    : ((order.dbOrder as any)?.user?.completion_rate ?? null);

  // Payment method
  const pmType =
    order.lockedPaymentMethod?.type || order.dbOrder?.payment_method;
  const pmName =
    order.lockedPaymentMethod?.label ||
    (order.lockedPaymentMethod?.details?.name as string | undefined);
  const pmLabel =
    pmName ||
    (pmType === "upi"
      ? "UPI"
      : pmType === "bank"
      ? "Bank Transfer"
      : pmType === "cash"
      ? "Cash"
      : pmType
      ? pmType.toUpperCase()
      : null);
  const PmIcon =
    pmType === "upi"
      ? Zap
      : pmType === "bank"
      ? Landmark
      : pmType === "cash"
      ? Banknote
      : CreditCard;

  // Amounts
  const fiatCur = order.toCurrency || "AED";
  const viewerSide = getViewerSide(order.dbOrder, merchantId);
  const fiatLabel = viewerSide === "seller" ? "YOU RECEIVE" : "YOU PAY OUT";
  // Mirror label for the USDT (right) side of the payout hero.
  const usdtLabel = viewerSide === "seller" ? "YOU GIVE" : "YOU GET";

  // Hero fiat: integer only — strip all decimals (e.g. "₹2,561" not "₹2,561.25")
  const heroFiat = formatFiat(Math.round(order.total), fiatCur).replace(
    /\.00$/,
    "",
  );
  // Earnings chip fiat amount (e.g. "+₹12.5")
  // Only compute earnings from the REAL fee % and rate; never fabricate them.
  const earningFiat =
    order.protocolFeePercent != null && (order.rate || 0) > 0
      ? ((order.amount * order.protocolFeePercent) / 100) * order.rate
      : 0;
  const heroEarning =
    earningFiat > 0
      ? formatFiat(earningFiat, fiatCur).replace(/\.?0+$/, "")
      : null;
  // Rate display: 1 decimal (e.g. "102.5"), spread next to it (e.g. "+0.50")
  const heroRate = (order.rate || 0).toFixed(1);
  const heroSpread =
    order.rate && order.protocolFeePercent
      ? `+${((order.rate * order.protocolFeePercent) / 100).toFixed(2)}`
      : null;

  // Progress bar for non-pending live orders
  const progressStages: Record<string, number> = {
    pending: 20,
    accepted: 40,
    escrowed: 60,
    payment_sent: 80,
    completed: 100,
    disputed: 100,
    cancelled: 100,
    expired: 100,
  };
  const progressPct = progressStages[effStatus] ?? 20;
  const barColor = isCompleted ? "#f5f5f7" : isBad ? "#f87171" : "#fb923c";
  const barGlow = isCompleted
    ? "none"
    : isBad
    ? "none"
    : "0 0 8px rgba(251,146,60,0.7)";

  // Time taken for terminal orders
  const timeTaken =
    isCompleted || isBad
      ? formatTimeTaken(
          (order.dbOrder as any)?.created_at,
          (order.dbOrder as any)?.updated_at,
        )
      : null;

  if (dismissed) {
    return (
      <div
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 22,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.3)",
            fontWeight: 600,
          }}
        >
          Order skipped
        </span>
        <button
          onClick={() => setDismissed(false)}
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.7)",
            fontWeight: 700,
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.055)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 18,
        overflow: "hidden",
        backdropFilter: "blur(20px) saturate(150%)",
        marginBottom: 9,
        opacity: isExpired ? 0.62 : 1,
      }}
    >
      <div style={{ padding: 11 }}>
        {/* ── EXPIRED HEADER ── */}
        {isExpired && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 11,
            }}
          >
            <span
              style={{
                padding: "3px 9px",
                borderRadius: 999,
                background: "rgba(255,90,95,0.12)",
                border: "1px solid rgba(255,90,95,0.3)",
                color: "#ff7a7e",
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: "0.04em",
              }}
            >
              EXPIRED
            </span>
            <span
              style={{
                color: "#5a5a60",
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: "nowrap",
              }}
            >
              0:00 · not accepted
            </span>
          </div>
        )}

        {/* ── TRUST BLOCK / HEADER ── Only the avatar and the name/text column
            open the counterparty profile — NOT the whole row. The order detail
            popup lives on the payout body below. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          {/* 36px gradient avatar with initials — tap opens counterparty profile */}
          <span
            onClick={handleOpenProfile}
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              flexShrink: 0,
              cursor: cpEntityId ? "pointer" : undefined,
              background: avatarUrl
                ? "transparent"
                : "linear-gradient(150deg,#ff8a3d,#ff5d73)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 13,
              overflow: "hidden",
            }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                style={{ width: 36, height: 36, objectFit: "cover" }}
                alt=""
              />
            ) : (
              initials
            )}
          </span>

          {/* Text column — tap name/info to open counterparty profile */}
          <div
            onClick={handleOpenProfile}
            style={{ flex: 1, minWidth: 0, cursor: cpEntityId ? "pointer" : undefined }}
          >
            {/* Row 1: name + verified shield */}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <b
                style={{
                  fontSize: 12.5,
                  color: "#f5f5f7",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {displayName}
              </b>
              {isVerified && (
                <span
                  style={{
                    color: "rgba(255,255,255,0.7)",
                    display: "flex",
                    flexShrink: 0,
                  }}
                >
                  <Shield style={{ width: 11, height: 11 }} />
                </span>
              )}
            </div>
            {/* Row 2: star rating + payment method */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 2,
                color: "#86868b",
                fontSize: 11.5,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              {rating && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    color: "#ffb020",
                  }}
                >
                  ★<b style={{ color: "#fff" }}>{Number(rating).toFixed(1)}</b>
                </span>
              )}
              {rating && pmLabel && <span style={{ opacity: 0.5 }}>·</span>}
              {pmLabel && (
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <PmIcon style={{ width: 13, height: 13 }} /> {pmLabel}
                </span>
              )}
            </div>
            {/* Row 3: completion + release time */}
            {completionRate != null && (
              <div
                style={{
                  marginTop: 2,
                  color: "#5a5a60",
                  fontSize: 10.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {completionRate}% completion · ~2m release
              </div>
            )}
          </div>

          {/* Right: chat + user icon buttons 32×32. Chat only shows once the
              order is accepted (there's a counterparty to message). */}
          <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
            {canChat && (
              <button
                onClick={(e) => {
                  // Stop the tap bubbling to the header row (which now opens
                  // the counterparty profile) — chat is its own action.
                  e.stopPropagation();
                  onOpenChat(order);
                  setMobileView("chat");
                }}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.055)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#aeaeb2",
                  cursor: "pointer",
                }}
              >
                <MessageCircle style={{ width: 15, height: 15 }} />
              </button>
            )}
            {/* Explicit "view profile" affordance — same target as tapping the
                header row. handleOpenProfile stops propagation itself. */}
            <button
              onClick={handleOpenProfile}
              aria-label="View profile"
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                background: "rgba(255,255,255,0.055)",
                border: "1px solid rgba(255,255,255,0.09)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#aeaeb2",
                cursor: cpEntityId && onOpenProfile ? "pointer" : "default",
              }}
            >
              <User style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>

        {/* ── FULL-BLEED DIVIDER ── */}
        <div
          style={{
            height: 1,
            background: "rgba(255,255,255,0.08)",
            margin: "9px -11px",
          }}
        />

        {/* ── PAYOUT HERO ── (tap the order body to open the order detail
            popup; the header above opens the counterparty profile). */}
        <div
          onClick={onSelectOrder ? () => onSelectOrder(order) : undefined}
          role={onSelectOrder ? "button" : undefined}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginTop: 11,
            marginBottom: 14,
            cursor: onSelectOrder ? "pointer" : undefined,
          }}
        >
          {/* Left: fiat label + big number + earnings chip */}
          <div>
            <div
              style={{
                color: "#86868b",
                fontWeight: 700,
                fontSize: 9.5,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                marginBottom: 2,
              }}
            >
              {fiatLabel}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 7 }}>
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  lineHeight: 0.95,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.02em",
                  color: "#f5f5f7",
                }}
              >
                {heroFiat}
              </span>
              {!isMine && isActivelyPending && heroEarning && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginBottom: 2,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.09)",
                    color: "rgba(255,255,255,0.7)",
                    fontSize: 10.5,
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={10}
                    height={10}
                    fill="currentColor"
                  >
                    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
                  </svg>
                  +{heroEarning}
                </span>
              )}
            </div>
          </div>
          {/* Right: USDT label + amount + rate */}
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div
              style={{
                color: "#86868b",
                fontWeight: 700,
                fontSize: 9.5,
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                marginBottom: 2,
              }}
            >
              {usdtLabel}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                lineHeight: 0.95,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.02em",
                color: "#f5f5f7",
              }}
            >
              {Math.round(order.amount)}{" "}
              <span style={{ fontSize: 11, fontWeight: 700, color: "#86868b" }}>USDT</span>
            </div>
            <div
              style={{
                color: "#86868b",
                fontSize: 11,
                fontWeight: 600,
                marginTop: 1,
                whiteSpace: "nowrap",
              }}
            >
              @ {heroRate}
              {heroSpread && (
                <span style={{ color: "rgba(255,255,255,0.5)" }}>
                  {" "}
                  · +{heroSpread.replace("+", "")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── ACTION ROW ── */}
        {isExpired ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 12,
              height: 44,
              borderRadius: 22,
              border: "1px dashed rgba(255,255,255,0.16)",
              color: "#86868b",
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={14}
              height={14}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5V12l3 2" />
            </svg>
            Expired · moved to History
          </div>
        ) : isActivelyPending ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 12,
            }}
          >
            {!isMine ? (
              <HoldSwipe
                onAccept={() => onAcceptOrder(order)}
                loading={acceptingOrderId === order.id}
                height={48}
              />
            ) : (
              onCancelOrder && (
                <HoldSwipe
                  onAccept={() => onCancelOrder(order)}
                  loading={cancellingOrderId === order.id}
                  height={48}
                  variant="cancel"
                />
              )
            )}
          </div>
        ) : null}

        {/* ── COUNTDOWN FOOTER (pending orders only) ── */}
        {isActivelyPending && !isExpired && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 10,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 9,
                background:
                  low || expiringSoon ? "#ff5a5f" : "rgba(255,255,255,0.7)",
                flexShrink: 0,
              }}
            />
            <span style={{ fontWeight: 700, fontSize: 11, color: "#86868b" }}>
              <b
                style={{
                  fontVariantNumeric: "tabular-nums",
                  color: low || expiringSoon ? "#ff5a5f" : "#fff",
                }}
              >
                {formatCountdown(countdown)}
              </b>{" "}
              left to accept
            </span>
          </div>
        )}

        {/* Terminal order time taken (when not in stats line) */}
        {!isActivelyPending && timeTaken && totalTrades == null && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: "rgba(255,255,255,0.2)",
              fontFamily: "monospace",
            }}
          >
            {timeTaken}
          </div>
        )}
      </div>

      {/* ── BOTTOM PROGRESS BAR — flush to card edge ── */}
      {isActivelyPending && !isExpired && (
        <div
          style={{
            height: 3,
            margin: "8px -11px -11px",
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${timeFrac * 100}%`,
              background: low || expiringSoon ? "#ff5a5f" : "#f5f5f7",
              boxShadow:
                low || expiringSoon
                  ? "0 0 8px rgba(255,90,95,0.5)"
                  : "0 0 8px rgba(255,255,255,0.45)",
              transition: "width 1s linear",
            }}
          />
        </div>
      )}
      {isOngoing && !isActivelyPending && (
        <div style={{ height: 3, background: "rgba(255,255,255,0.06)" }}>
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              backgroundColor: barColor,
              boxShadow: barGlow,
              borderRadius: 999,
              transition: "width 0.6s ease-out",
            }}
          />
        </div>
      )}
    </div>
  );
}

export interface MobileOrdersViewProps {
  pendingOrders: Order[];
  // Kept on the prop interface for backward compat with existing call sites
  // (MerchantMobileContent still passes it). No longer consumed inside —
  // the "All" tab now reads the full orders array from the merchant store
  // directly, mirroring PendingOrdersPanel's "All" branch.
  ongoingOrders?: Order[];
  onAcceptOrder: (order: Order) => void;
  acceptingOrderId?: string | null;
  onOpenChat: (order: Order) => void;
  setMobileView: (
    view: "orders" | "escrow" | "chat" | "history" | "marketplace",
  ) => void;
  // Cancel a still-pending order the merchant created themselves.
  // Routed at the page level to either the escrow-cancel modal or the
  // no-escrow cancel call depending on whether escrow has been locked.
  onCancelOrder?: (order: Order) => void;
  cancellingOrderId?: string | null;
  // Open the order detail popup (OrderQuickView). Tapping a card's header
  // opens it — mirrors the desktop New Orders panel behaviour.
  onSelectOrder?: (order: Order) => void;
}

export function MobileOrdersView({
  pendingOrders,
  onAcceptOrder,
  acceptingOrderId,
  onOpenChat,
  setMobileView,
  onCancelOrder,
  cancellingOrderId,
  onSelectOrder,
}: MobileOrdersViewProps) {
  // Periodic clock tick (30s) so the expired-order filter re-evaluates while the
  // page stays open — orders that lapse client-side don't mutate the store, so
  // without this the allOrders memo (keyed on the orders array) would never
  // re-run and a just-lapsed card would survive the filter until the next fetch.
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Counterparty profile sheet — opened by tapping a card's avatar/name.
  const [profileTarget, setProfileTarget] = useState<{
    entityType: ProfileEntityType;
    id: string;
  } | null>(null);
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  // Shared filter / search / sound state — same Zustand keys the desktop panel uses,
  // so toggling here also reflects on the desktop layout.
  const searchQuery = useMerchantStore((s) => s.searchQuery);
  const setSearchQuery = useMerchantStore((s) => s.setSearchQuery);
  const pendingFilter = useMerchantStore((s) => s.pendingFilter);
  const setPendingFilter = useMerchantStore((s) => s.setPendingFilter);
  const soundEnabled = useMerchantStore((s) => s.soundEnabled);
  const setSoundEnabled = useMerchantStore((s) => s.setSoundEnabled);
  // Play a confirmation chime when sound is switched on. The tap is also the
  // user gesture that unlocks the Web Audio context on mobile — without it the
  // AudioContext stays suspended and later new_order alerts never play.
  const { playSound } = useSounds();
  // For YOU PAY / YOU RECEIVE perspective in the gradient amounts panel.
  const merchantId = useMerchantStore((s) => s.merchantId);
  // Pull the FULL orders array from the same store the desktop pending
  // bar reads from (PendingOrdersPanel.tsx's "All" branch — line ~1235:
  // `const marketOrders = [...orders];`). The parent passes `pendingOrders`
  // already-filtered to pending+escrow-unaccepted; that's correct for the
  // Pending/My-Orders tabs but too narrow for "All", which should also
  // surface accepted / payment_sent / completed / cancelled rows the way
  // desktop does.
  const allMerchantOrders = useMerchantStore((s) => s.orders) as Order[];

  // Exact copy of the desktop pending bar's `isMyOwnOrder` check
  // (PendingOrdersPanel.tsx:479-483) so mobile rows label themselves the
  // same way as desktop:
  //   • If it's an M2M order (buyer_merchant_id set + placeholder user) →
  //     I'm the placer ONLY if buyer_merchant_id matches me. The seller
  //     side (merchant_id) gets the ACCEPT button instead.
  //   • Otherwise (incl. unaccepted broadcasts where buyer_merchant_id is
  //     null) → I'm the placer if the API-returned isMyOrder flag is set,
  //     OR the user is a placeholder and merchant_id matches me.
  // Both checks use `order.orderMerchantId` / `order.buyerMerchantId` —
  // the mapped fields from `mapDbOrderToUI` — instead of dipping into
  // `order.dbOrder` so we don't depend on whether the raw DB row is
  // attached on every code path.
  const isCreatedByMe = (order: Order): boolean => {
    if (!merchantId) return false;
    const username: string =
      (order as any)?.dbOrder?.user?.username || order.user || "";
    const isPlaceholderUser =
      username.startsWith("open_order_") || username.startsWith("m2m_");
    const isM2MOrder = !!order.buyerMerchantId && isPlaceholderUser;
    return isM2MOrder
      ? order.buyerMerchantId === merchantId
      : !!order.isMyOrder ||
          (isPlaceholderUser && order.orderMerchantId === merchantId);
  };

  // Sub-tab state — mirrors the desktop PendingOrdersPanel
  //   • All        — every pending order (mine + others)
  //   • Pending    — orders waiting for me to accept (excludes mine) [default]
  //   • My Orders  — orders I placed (broadcasts waiting for a counterparty)
  // Client-side filter off the same pendingOrders array; uses the order.isMyOrder
  // flag populated at mapping time.
  type ViewTab = "all" | "pending" | "mine";
  // All / Pending / Mine — mirrors the desktop PendingOrdersPanel, which
  // defaults to "Pending" (the actionable incoming-orders list).
  const [view, setView] = useState<ViewTab>("pending");
  // 3 tabs: all=0, pending=1, mine=2
  const tabIndex = view === "all" ? 0 : view === "pending" ? 1 : 2;

  // "All" view = full orders feed from the store, every status (pending /
  //   accepted / escrowed / payment_sent), but NOT terminal ones.
  // "Pending" view stays scoped to pending-only (excluding mine — that's the
  //   actionable market list).
  // "Mine" view stays scoped to pending-only mine (same as before; the
  //   Active Order tab still owns the in-progress mine list).
  const allOrders = useMemo(() => {
    const seen = new Set<string>();
    const merged: Order[] = [];
    for (const o of allMerchantOrders) {
      if (o?.id && seen.has(o.id)) continue;
      // ── "All" = LIVE / active orders only ────────────────────────────────
      // Show pending (acceptable), accepted/escrowed/payment_sent (mapped to
      // ui "escrow"), and disputed. Hide TERMINAL orders — completed,
      // cancelled, and expired — they belong in History, not the New feed.
      // Detection is defensive across status fields because the realtime patch
      // only updates minimalStatus (leaving status/dbOrder stale), and the UI
      // mapper remaps minimal "expired" → ui "cancelled".
      const uiStatus = String((o as any)?.status || "").toLowerCase();
      const rawStatus = String((o as any)?.dbOrder?.status || "").toLowerCase();
      const minStatus = String(
        (o as any)?.minimalStatus || (o as any)?.dbOrder?.minimal_status || "",
      ).toLowerCase();
      const TERMINAL = ["completed", "cancelled", "expired"];
      const isTerminal =
        TERMINAL.includes(uiStatus) ||
        TERMINAL.includes(rawStatus) ||
        TERMINAL.includes(minStatus);

      // A pending/open order whose matching window has lapsed is effectively
      // expired (the card paints it EXPIRED purely from the countdown), even
      // if its status hasn't flipped yet — treat it as terminal too. Gate on
      // "never accepted" so a live in-flight order whose accept-window
      // timestamp passed (escrow/payment_sent) is NOT removed.
      const expiresAt = (o as any)?.dbOrder?.expires_at;
      const lapsed =
        (expiresAt ? new Date(expiresAt).getTime() <= nowTick : false) ||
        (typeof (o as any)?.expiresIn === "number" &&
          (o as any).expiresIn <= 0);
      const ACCEPTED = [
        "accepted",
        "escrow",
        "escrowed",
        "payment_sent",
        "completed",
        "disputed",
      ];
      const everAccepted =
        !!(o as any)?.dbOrder?.accepted_at ||
        ACCEPTED.includes(uiStatus) ||
        ACCEPTED.includes(rawStatus) ||
        ACCEPTED.includes(minStatus);

      if (isTerminal || (lapsed && !everAccepted)) {
        continue;
      }
      if (o?.id) seen.add(o.id);
      merged.push(o);
    }
    return merged;
    // nowTick re-runs the lapsed check on a timer (see nowTick declaration).
  }, [allMerchantOrders, nowTick]);

  const myCount = useMemo(
    () => pendingOrders.filter((o) => o.isMyOrder).length,
    [pendingOrders],
  );
  const pendingTabCount = pendingOrders.length - myCount;
  const allCount = allOrders.length;

  // Apply the same filter predicates the desktop pending panel uses.
  // The view-tab filter runs FIRST so the existing pendingFilter (mineable /
  // premium / large / expiring) and the search box operate on the already-
  // scoped subset.
  const filteredPendingOrders = useMemo(() => {
    let list = view === "all" ? allOrders : pendingOrders;

    if (view === "mine") list = list.filter((o) => o.isMyOrder);
    else if (view === "pending") list = list.filter((o) => !o.isMyOrder);
    // view === "all" → no filter, but list already includes ongoing orders

    if (pendingFilter !== "all") {
      list = list.filter((order) => {
        if (pendingFilter === "mineable") return !!order.escrowTxHash;
        if (pendingFilter === "large") return order.amount >= 2000;
        if (pendingFilter === "expiring") return order.expiresIn < 300;
        // "premium" needs corridor reference prices to be precise; on mobile we
        // approximate as "rate visibly above zero" since we don't have the
        // ref-price store wired here. Falls through to true to avoid hiding rows.
        return true;
      });
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((order) => {
        const matchesUser = order.user?.toLowerCase().includes(q);
        const matchesAmount = order.amount.toString().includes(q);
        const matchesTotal = Math.round(order.total).toString().includes(q);
        const matchesId = order.id?.toLowerCase().includes(q);
        const matchesOrderNum = order.dbOrder?.order_number
          ?.toLowerCase()
          .includes(q);
        return (
          matchesUser ||
          matchesAmount ||
          matchesTotal ||
          matchesId ||
          matchesOrderNum
        );
      });
    }

    return list;
  }, [pendingOrders, allOrders, view, pendingFilter, searchQuery]);

  const tabs = [
    { id: "all" as ViewTab, label: "All", count: allCount },
    { id: "pending" as ViewTab, label: "Pending", count: pendingTabCount },
    { id: "mine" as ViewTab, label: "Mine", count: myCount },
  ];

  const [searchOpen, setSearchOpen] = useState(false);

  // Close search bar when query is cleared
  const handleSearchClose = () => {
    setSearchQuery("");
    setSearchOpen(false);
  };

  // Full-width orders panel — 480px centered cap removed so cards fill the
  // width on tablet/wide viewports. Phones (≤480px) are unaffected.
  // Old cap: <div style={{ maxWidth: 480, margin: "0 auto" }}>
  return (
    <div>
      {/* ── TOP ROW: tabs + icons all in one line ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: searchOpen ? 8 : 14,
        }}
      >
        {/* Sliding tab strip — shrinks to make room for icons */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flex: 1,
            minWidth: 0,
            background: "rgba(255,255,255,0.055)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 12,
            padding: 3,
            height: 34,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 3,
              bottom: 3,
              borderRadius: 11,
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.14)",
              transition: "left 0.22s cubic-bezier(0.22,1,0.36,1), width 0.22s",
              left: `calc(${tabIndex} * (100% - 6px) / ${tabs.length} + 2px)`,
              width: `calc((100% - 6px) / ${tabs.length})`,
              pointerEvents: "none",
            }}
          />
          {tabs.map((tab) => {
            const isActive = view === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                style={{
                  flex: 1,
                  position: "relative",
                  zIndex: 1,
                  padding: "0 4px",
                  fontSize: 13,
                  fontWeight: 700,
                  color: isActive ? "#f5f5f7" : "#86868b",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  borderRadius: 9,
                  transition: "color 0.2s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                }}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: isActive
                        ? "rgba(245,245,247,0.55)"
                        : "rgba(134,134,139,0.7)",
                    }}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Icon buttons: search · filter · sound */}
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              setSearchOpen((s) => !s);
              if (searchOpen) handleSearchClose();
            }}
            aria-label="Search orders"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                searchOpen || searchQuery
                  ? "rgba(255,255,255,0.10)"
                  : "rgba(255,255,255,0.055)",
              border: `1px solid ${
                searchOpen || searchQuery
                  ? "rgba(255,255,255,0.18)"
                  : "rgba(255,255,255,0.09)"
              }`,
              color: searchOpen || searchQuery ? "#f5f5f7" : "#5a5a60",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <Search style={{ width: 15, height: 15 }} />
          </button>

          <FilterDropdown<PendingFilter>
            value={pendingFilter}
            onChange={setPendingFilter}
            ariaLabel="Filter pending orders"
            align="right"
            options={PENDING_FILTER_OPTIONS}
            triggerClassName="!rounded-[10px] !h-[34px] !px-2.5 !text-[12px]"
          />

          <button
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              if (next) playSound("notification");
            }}
            aria-label={soundEnabled ? "Mute sounds" : "Unmute sounds"}
            aria-pressed={soundEnabled}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.055)",
              border: "1px solid rgba(255,255,255,0.09)",
              color: soundEnabled ? "rgba(255,255,255,0.7)" : "#5a5a60",
              cursor: "pointer",
            }}
          >
            {soundEnabled ? (
              <Volume2 style={{ width: 15, height: 15 }} />
            ) : (
              <VolumeX style={{ width: 15, height: 15 }} />
            )}
          </button>
        </div>
      </div>

      {/* ── SEARCH INPUT — expands below when open ── */}
      {searchOpen && (
        <div style={{ position: "relative", marginBottom: 12 }}>
          <Search
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              width: 13,
              height: 13,
              color: "#5a5a60",
              pointerEvents: "none",
            }}
          />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by user, amount, currency…"
            maxLength={100}
            style={{
              width: "100%",
              height: 34,
              paddingLeft: 32,
              paddingRight: searchQuery ? 30 : 12,
              borderRadius: 12,
              background: "rgba(255,255,255,0.055)",
              border: "1px solid rgba(255,255,255,0.09)",
              color: "#f5f5f7",
              fontSize: 13,
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                padding: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#5a5a60",
              }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      )}

      {/* ── ORDER LIST or EMPTY STATE ── */}
      {filteredPendingOrders.length > 0 ? (
        <div>
          {filteredPendingOrders.map((order) => (
            <OrderCardTimer
              key={order.id}
              order={order}
              merchantId={merchantId}
              isCreatedByMe={isCreatedByMe}
              onAcceptOrder={onAcceptOrder}
              acceptingOrderId={acceptingOrderId}
              onOpenChat={onOpenChat}
              setMobileView={setMobileView}
              onCancelOrder={onCancelOrder}
              cancellingOrderId={cancellingOrderId}
              onSelectOrder={onSelectOrder}
              onOpenProfile={(entityType, id) =>
                setProfileTarget({ entityType, id })
              }
            />
          ))}
        </div>
      ) : (
        (() => {
          // Empty-state copy + actions depend on WHY the list is empty:
          //   1. Genuine inbox-zero → "Waiting for orders..."
          //   2. Active filter / search hiding everything → contextual message
          //      + "Clear filters" button
          //   3. Sub-tab subset is just empty (no filters applied) → tab-
          //      specific message, NO "Clear filters" (nothing to clear)
          const hasActiveFilters =
            pendingFilter !== "all" || searchQuery.trim().length > 0;
          let message: string;
          if (pendingOrders.length === 0) {
            message = "Waiting for orders...";
          } else if (hasActiveFilters) {
            message = "No orders match your filter";
          } else if (view === "mine") {
            message = "You haven't placed any orders yet";
          } else if (view === "pending") {
            message = "No incoming orders waiting on you";
          } else {
            message = "Waiting for orders...";
          }
          return (
            <div style={{ textAlign: "center", paddingTop: 120 }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 22,
                  background: "rgba(255,255,255,0.055)",
                  border: "1px solid rgba(255,255,255,0.09)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                  color: "#86868b",
                }}
              >
                <Activity className="w-7 h-7" />
              </div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#f5f5f7" }}>
                {message}
              </div>
              <div
                style={{
                  color: "#86868b",
                  fontSize: 13,
                  fontWeight: 500,
                  marginTop: 5,
                }}
              >
                New opportunities will appear here live.
              </div>
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setPendingFilter("all");
                  }}
                  style={{
                    marginTop: 12,
                    padding: "7px 18px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "none",
                    color: "#86868b",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
          );
        })()
      )}

      {/* Counterparty profile — opened by tapping a card's avatar/name. */}
      <ProfileSheet
        open={!!profileTarget}
        entityType={profileTarget?.entityType ?? null}
        id={profileTarget?.id ?? null}
        variant="merchant"
        onClose={() => setProfileTarget(null)}
      />
    </div>
  );
}
