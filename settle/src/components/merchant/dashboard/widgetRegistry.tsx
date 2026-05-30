"use client";

/**
 * Merchant dashboard widget registry (Phase 1, see migration 146).
 *
 * Single source of truth for the editable dashboard:
 *   - WIDGET_REGISTRY maps WidgetId → render component
 *   - DEFAULT_LAYOUT_WIDE / DEFAULT_LAYOUT_NARROW match today's hardcoded
 *     arrangement byte-for-byte (so a merchant with NULL dashboard_layout
 *     sees no change after the rewrite)
 *   - DEFAULT_PANEL_SIZES preserves the original react-resizable-panels
 *     defaultSize / minSize / maxSize tuples per column
 *
 * The registry intentionally encodes the wrapper JSX (column backgrounds,
 * borders, data-tour attributes) so MerchantDesktopLayout can render any
 * column as `column.widgets.map(id => REGISTRY[id]({ ctx }))` without
 * special-casing per widget.
 */

import React from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Order } from "@/types/merchant";
import type { OrderConversation } from "@/hooks/useMerchantConversations";
import {
  WIDGET_IDS,
  COLUMN_IDS,
  type DashboardLayout,
} from "@/lib/validation/schemas";

import { DashboardWidgets } from "@/components/merchant/DashboardWidgets";
import { ConfigPanel } from "@/components/merchant/ConfigPanel";
import { PendingOrdersPanel } from "@/components/merchant/PendingOrdersPanel";
import { LeaderboardPanel } from "@/components/merchant/LeaderboardPanel";
import { InProgressPanel } from "@/components/merchant/InProgressPanel";
import { CompletedOrdersPanel } from "@/components/merchant/CompletedOrdersPanel";
import { ActivityPanel } from "@/components/merchant/ActivityPanel";
import { NotificationsPanel } from "@/components/merchant/NotificationsPanel";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { OrderChatView } from "@/components/merchant/OrderChatView";
import { DisputeChatView } from "@/components/merchant/DisputeChatView";

export type WidgetId = (typeof WIDGET_IDS)[number];
export type ColumnId = (typeof COLUMN_IDS)[number];

/**
 * Everything the registry needs to render any widget. Built once in
 * MerchantDesktopLayout from props + local state and passed through to
 * each widget component as a single argument.
 *
 * Intentionally a flat record (not nested per-widget) so adding a new
 * widget that needs an existing field doesn't require restructuring.
 */
export interface DashboardContext {
  // Merchant identity / balance
  merchantId: string | null;
  merchantInfo: any;
  effectiveBalance: number | null;
  todayEarnings: number;
  isMerchantOnline: boolean;
  setIsMerchantOnline: Dispatch<SetStateAction<boolean>>;
  walletStatus?: "ok" | "locked" | "none";
  onAddWallet?: () => void;
  lockedInEscrow: number;

  // Corridor
  activeCorridor: string;
  onCorridorChange: (corridorId: string) => void;

  // Trade form
  openTradeForm: any;
  setOpenTradeForm: (v: any) => void;
  isCreatingTrade: boolean;
  handleDirectOrderCreation: (
    tradeType?: "buy" | "sell",
    priorityFee?: number,
  ) => void;
  refreshBalance: () => void;

  // Order lists
  pendingOrders: Order[];
  ongoingOrders: Order[];
  completedOrders: Order[];
  cancelledOrders: Order[];
  mempoolOrders: any[];
  leaderboardData: any[];

  // Order interactions
  setSelectedOrderPopup: (order: Order | null) => void;
  setSelectedMempoolOrder: (order: any | null) => void;
  setSelectedOrderId: (id: string | null) => void;
  acceptOrder: (order: Order) => void;
  acceptingOrderId: string | null;
  lockingEscrowOrderId?: string | null;
  confirmingOrderId?: string | null;
  markingDone?: boolean;
  cancellingOrderId?: string | null;
  handleCancelOrder: (order: Order) => void;
  handleOpenChat: (order: Order) => void;
  handleOrderAction: (order: any, action: string) => void;
  fetchOrders: () => Promise<void>;
  loadMoreOrders?: () => void;
  hasMoreOrders?: boolean;
  isLoadingMore?: boolean;
  openDisputeModal: (orderId: string) => void;
  setRatingModalData: (
    data: {
      orderId: string;
      counterpartyName: string;
      counterpartyType: "user" | "merchant";
    } | null,
  ) => void;

