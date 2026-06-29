"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Check,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { SupportBubbleInline } from "@/components/support/SupportBubbleInline";
import type { OrderConversation } from "@/hooks/useMerchantConversations";

interface DisputeConversation {
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: "buy" | "sell";
  crypto_amount: number;
  fiat_amount: number;
  fiat_currency: string;
  user: {
    id: string;
    username: string;
    rating: number;
    total_trades: number;
  };
  message_count: number;
  unread_count: number;
  last_message: {
    id: string;
    content: string;
    sender_type: string;
    message_type: string;
    created_at: string;
    is_read: boolean;
  } | null;
  last_activity: string;
}

interface MerchantChatTabsProps {
  merchantId: string;
  orderConversations: OrderConversation[];
  totalUnread: number;
  isLoading: boolean;
  onOpenOrderChat: (
    orderId: string,
    userName: string,
    orderNumber: string,
    orderType?: "buy" | "sell",
    userAvatarUrl?: string | null,
  ) => void;
  onOpenDisputeChat?: (orderId: string, userName: string) => void;
  onClearUnread?: (orderId: string) => void;
  onClearAllUnread?: () => void;
  onClose?: () => void;
  /** Mobile uses this to drop the "MESSAGES" header row — the section is
   *  the only thing on screen there, so the title is redundant. Desktop
   *  keeps the header since the right rail stacks NOTIFICATIONS / MESSAGES. */
  hideHeading?: boolean;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function getInitials(username: string): string {
  const words = username.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

export function MerchantChatTabs({
  merchantId,
  orderConversations,
  totalUnread,
  isLoading,
  onOpenOrderChat,
  onClearUnread,
  onClearAllUnread,
  onClose,
  hideHeading = false,
}: MerchantChatTabsProps) {
  type ChatTab = "active" | "support";
  const [activeTab, setActiveTab] = useState<ChatTab>("active");
  const [disputeConversations, setDisputeConversations] = useState<
    DisputeConversation[]
  >([]);
  const [disputeUnread, setDisputeUnread] = useState(0);
  const [isLoadingDisputes, setIsLoadingDisputes] = useState(false);

  const fetchDisputes = useCallback(async () => {
    if (!merchantId) return;
    setIsLoadingDisputes(true);
    try {
      const res = await fetchWithAuth(
        `/api/merchant/messages?merchant_id=${merchantId}&tab=dispute&limit=50`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      if (data.success) {
        setDisputeConversations(data.data.conversations || []);
        setDisputeUnread(data.data.tabCounts?.disputeUnread || 0);
      }
    } catch {
      /* best-effort */
    } finally {
      setIsLoadingDisputes(false);
    }
  }, [merchantId]);

  useEffect(() => {
    fetchDisputes();
    const interval = setInterval(fetchDisputes, 15000);
    return () => clearInterval(interval);
  }, [fetchDisputes]);

  const ACTIVE_STATUSES = new Set([
    "accepted",
    "escrowed",
    "payment_sent",
    "payment_pending",
    "payment_confirmed",
    "releasing",
  ]);
  const inboxUnread = orderConversations.reduce(
    (sum, c) => sum + (c.unread_count || 0),
    0,
  );

  const visibleConversations = orderConversations;

  // suppress unused warning — dispute data used in future dispute tab
  void isLoadingDisputes;
  void disputeConversations;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--background)", color: "var(--foreground)" }}>
      {/* Header */}
      {!hideHeading && (
        <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 800, fontSize: 13, color: "var(--foreground)", letterSpacing: "-0.01em" }}>Messages</span>
              {totalUnread + disputeUnread > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#08080a", background: "#b8e9d4", padding: "1px 7px", borderRadius: 999 }}>
                  {totalUnread + disputeUnread}
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {totalUnread > 0 && (
                <button
                  onClick={() => {
                    if (onClearAllUnread) {
                      onClearAllUnread();
                    } else {
                      orderConversations
                        .filter((c) => c.unread_count > 0)
                        .forEach((c) => onClearUnread?.(c.order_id));
                    }
                  }}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 8, background: "rgba(184,233,212,0.10)", border: "1px solid rgba(184,233,212,0.18)", color: "#b8e9d4", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                  title="Mark all conversations as read"
                  aria-label="Mark all conversations as read"
                >
                  <Check style={{ width: 12, height: 12 }} strokeWidth={2.5} />
                  <span>Read all</span>
                </button>
              )}
              {onClose && (
                <button
                  onClick={onClose}
                  style={{ width: 28, height: 28, borderRadius: 8, background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)", cursor: "pointer" }}
                >
                  <X style={{ width: 14, height: 14 }} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab strip */}
      <div style={{ padding: hideHeading ? "2px 16px 8px" : "0 0 8px" }}>
        <div style={{ position: "relative", display: "flex", background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 3, width: "100%" }}>
          {/* sliding thumb */}
          <div style={{
            position: "absolute", top: 3, bottom: 3, borderRadius: 11,
            background: "var(--border-strong)", border: "1px solid var(--border-strong)",
            transition: "left 0.22s cubic-bezier(0.22,1,0.36,1), width 0.22s",
            left: activeTab === "active" ? 3 : "calc(50% + 1.5px)",
            width: "calc(50% - 4.5px)",
          }} />
          <button
            onClick={() => setActiveTab("active")}
            style={{ flex: 1, position: "relative", zIndex: 1, padding: "5px 0", fontSize: 11, fontWeight: activeTab === "active" ? 600 : 500, color: activeTab === "active" ? "var(--foreground)" : "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer", borderRadius: 11, transition: "color 0.2s, font-weight 0.2s" }}
          >
            Inbox{inboxUnread > 0 ? ` · ${inboxUnread}` : ""}
          </button>
          <button
            onClick={() => setActiveTab("support")}
            style={{ flex: 1, position: "relative", zIndex: 1, padding: "5px 0", fontSize: 11, fontWeight: activeTab === "support" ? 600 : 500, color: activeTab === "support" ? "var(--foreground)" : "var(--color-text-secondary)", background: "none", border: "none", cursor: "pointer", borderRadius: 11, transition: "color 0.2s, font-weight 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Support
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {activeTab === "support" ? (
          <SupportBubbleInline actorType="merchant" actorId={merchantId} />
        ) : isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <div style={{ width: 18, height: 18, border: "2px solid rgba(184,233,212,0.3)", borderTopColor: "#b8e9d4", borderRadius: 999, animation: "spin 0.8s linear infinite" }} />
          </div>
        ) : visibleConversations.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 80 }}>
            <div style={{ width: 60, height: 60, borderRadius: 20, background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "var(--color-text-secondary)" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--foreground)" }}>
              No chats yet
            </div>
            <div style={{ color: "var(--color-text-secondary)", fontSize: 13, fontWeight: 500, marginTop: 5, lineHeight: 1.4 }}>
              Chats open automatically when you<br />accept or place an order.
            </div>
          </div>
        ) : (
          <div>
            {visibleConversations.map((conv, idx) => {
              const hasUnread = conv.unread_count > 0;
              const fiatSymbol =
                conv.fiat_currency === "INR"
                  ? "₹"
                  : conv.fiat_currency === "AED"
                    ? "د.إ"
                    : conv.fiat_currency;
              const timestamp = conv.last_message?.created_at || conv.last_activity;
              // Counterparty display name: prefer the server-resolved name; if it
              // (or the raw username) is still an open_order_/m2m_ placeholder,
              // fall back to the order number so the list never shows the ugly id.
              const isPlaceholderName = (n?: string | null) =>
                !n || /^(open_order_|m2m_)/i.test(n);
              // Defensive: a malformed row (missing `user`) must not crash the
              // whole inbox map. Coalesce to definite types so downstream usage
              // (displayName, avatar) stays crash-safe without widening types.
              const cpUsername = conv.user?.username ?? '';
              const cpAvatar = conv.user?.avatar_url ?? null;
              const displayName = !isPlaceholderName(conv.counterparty_name)
                ? (conv.counterparty_name as string)
                : !isPlaceholderName(cpUsername)
                  ? cpUsername
                  : `#${conv.order_number}`;
              const initials = getInitials(displayName);
              const isActive = ACTIVE_STATUSES.has(conv.order_status);

              return (
                <button
                  key={conv.order_id}
                  onClick={() => {
                    onClearUnread?.(conv.order_id);
                    onOpenOrderChat(
                      conv.order_id,
                      displayName,
                      conv.order_number,
                      conv.order_type,
                      cpAvatar,
                    );
                    fetchWithAuth(`/api/orders/${conv.order_id}/messages`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ reader_type: "merchant" }),
                    }).catch(() => {});
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    width: "100%", textAlign: "left",
                    padding: "13px 16px",
                    background: "none", border: "none", cursor: "pointer",
                    borderBottom: idx < visibleConversations.length - 1
                      ? "1px solid var(--border)"
                      : "none",
                  }}
                >
                  {/* Avatar */}
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    {cpAvatar ? (
                      <img
                        src={cpAvatar}
                        alt={cpUsername}
                        style={{ width: 46, height: 46, borderRadius: 999, objectFit: "cover", border: "1px solid var(--border)" }}
                      />
                    ) : (
                      <div style={{
                        width: 46, height: 46, borderRadius: 999,
                        background: "linear-gradient(150deg,#ff8a3d,#ff5d73)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", fontWeight: 800, fontSize: 16,
                      }}>
                        {initials}
                      </div>
                    )}
                    {/* Online dot */}
                    <span style={{
                      position: "absolute", bottom: 1, right: 1,
                      width: 11, height: 11, borderRadius: 999,
                      background: "#b8e9d4", boxShadow: "0 0 0 2.5px var(--background)",
                    }} />
                    {/* Unread badge */}
                    {hasUnread && (
                      <span style={{
                        position: "absolute", top: -2, right: -2,
                        minWidth: 18, height: 18,
                        background: "#b8e9d4", color: "#08080a",
                        fontSize: 11, fontWeight: 800,
                        borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center",
                        padding: "0 4px", boxShadow: "0 0 0 2px var(--background)",
                      }}>
                        {conv.unread_count > 9 ? "9+" : conv.unread_count}
                      </span>
                    )}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Row 1: username + trade badge + time */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3, gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {displayName}
                        </span>
                        <span style={{
                          flexShrink: 0,
                          fontSize: 11, fontWeight: 700,
                          color: "var(--color-text-secondary)",
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 6, padding: "1px 7px", whiteSpace: "nowrap",
                        }}>
                          {conv.order_type === "buy" ? "Buy" : "Sell"} {fiatSymbol}{Number(conv.fiat_amount).toLocaleString()}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0, marginLeft: 4, fontWeight: 500 }}>
                        {formatRelativeTime(timestamp)}
                      </span>
                    </div>

                    {/* Row 2: last message + unread pill */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 12, color: hasUnread ? "var(--foreground)" : "var(--color-text-secondary)", fontWeight: hasUnread ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>
                        {conv.last_message
                          ? truncate(conv.last_message.content, 40)
                          : "No messages yet"}
                      </span>
                      {hasUnread && (
                        <span style={{ flexShrink: 0, background: "#b8e9d4", color: "#08080a", fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "1px 7px" }}>
                          {conv.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default MerchantChatTabs;