  // Per-widget collapse states (orthogonal to layout, kept in parent state)
  inProgressCollapsed: boolean;
  setInProgressCollapsed: (v: boolean) => void;
  completedCollapsed: boolean;
  setCompletedCollapsed: (v: boolean) => void;
  activityCollapsed: boolean;
  setActivityCollapsed: (v: boolean) => void;
  leaderboardCollapsed: boolean;
  setLeaderboardCollapsed: (v: boolean) => void;

  // Leaderboard tab
  leaderboardTab: "traders" | "rated" | "reputation";
  setLeaderboardTab: (v: "traders" | "rated" | "reputation") => void;

  // Notifications
  notifications: any[];
  markNotificationRead: (id: string) => void;

  // Chat (slot)
  orderConversations: OrderConversation[];
  totalUnread: number;
  isLoadingConversations: boolean;
  activeOrderChat: {
    orderId: string;
    userName: string;
    orderNumber: string;
    orderType?: "buy" | "sell";
  } | null;
  onOpenOrderChat: (
    orderId: string,
    userName: string,
    orderNumber: string,
    orderType?: "buy" | "sell",
  ) => void;
  onCloseOrderChat: () => void;
  onClearUnread: (orderId: string) => void;
  onClearAllUnread?: () => void;
  playSound: (
    sound:
      | "message"
      | "send"
      | "trade_start"
      | "trade_complete"
      | "notification"
      | "error"
      | "click"
      | "new_order"
      | "order_complete",
  ) => void;
  onOpenPaymentMethods?: () => void;
  onOpenSettings?: () => void;
  onOpenSwap?: () => void;
  onOpenSend?: () => void;
  onOpenDeposit?: () => void;

  // Chat-slot internal state — lives in MerchantDesktopLayout, threaded in
  // so the "chat" widget can swap between MerchantChatTabs / OrderChatView /
  // DisputeChatView without lifting the state any further.
  activeDisputeOrderId: string | null;
  setActiveDisputeOrderId: (id: string | null) => void;
  activeDisputeUserName: string;
  setActiveDisputeUserName: (name: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────
// Widget components
//
// Each one mirrors the JSX block as it exists today in
// MerchantDesktopLayout.tsx, including data-tour attributes and the
// collapse-aware flex wrappers, so the post-refactor render is identical
// when DEFAULT_LAYOUT_WIDE is in effect.
// ─────────────────────────────────────────────────────────────────────────

const WidgetDashboardWidgets: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  // `@container` enables Tailwind v4 container-query variants on inner
  // elements so type/padding can scale with the card width.
  // Top card scrolls internally (overflow-y-auto) so both the hero's
  // SWAP/SEND/DEPOSIT row and the bottom section (CORRIDOR / 9 done · 9
  // cancelled · 18 total) stay reachable even on shorter viewports
  // where the total content exceeds the 50% column height. ConfigPanel
  // below keeps `overflow-hidden` because its flex contract relies on
  // a fixed-height parent.
  <div className="@container h-full flex flex-col rounded-xl border border-foreground/[0.08] bg-foreground/[0.05] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
    <DashboardWidgets
      todayEarnings={ctx.todayEarnings}
      completedOrders={ctx.completedOrders.length}
      cancelledOrders={ctx.cancelledOrders.length}
      balance={ctx.effectiveBalance || 0}
      lockedInEscrow={ctx.lockedInEscrow}
      isOnline={ctx.isMerchantOnline}
      walletStatus={ctx.walletStatus}
      onAddWallet={ctx.onAddWallet}
      merchantId={ctx.merchantId || undefined}
      activeCorridor={ctx.activeCorridor}
      onCorridorChange={ctx.onCorridorChange}
      onToggleOnline={() => ctx.setIsMerchantOnline((prev) => !prev)}
      onOpenCorridor={() => window.open("/merchant/mempool", "_blank")}
      onOpenSwap={ctx.onOpenSwap}
      onOpenSend={ctx.onOpenSend}
      onOpenDeposit={ctx.onOpenDeposit}
    />
  </div>
);

const WidgetConfigPanel: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  // `[container-type:size]` makes the wrapper a container that responds
  // to BOTH inline-size (width) and block-size (height) queries — so
  // form text/padding can shrink either when the column is narrowed
  // (@max-[N]) or when the card is shorter (@max-h-[N]). Using this
  // alone instead of `@container` because @container sets the same
  // property (inline-size only) and Tailwind flags the duplicate.
  <div className="[container-type:size] h-full flex flex-col rounded-xl border border-foreground/[0.08] bg-foreground/[0.05] overflow-hidden">
    <ConfigPanel
      merchantId={ctx.merchantId}
      merchantInfo={ctx.merchantInfo}
      effectiveBalance={ctx.effectiveBalance}
      activeCorridor={ctx.activeCorridor}
      openTradeForm={ctx.openTradeForm}
      setOpenTradeForm={ctx.setOpenTradeForm}
      isCreatingTrade={ctx.isCreatingTrade}
      onCreateOrder={ctx.handleDirectOrderCreation}
      refreshBalance={ctx.refreshBalance}
    />
  </div>
);

const WidgetPendingOrders: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  <div data-tour="pending-panel" className="h-full flex flex-col overflow-hidden">
    <PendingOrdersPanel
      orders={ctx.pendingOrders}
      mempoolOrders={ctx.mempoolOrders}
      merchantInfo={ctx.merchantInfo}
      onSelectOrder={ctx.setSelectedOrderPopup}
      onSelectMempoolOrder={ctx.setSelectedMempoolOrder}
      onAcceptOrder={ctx.acceptOrder}
      acceptingOrderId={ctx.acceptingOrderId}
      onCancelOrder={ctx.handleCancelOrder}
      onOpenChat={ctx.handleOpenChat}
      fetchOrders={ctx.fetchOrders}
      onLoadMore={ctx.loadMoreOrders}
      hasMore={ctx.hasMoreOrders}
      isLoadingMore={ctx.isLoadingMore}
    />
  </div>
);

const WidgetInProgress: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  <div
    data-tour="inprogress-panel"
    className="h-full flex flex-col overflow-hidden border-b border-foreground/[0.08]"
  >
    <InProgressPanel
      orders={ctx.ongoingOrders}
      onSelectOrder={ctx.setSelectedOrderPopup}
      onAction={ctx.handleOrderAction}
      onOpenChat={ctx.handleOpenChat}
      onOpenDispute={(order) => ctx.openDisputeModal(order.id)}
      collapsed={ctx.inProgressCollapsed}
      onCollapseChange={ctx.setInProgressCollapsed}
      merchantId={ctx.merchantId}
      lockingEscrowOrderId={ctx.lockingEscrowOrderId}
      confirmingOrderId={ctx.confirmingOrderId}
      markingDone={ctx.markingDone}
      acceptingOrderId={ctx.acceptingOrderId}
      cancellingOrderId={ctx.cancellingOrderId}
    />
  </div>
);

const WidgetCompleted: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  <div
    data-tour="completed-panel"
    className="h-full flex flex-col overflow-hidden border-b border-foreground/[0.08]"
  >
    <CompletedOrdersPanel
      orders={ctx.completedOrders}
      onSelectOrder={(order) => ctx.setSelectedOrderId(order.id)}
      collapsed={ctx.completedCollapsed}
      onCollapseChange={ctx.setCompletedCollapsed}
      walletBalance={ctx.effectiveBalance}
    />
  </div>
);

const WidgetLeaderboard: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  <div
    data-tour="leaderboard"
    className="h-full flex flex-col overflow-hidden border-b border-section-divider"
  >
    <LeaderboardPanel
      leaderboardData={ctx.leaderboardData}
      leaderboardTab={ctx.leaderboardTab}
      setLeaderboardTab={ctx.setLeaderboardTab}
      onCollapseChange={ctx.setLeaderboardCollapsed}
    />
  </div>
);

const WidgetActivity: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  <div className="h-full flex flex-col overflow-hidden">
    <ActivityPanel
      merchantId={ctx.merchantId}
      completedOrders={ctx.completedOrders}
      cancelledOrders={ctx.cancelledOrders}
      ongoingOrders={ctx.ongoingOrders}
      pendingOrders={ctx.pendingOrders}
      onRateOrder={(order) =>
        ctx.setRatingModalData({
          orderId: order.id,
          counterpartyName: order.user || "User",
          counterpartyType: order.isM2M ? "merchant" : "user",
        })
      }
      onSelectOrder={(orderId) => ctx.setSelectedOrderId(orderId)}
      onCollapseChange={ctx.setActivityCollapsed}
    />
  </div>
);

const WidgetNotifications: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  <div className="h-full overflow-hidden">
  <NotificationsPanel
    notifications={ctx.notifications}
    onMarkRead={ctx.markNotificationRead}
    onSelectOrder={ctx.setSelectedOrderId}
    onOpenChat={(orderId) => {
      const order =
        ctx.pendingOrders.find((o) => o.id === orderId) ||
        ctx.ongoingOrders.find((o) => o.id === orderId) ||
        ctx.completedOrders.find((o) => o.id === orderId) ||
        ctx.cancelledOrders.find((o) => o.id === orderId);
      if (order) ctx.handleOpenChat(order);
      else ctx.setSelectedOrderId(orderId);
    }}
    onOpenPaymentMethods={ctx.onOpenPaymentMethods}
    onOpenSettings={ctx.onOpenSettings}
  />
  </div>
);

const WidgetChat: React.FC<{ ctx: DashboardContext }> = ({ ctx }) => (
  <div className="h-full flex flex-col overflow-hidden">
    {ctx.activeDisputeOrderId ? (
      <DisputeChatView
        orderId={ctx.activeDisputeOrderId}
        merchantId={ctx.merchantId || ""}
        userName={ctx.activeDisputeUserName}
        onBack={() => {
          ctx.setActiveDisputeOrderId(null);
          ctx.setActiveDisputeUserName("");
        }}
        onSendSound={() => ctx.playSound("send")}
      />
    ) : ctx.activeOrderChat ? (
      <OrderChatView
        orderId={ctx.activeOrderChat.orderId}
        merchantId={ctx.merchantId || ""}
        userName={ctx.activeOrderChat.userName}
        orderNumber={ctx.activeOrderChat.orderNumber}
        orderType={ctx.activeOrderChat.orderType}
        onBack={ctx.onCloseOrderChat}
        onSendSound={() => ctx.playSound("send")}
      />
    ) : (
      <MerchantChatTabs
        merchantId={ctx.merchantId || ""}
        orderConversations={ctx.orderConversations}
        totalUnread={ctx.totalUnread}
        isLoading={ctx.isLoadingConversations}
        onOpenOrderChat={ctx.onOpenOrderChat}
        onClearUnread={ctx.onClearUnread}
        onClearAllUnread={ctx.onClearAllUnread}
        onOpenDisputeChat={(orderId, userName) => {
          ctx.setActiveDisputeOrderId(orderId);
          ctx.setActiveDisputeUserName(userName);
        }}
      />
    )}
  </div>
);

export const WIDGET_REGISTRY: Record<
  WidgetId,
  React.FC<{ ctx: DashboardContext }>
> = {
  dashboardWidgets: WidgetDashboardWidgets,
  configPanel: WidgetConfigPanel,
  pendingOrders: WidgetPendingOrders,
  inProgress: WidgetInProgress,
  completedOrders: WidgetCompleted,
  leaderboard: WidgetLeaderboard,
  activity: WidgetActivity,
  notifications: WidgetNotifications,
  chat: WidgetChat,
};

/** Human-readable label for each widget, used by the hidden-tray chip. */
export const WIDGET_LABELS: Record<WidgetId, string> = {
  dashboardWidgets: "Balance",
  configPanel: "Create Trade",
  pendingOrders: "Pending Orders",
  inProgress: "In Progress",
  completedOrders: "Completed",
  leaderboard: "Leaderboard",
  activity: "Activity",
  notifications: "Notifications",
  chat: "Messages",
};

// ─────────────────────────────────────────────────────────────────────────
// Default layouts + panel sizes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Wide-screen (≥1536px) default — mirrors today's hardcoded arrangement
 * exactly when `dashboard_layout IS NULL`.
 */
export const DEFAULT_LAYOUT_WIDE: DashboardLayout = {
  version: 1,
  hidden: [],
  columns: [
    { id: "left", widgets: ["dashboardWidgets", "configPanel"] },
    { id: "center-left", widgets: ["pendingOrders"] },
    { id: "center-right", widgets: ["inProgress"] },
    { id: "transactions", widgets: ["leaderboard", "activity"] },
    { id: "right", widgets: ["notifications", "chat"] },
  ],
};

/**
 * Narrow desktop (<1536px, ≥lg breakpoint) — no dedicated transactions
 * column today; leaderboard collapses into center-left and activity into
 * center-right. Keep this aligned with the `isWideScreen` branch in
 * MerchantDesktopLayout.legacy.
 */
export const DEFAULT_LAYOUT_NARROW: DashboardLayout = {
  version: 1,
  hidden: [],
  columns: [
    { id: "left", widgets: ["dashboardWidgets", "configPanel"] },
    { id: "center-left", widgets: ["pendingOrders", "leaderboard"] },
    { id: "center-right", widgets: ["inProgress", "activity"] },
    { id: "right", widgets: ["notifications", "chat"] },
  ],
};

/**
 * react-resizable-panels defaultSize / minSize / maxSize per column —
 * preserves the original tuples. Indexed by ColumnId + screen mode.
 */
export const DEFAULT_PANEL_SIZES: Record<
  "wide" | "narrow",
  Partial<
    Record<
      ColumnId,
      { defaultSize: string; minSize: string; maxSize: string }
    >
  >
> = {
  wide: {
    left: { defaultSize: "20%", minSize: "14%", maxSize: "30%" },
    "center-left": { defaultSize: "24%", minSize: "16%", maxSize: "35%" },
    "center-right": { defaultSize: "20%", minSize: "14%", maxSize: "32%" },
    transactions: { defaultSize: "18%", minSize: "12%", maxSize: "30%" },
    right: { defaultSize: "18%", minSize: "12%", maxSize: "30%" },
  },
  narrow: {
    left: { defaultSize: "24%", minSize: "16%", maxSize: "35%" },
    "center-left": { defaultSize: "27%", minSize: "16%", maxSize: "40%" },
    "center-right": { defaultSize: "27%", minSize: "18%", maxSize: "40%" },
    right: { defaultSize: "22%", minSize: "15%", maxSize: "35%" },
  },
};

/**
 * Pick the right default layout for the current viewport.
 */
export function getDefaultLayout(isWideScreen: boolean): DashboardLayout {
  return isWideScreen ? DEFAULT_LAYOUT_WIDE : DEFAULT_LAYOUT_NARROW;
}

/**
 * Forward-compat: drop columns / widgets we don't recognize, drop hidden
 * entries that no longer exist, and merge any registry-known widgets that
 * are missing into the hidden array. Returns a layout safe to render.
 */
export function reconcileLayout(
  raw: unknown,
  fallback: DashboardLayout,
): DashboardLayout {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Partial<DashboardLayout>;
  if (r.version !== 1 || !Array.isArray(r.columns) || !Array.isArray(r.hidden)) {
    return fallback;
  }
  const seen = new Set<WidgetId>();
  const columns = r.columns
    .filter(
      (c): c is { id: ColumnId; widgets: WidgetId[] } =>
        !!c &&
        typeof c === "object" &&
        (COLUMN_IDS as readonly string[]).includes((c as any).id) &&
        Array.isArray((c as any).widgets),
    )
    .map((c) => ({
      id: c.id,
      widgets: c.widgets.filter((w): w is WidgetId => {
        if (!(WIDGET_IDS as readonly string[]).includes(w)) return false;
        if (seen.has(w)) return false;
        seen.add(w);
        return true;
      }),
    }));
  const hidden = r.hidden.filter((w): w is WidgetId => {
    if (!(WIDGET_IDS as readonly string[]).includes(w)) return false;
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });
  // Any registry widget not placed → keep it hidden so unknown-from-storage
  // never silently disappears.
  for (const id of WIDGET_IDS) {
    if (!seen.has(id)) hidden.push(id);
  }
  return { version: 1, columns, hidden };
}
