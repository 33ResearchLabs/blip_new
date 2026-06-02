"use client";

import React, { useMemo } from "react";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import type { Order } from "@/types/merchant";
import { DashboardWidgets } from "@/components/merchant/DashboardWidgets";
import { ConfigPanel } from "@/components/merchant/ConfigPanel";
import { PendingOrdersPanel } from "@/components/merchant/PendingOrdersPanel";
import { LeaderboardPanel } from "@/components/merchant/LeaderboardPanel";
import { InProgressPanel } from "@/components/merchant/InProgressPanel";
import { ActivityPanel } from "@/components/merchant/ActivityPanel";
import { CompletedOrdersPanel } from "@/components/merchant/CompletedOrdersPanel";
import { NotificationsPanel } from "@/components/merchant/NotificationsPanel";
import { useState, Fragment } from "react";
import { OrderChatView } from "@/components/merchant/OrderChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { DisputeChatView } from "@/components/merchant/DisputeChatView";
import type { OrderConversation } from "@/hooks/useMerchantConversations";
import {
  WIDGET_REGISTRY,
  WIDGET_LABELS,
  DEFAULT_PANEL_SIZES,
  type DashboardContext,
  type WidgetId,
  type ColumnId,
} from "@/components/merchant/dashboard/widgetRegistry";
import { useDashboardLayout } from "@/hooks/useDashboardLayout";
import { WidgetShell } from "@/components/merchant/dashboard/WidgetShell";
import {
  HiddenWidgetsTray,
  HIDDEN_CONTAINER_ID,
} from "@/components/merchant/dashboard/HiddenWidgetsTray";
import { useMerchantStore } from "@/stores/merchantStore";
import type { DashboardLayout } from "@/lib/validation/schemas";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { AppDownloadSection } from "@/components/merchant/AppDownloadSection";

// Phase 1 (migration 146): when this flag is on, the wide-screen render
// path is data-driven from the merchant's saved dashboard_layout (falls
// back to DEFAULT_LAYOUT_WIDE when null). Narrow viewports and the
// flag-off case go through the legacy hardcoded JSX below, untouched.
const MERCHANT_LAYOUT_V2 =
  process.env.NEXT_PUBLIC_MERCHANT_LAYOUT_V2 === "true";

export interface MerchantDesktopLayoutProps {
  isWideScreen: boolean;

  // Order lists
  pendingOrders: Order[];
  ongoingOrders: Order[];
  completedOrders: Order[];
  cancelledOrders: Order[];
  mempoolOrders: any[];
  leaderboardData: any[];

  // Merchant info
  merchantId: string | null;
  merchantInfo: any;
  effectiveBalance: number | null;
  todayEarnings: number;
  isMerchantOnline: boolean;
  setIsMerchantOnline: React.Dispatch<React.SetStateAction<boolean>>;
  walletStatus?: 'ok' | 'locked' | 'none';
  onAddWallet?: () => void;

  // Corridor
  activeCorridor: string;
  onCorridorChange: (corridorId: string) => void;

  // Config panel
  openTradeForm: any;
  setOpenTradeForm: (v: any) => void;
  isCreatingTrade: boolean;
  handleDirectOrderCreation: (tradeType?: "buy" | "sell", priorityFee?: number) => void;
  refreshBalance: () => void;

  // Order actions
  setSelectedOrderPopup: (order: Order | null) => void;
  setSelectedMempoolOrder: (order: any | null) => void;
  setSelectedOrderId: (id: string | null) => void;
  acceptOrder: (order: Order) => void;
  acceptingOrderId: string | null;
  lockingEscrowOrderId?: string | null;
  confirmingOrderId?: string | null;
  /** Global "I've Paid in flight" flag — drives the spinner on the InProgress
   *  card's primary button when the action is Send Payment / I've Paid. */
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
  setRatingModalData: (data: { orderId: string; counterpartyName: string; counterpartyType: "user" | "merchant" } | null) => void;

  // Collapse states
  inProgressCollapsed: boolean;
  setInProgressCollapsed: (v: boolean) => void;
  completedCollapsed: boolean;
  setCompletedCollapsed: (v: boolean) => void;
  activityCollapsed: boolean;
  setActivityCollapsed: (v: boolean) => void;
  leaderboardCollapsed: boolean;
  setLeaderboardCollapsed: (v: boolean) => void;

  // Tabs
  leaderboardTab: "traders" | "rated" | "reputation";
  setLeaderboardTab: (v: "traders" | "rated" | "reputation") => void;

  // Notifications
  notifications: any[];
  markNotificationRead: (id: string) => void;

  // Chat (order-based)
  orderConversations: OrderConversation[];
  totalUnread: number;
  isLoadingConversations: boolean;
  activeOrderChat: { orderId: string; userName: string; orderNumber: string; orderType?: 'buy' | 'sell' } | null;
  onOpenOrderChat: (orderId: string, userName: string, orderNumber: string, orderType?: 'buy' | 'sell') => void;
  onCloseOrderChat: () => void;
  onClearUnread: (orderId: string) => void;
  onClearAllUnread?: () => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
  /** Threaded to the OnboardingSetupCard inside NotificationsPanel. */
  onOpenPaymentMethods?: () => void;
  onOpenSettings?: () => void;
  /** Open the on-chain Swap modal (Jupiter v1, 0.5% platform fee). */
  onOpenSwap?: () => void;
  /** Open the SOL / USDT / USDC Send modal. */
  onOpenSend?: () => void;
  /** Open the Deposit / receive-address QR modal. */
  onOpenDeposit?: () => void;
  /** Alias for onOpenDeposit — receive address QR. */
  onOpenReceive?: () => void;
}

export const MerchantDesktopLayout = React.memo(function MerchantDesktopLayout(props: MerchantDesktopLayoutProps) {
  const [activeDisputeOrderId, setActiveDisputeOrderId] = useState<string | null>(null);
  const [activeDisputeUserName, setActiveDisputeUserName] = useState('');
  const {
    isWideScreen,
    pendingOrders, ongoingOrders, completedOrders, cancelledOrders,
    mempoolOrders, leaderboardData,
    merchantId, merchantInfo, effectiveBalance, todayEarnings,
    isMerchantOnline, setIsMerchantOnline, walletStatus, onAddWallet,
    activeCorridor, onCorridorChange,
    openTradeForm, setOpenTradeForm, isCreatingTrade,
    handleDirectOrderCreation, refreshBalance,
    setSelectedOrderPopup, setSelectedMempoolOrder, setSelectedOrderId,
    acceptOrder, acceptingOrderId, lockingEscrowOrderId, confirmingOrderId, markingDone, cancellingOrderId, handleCancelOrder, handleOpenChat,
    handleOrderAction, fetchOrders, loadMoreOrders, hasMoreOrders, isLoadingMore, openDisputeModal, setRatingModalData,
    inProgressCollapsed, setInProgressCollapsed,
    completedCollapsed, setCompletedCollapsed,
    activityCollapsed, setActivityCollapsed,
    leaderboardCollapsed, setLeaderboardCollapsed,
    leaderboardTab, setLeaderboardTab,
    notifications, markNotificationRead,
    orderConversations, totalUnread, isLoadingConversations,
    activeOrderChat, onOpenOrderChat, onCloseOrderChat, onClearUnread, onClearAllUnread,
    playSound,
    onOpenPaymentMethods, onOpenSettings,
  } = props;

  // Real-time "locked in escrow" total — sums crypto amounts for ongoing
  // orders where THIS merchant is the escrow funder (seller role, own
  // merchant id, or explicitly is-my-order). Previously hardcoded to 245.5
  // which showed the same fake value to every merchant.
  // Defensive: silently ignores orders with non-finite amounts.
  const lockedInEscrow = useMemo(() => {
    return ongoingOrders.reduce((sum, o) => {
      const isEscrowFunder =
        o.isMyOrder === true ||
        o.myRole === 'seller' ||
        (merchantId != null && o.orderMerchantId === merchantId);
      if (!isEscrowFunder) return sum;
      const amt = typeof o.amount === 'number' ? o.amount : 0;
      return Number.isFinite(amt) ? sum + amt : sum;
    }, 0);
  }, [ongoingOrders, merchantId]);

  // ── Phase 1 v2 path ─────────────────────────────────────────────────
  // V2 renders at all desktop widths (the wrapper's `hidden lg:flex`
  // handles the mobile cutoff). Edit-layout mode only works against V2,
  // so gating V2 to 2xl+ left the Edit button non-functional between
  // lg and 2xl — now V2 takes over from lg upward whenever the flag is on.
  if (MERCHANT_LAYOUT_V2) {
    return (
      <MerchantDashboardV2
        props={props}
        lockedInEscrow={lockedInEscrow}
        activeDisputeOrderId={activeDisputeOrderId}
        setActiveDisputeOrderId={setActiveDisputeOrderId}
        activeDisputeUserName={activeDisputeUserName}
        setActiveDisputeUserName={setActiveDisputeUserName}
      />
    );
  }

  return (
    <div className="hidden lg:flex lg:flex-col h-screen overflow-hidden">
      <PanelGroup
        orientation="horizontal"
        className="flex-1 overflow-hidden"
        key={isWideScreen ? "wide" : "narrow"}
      >
        <Panel
          defaultSize={isWideScreen ? "20%" : "24%"}
          minSize={isWideScreen ? "14%" : "16%"}
          maxSize={isWideScreen ? "30%" : "35%"}
          id="left"
        >
          {/* Legacy left sidebar — 50/50 vertical split (matches v2).
              Outer column: no overflow-y-auto so column never scrolls;
              each card takes exactly half via `flex-1 min-h-0`. Cards
              are marked as containers (`@container` / [container-type:
              size]) so the existing @max-[N] / @max-h-[N] responsive
              typography fires here too. Content overflow is handled by
              each component's internal `flex-1 overflow-y-auto`, so a
              tall section scrolls inside itself without resizing the
              other section. */}
          <div className="flex flex-col h-full bg-background border-r border-white/[0.05]">
            <div className="flex flex-col flex-1 p-2 gap-2 min-h-0">
              <div
                className="@container min-h-0 rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.02] shadow-[0_2px_16px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] flex flex-col"
                style={{ flex: 2 }}
              >
                <CardLabel label="Balance" live />
                <div className="flex-1 min-h-0 overflow-hidden">
                  <DashboardWidgets
                    todayEarnings={todayEarnings}
                    completedOrders={completedOrders.length}
                    cancelledOrders={cancelledOrders.length}
                    balance={effectiveBalance || 0}
                    lockedInEscrow={lockedInEscrow}
                    isOnline={isMerchantOnline}
                    walletStatus={walletStatus}
                    onAddWallet={onAddWallet}
                    merchantId={merchantId || undefined}
                    activeCorridor={activeCorridor}
                    onCorridorChange={onCorridorChange}
                    onToggleOnline={() => setIsMerchantOnline((prev) => !prev)}
                    onOpenCorridor={() => window.open(`/merchant/mempool?corridor=${activeCorridor}`, "_blank")}
                    onOpenSwap={props.onOpenSwap}
                    onOpenSend={props.onOpenSend}
                    onOpenDeposit={props.onOpenDeposit}
                  />
                </div>
              </div>
              <div className="[container-type:size] min-h-0 rounded-xl overflow-hidden border border-white/[0.08] bg-white/[0.02] shadow-[0_2px_16px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)] flex flex-col" style={{ flex: 3 }}>
                <CardLabel label="Trade" />
                <div className="flex-1 min-h-0 overflow-hidden">
                  <ConfigPanel
                    merchantId={merchantId}
                    merchantInfo={merchantInfo}
                    effectiveBalance={effectiveBalance}
                    activeCorridor={activeCorridor}
                    openTradeForm={openTradeForm}
                    setOpenTradeForm={setOpenTradeForm}
                    isCreatingTrade={isCreatingTrade}
                    onCreateOrder={handleDirectOrderCreation}
                    refreshBalance={refreshBalance}
                  />
                </div>
              </div>
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="w-px bg-white/[0.05] hover:bg-white/[0.08] hover:w-[3px] transition-all cursor-col-resize" />
        <Panel
          defaultSize={isWideScreen ? "24%" : "27%"}
          minSize="16%"
          maxSize={isWideScreen ? "35%" : "40%"}
          id="center-left"
        >
          <div className="flex flex-col h-full bg-background border-r border-white/[0.05]" data-tour="pending-panel">
            {isWideScreen ? (
              <PendingOrdersPanel
                orders={pendingOrders}
                mempoolOrders={mempoolOrders}
                merchantInfo={merchantInfo}
                onSelectOrder={setSelectedOrderPopup}
                onSelectMempoolOrder={setSelectedMempoolOrder}
                onAcceptOrder={acceptOrder}
                acceptingOrderId={acceptingOrderId}
                onCancelOrder={handleCancelOrder}
                onOpenChat={handleOpenChat}
                fetchOrders={fetchOrders}
                onLoadMore={loadMoreOrders}
                hasMore={hasMoreOrders}
                isLoadingMore={isLoadingMore}
              />
            ) : (
              <>
                <div
                  style={{ height: "60%" }}
                  className="flex flex-col border-b border-section-divider"
                >
                  <PendingOrdersPanel
                    orders={pendingOrders}
                    mempoolOrders={mempoolOrders}
                    merchantInfo={merchantInfo}
                    onSelectOrder={setSelectedOrderPopup}
                    onSelectMempoolOrder={setSelectedMempoolOrder}
                    onAcceptOrder={acceptOrder}
                    acceptingOrderId={acceptingOrderId}
                    onCancelOrder={handleCancelOrder}
                    onOpenChat={handleOpenChat}
                    fetchOrders={fetchOrders}
                  />
                </div>
                <div className="flex-1 flex flex-col min-h-0">
                  <LeaderboardPanel
                    leaderboardData={leaderboardData}
                    leaderboardTab={leaderboardTab}
                    setLeaderboardTab={setLeaderboardTab}
                  />
                </div>
              </>
            )}
          </div>
        </Panel>
        <PanelResizeHandle className="w-px bg-white/[0.05] hover:bg-white/[0.08] hover:w-[3px] transition-all cursor-col-resize" />
        <Panel
          defaultSize={isWideScreen ? "20%" : "27%"}
          minSize={isWideScreen ? "14%" : "18%"}
          maxSize={isWideScreen ? "32%" : "40%"}
          id="center-right"
        >
          <div className="flex flex-col h-full bg-background border-r border-white/[0.05]">
            <div
              data-tour="inprogress-panel"
              className={`flex flex-col border-b border-foreground/[0.08] transition-all duration-200 ${inProgressCollapsed ? "" : "flex-1 min-h-0"}`}
            >
              <InProgressPanel
                orders={ongoingOrders}
                onSelectOrder={setSelectedOrderPopup}
                onAction={handleOrderAction}
                onOpenChat={handleOpenChat}
                onOpenDispute={(order) => openDisputeModal(order.id)}
                collapsed={inProgressCollapsed}
                onCollapseChange={setInProgressCollapsed}
                merchantId={merchantId}
                lockingEscrowOrderId={lockingEscrowOrderId}
                confirmingOrderId={confirmingOrderId}
                markingDone={markingDone}
                acceptingOrderId={acceptingOrderId}
                cancellingOrderId={cancellingOrderId}
              />
            </div>
            {/* Activity panel.
                On wide screens it lives under Leaderboard in the
                rightmost column. On narrow viewports there's no
                separate column, so it stays here below InProgress. */}
            {!isWideScreen && (
              <>
                {activityCollapsed && inProgressCollapsed && (
                  <div className="flex-1" />
                )}
                <div className={`flex flex-col min-h-0 ${activityCollapsed ? '' : 'flex-1'}`}>
                  <ActivityPanel
                    merchantId={merchantId}
                    completedOrders={completedOrders}
                    cancelledOrders={cancelledOrders}
                    ongoingOrders={ongoingOrders}
                    pendingOrders={pendingOrders}
                    onRateOrder={(order) =>
                      setRatingModalData({
                        orderId: order.id,
                        counterpartyName: order.user || "User",
                        counterpartyType: order.isM2M ? "merchant" : "user",
                      })
                    }
                    onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
                    onCollapseChange={setActivityCollapsed}
                  />
                </div>
              </>
            )}
            {isWideScreen && inProgressCollapsed && (
              <div className="flex-1" />
            )}
          </div>
        </Panel>
        {isWideScreen && (
          <>
            <PanelResizeHandle className="w-px bg-white/[0.05] hover:bg-white/[0.08] hover:w-[3px] transition-all cursor-col-resize" />
            <Panel
              defaultSize="18%"
              minSize="12%"
              maxSize="30%"
              id="transactions"
            >
              <div className="flex flex-col h-full bg-background border-r border-white/[0.05]">
                <div
                  data-tour="leaderboard"
                  className={`flex flex-col border-b border-section-divider transition-all duration-200 ${leaderboardCollapsed ? "" : "flex-1 min-h-0"}`}
                >
                  <LeaderboardPanel
                    leaderboardData={leaderboardData}
                    leaderboardTab={leaderboardTab}
                    setLeaderboardTab={setLeaderboardTab}
                    onCollapseChange={setLeaderboardCollapsed}
                  />
                </div>
                {/* Activity sits under Leaderboard on wide screens so
                    the merchant has both at-a-glance: ranking on top,
                    historical activity below. */}
                {activityCollapsed && leaderboardCollapsed && (
                  <div className="flex-1" />
                )}
                <div className={`flex flex-col transition-all duration-200 ${activityCollapsed ? "" : "flex-1 min-h-0"}`}>
                  <ActivityPanel
                    merchantId={merchantId}
                    completedOrders={completedOrders}
                    cancelledOrders={cancelledOrders}
                    ongoingOrders={ongoingOrders}
                    pendingOrders={pendingOrders}
                    onRateOrder={(order) =>
                      setRatingModalData({
                        orderId: order.id,
                        counterpartyName: order.user || "User",
                        counterpartyType: order.isM2M ? "merchant" : "user",
                      })
                    }
                    onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
                    onCollapseChange={setActivityCollapsed}
                  />
                </div>
              </div>
            </Panel>
          </>
        )}
        <PanelResizeHandle className="w-px bg-white/[0.05] hover:bg-white/[0.08] hover:w-[3px] transition-all cursor-col-resize" />
        <Panel
          defaultSize={isWideScreen ? "18%" : "22%"}
          minSize={isWideScreen ? "12%" : "15%"}
          maxSize={isWideScreen ? "30%" : "35%"}
          id="right"
        >
          <div className="flex flex-col h-full bg-background overflow-hidden border-l border-white/[0.05]">
            <NotificationsPanel
              notifications={notifications}
              onMarkRead={markNotificationRead}
              onSelectOrder={setSelectedOrderId}
              onOpenChat={(orderId) => {
                const order =
                  pendingOrders.find(o => o.id === orderId) ||
                  ongoingOrders.find(o => o.id === orderId) ||
                  completedOrders.find(o => o.id === orderId) ||
                  cancelledOrders.find(o => o.id === orderId);
                if (order) handleOpenChat(order);
                else setSelectedOrderId(orderId);
              }}
              onOpenPaymentMethods={onOpenPaymentMethods}
              onOpenSettings={onOpenSettings}
            />
            <div className="flex-1 flex flex-col min-h-0">
              {activeDisputeOrderId ? (
                <DisputeChatView
                  orderId={activeDisputeOrderId}
                  merchantId={merchantId || ""}
                  userName={activeDisputeUserName}
                  onBack={() => { setActiveDisputeOrderId(null); setActiveDisputeUserName(''); }}
                  onSendSound={() => playSound("send")}
                />
              ) : activeOrderChat ? (
                <OrderChatView
                  orderId={activeOrderChat.orderId}
                  merchantId={merchantId || ""}
                  userName={activeOrderChat.userName}
                  orderNumber={activeOrderChat.orderNumber}
                  orderType={activeOrderChat.orderType}
                  onBack={onCloseOrderChat}
                  onSendSound={() => playSound("send")}
                />
              ) : (
                <MerchantChatTabs
                  merchantId={merchantId || ""}
                  orderConversations={orderConversations}
                  totalUnread={totalUnread}
                  isLoading={isLoadingConversations}
                  onOpenOrderChat={onOpenOrderChat}
                  onClearUnread={onClearUnread}
                  onClearAllUnread={onClearAllUnread}
                  onOpenDisputeChat={(orderId, userName) => {
                    setActiveDisputeOrderId(orderId);
                    setActiveDisputeUserName(userName);
                  }}
                />
              )}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
});

// ──────────────────────────────────────────────────────────────────────
// Phase 1 v2 path (flag-gated)
//
// Renders the merchant dashboard from the saved DashboardLayout instead
// of hardcoded JSX. When the merchant has no saved layout, the registry's
// DEFAULT_LAYOUT_WIDE produces an arrangement byte-identical to the
// legacy render — so flipping the flag has no visible effect on its own.
//
// Phase 2 will add the DnD edit mode on top of this same render path.
// ──────────────────────────────────────────────────────────────────────

interface MerchantDashboardV2Props {
  props: MerchantDesktopLayoutProps;
  lockedInEscrow: number;
  activeDisputeOrderId: string | null;
  setActiveDisputeOrderId: (id: string | null) => void;
  activeDisputeUserName: string;
  setActiveDisputeUserName: (name: string) => void;
}

function MerchantDashboardV2({
  props,
  lockedInEscrow,
  activeDisputeOrderId,
  setActiveDisputeOrderId,
  activeDisputeUserName,
  setActiveDisputeUserName,
}: MerchantDashboardV2Props) {
  const { layout, updateLayout, resetToDefault } = useDashboardLayout(
    props.isWideScreen,
  );
  const isEditing = useMerchantStore((s) => s.isEditingLayout);
  const [activeDragId, setActiveDragId] = useState<WidgetId | null>(null);

  // 8 px activation distance: when edit mode is off the shells are inert
  // (disabled), but defense-in-depth — a small distance also stops a casual
  // mouse-down inside a widget from triggering a drag if we ever flip the
  // disabled flag wrong.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const onDragStart = React.useCallback((e: DragStartEvent) => {
    setActiveDragId(e.active.id as WidgetId);
  }, []);

  // Custom collision detection. Single-shot `closestCorners` measures the
  // active rect to each droppable's CORNERS — for a tall, thin, empty
  // column the cursor sitting in the middle of the column is far from
  // any of its corners, so closestCorners picks an adjacent column's
  // widget as the "closest" and drops never land in the empty column.
  //
  // Layered fix: cursor-in-rect (pointerWithin) is the strongest signal
  // — if the cursor is inside a droppable, that's the intent. Fall back
  // to rectIntersection (overlap-based) then closestCenter so an out-of-
  // bounds drag still picks a reasonable target.
  const collisionDetection = React.useCallback<CollisionDetection>(
    (args) => {
      const pointer = pointerWithin(args);
      if (pointer.length > 0) return pointer;
      const intersecting = rectIntersection(args);
      if (intersecting.length > 0) return intersecting;
      return closestCenter(args);
    },
    [],
  );

  type ContainerId = ColumnId | typeof HIDDEN_CONTAINER_ID;
  const COLUMN_ID_SET = React.useMemo(
    () =>
      new Set<ColumnId>([
        "left",
        "center-left",
        "center-right",
        "transactions",
        "right",
      ]),
    [],
  );

  /** Resolve a widget id OR a container id (column / hidden) → container id. */
  const findContainer = React.useCallback(
    (id: string): ContainerId | null => {
      if (id === HIDDEN_CONTAINER_ID) return HIDDEN_CONTAINER_ID;
      if (COLUMN_ID_SET.has(id as ColumnId)) return id as ColumnId;
      for (const col of layout.columns) {
        if (col.widgets.includes(id as WidgetId)) return col.id;
      }
      if (layout.hidden.includes(id as WidgetId)) return HIDDEN_CONTAINER_ID;
      return null;
    },
    [COLUMN_ID_SET, layout.columns, layout.hidden],
  );

  const onDragEnd = React.useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      setActiveDragId(null);
      if (!over) return;
      const activeId = active.id as WidgetId;
      const overId = over.id as string;
      if (activeId === overId) return;

      const from = findContainer(activeId);
      const to = findContainer(overId);
      if (!from || !to) return;

      // "Drop after over?" — compares the active's translated mid-Y to
      // the over rect's mid-Y. If the user dragged below the over item's
      // centre, insert AFTER it; otherwise BEFORE. Without this, every
      // drop into a single-item column would land above the existing
      // widget instead of below where the user aimed.
      const overRect = over.rect;
      const activeTranslated = active.rect.current.translated;
      const dropAfter =
        overRect && activeTranslated
          ? activeTranslated.top + activeTranslated.height / 2 >
            overRect.top + overRect.height / 2
          : false;

      // Same-column reorder: arrayMove keeps the over item at its visible
      // spot relative to the active (before/after handled natively).
      if (from === to && from !== HIDDEN_CONTAINER_ID) {
        const nextColumns = layout.columns.map((c) => ({
          ...c,
          widgets: [...c.widgets],
        }));
        const colIdx = nextColumns.findIndex((c) => c.id === from);
        if (colIdx === -1) return;
        const widgets = nextColumns[colIdx].widgets;
        const fromIdx = widgets.indexOf(activeId);
        const toIdx =
          overId === to
            ? widgets.length - 1
            : widgets.indexOf(overId as WidgetId);
        if (fromIdx === -1 || toIdx === -1) return;
        nextColumns[colIdx].widgets = arrayMove(widgets, fromIdx, toIdx);
        updateLayout({
          version: 1,
          columns: nextColumns,
          hidden: [...layout.hidden],
        });
        return;
      }

      // Cross-container (or hidden-tray ↔ column). Two-phase splice.
      const nextColumns = layout.columns.map((c) => ({
        ...c,
        widgets: [...c.widgets],
      }));
      const nextHidden = [...layout.hidden];

      if (from === HIDDEN_CONTAINER_ID) {
        const pos = nextHidden.indexOf(activeId);
        if (pos === -1) return;
        nextHidden.splice(pos, 1);
      } else {
        const colIdx = nextColumns.findIndex((c) => c.id === from);
        if (colIdx === -1) return;
        const pos = nextColumns[colIdx].widgets.indexOf(activeId);
        if (pos === -1) return;
        nextColumns[colIdx].widgets.splice(pos, 1);
      }

      if (to === HIDDEN_CONTAINER_ID) {
        if (!nextHidden.includes(activeId)) nextHidden.push(activeId);
      } else {
        const colIdx = nextColumns.findIndex((c) => c.id === to);
        if (colIdx === -1) return;
        const targetWidgets = nextColumns[colIdx].widgets;
        let targetIdx: number;
        if (overId === to) {
          // Dropped onto the column itself (empty column or below all
          // widgets) — append.
          targetIdx = targetWidgets.length;
        } else {
          const overIdx = targetWidgets.indexOf(overId as WidgetId);
          if (overIdx === -1) {
            targetIdx = targetWidgets.length;
          } else {
            targetIdx = dropAfter ? overIdx + 1 : overIdx;
          }
        }
        targetWidgets.splice(targetIdx, 0, activeId);
      }

      updateLayout({ version: 1, columns: nextColumns, hidden: nextHidden });
    },
    [findContainer, layout, updateLayout],
  );

  const onDragCancel = React.useCallback(() => setActiveDragId(null), []);

  /**
   * Restore a hidden widget without dragging. Appends to the first column
   * with room (fewest widgets) so the user doesn't have to aim at a target.
   */
  const onRestore = React.useCallback(
    (id: WidgetId) => {
      if (!layout.hidden.includes(id)) return;
      const target = layout.columns
        .slice()
        .sort((a, b) => a.widgets.length - b.widgets.length)[0];
      if (!target) return;
      const next: DashboardLayout = {
        version: 1,
        columns: layout.columns.map((c) =>
          c.id === target.id ? { ...c, widgets: [...c.widgets, id] } : c,
        ),
        hidden: layout.hidden.filter((w) => w !== id),
      };
      updateLayout(next);
    },
    [layout, updateLayout],
  );

  const onHide = React.useCallback(
    (id: WidgetId) => {
      const next: DashboardLayout = {
        version: 1,
        columns: layout.columns.map((c) => ({
          id: c.id,
          widgets: c.widgets.filter((w) => w !== id),
        })),
        hidden: layout.hidden.includes(id)
          ? layout.hidden
          : [...layout.hidden, id],
      };
      updateLayout(next);
    },
    [layout, updateLayout],
  );
  // Build the registry context from props + the dispute slot state. We
  // intentionally cast the slot setter to (id: string | null) => void;
  // the local useState setter accepts that shape via the SetStateAction
  // identity overload.
  const ctx: DashboardContext = {
    merchantId: props.merchantId,
    merchantInfo: props.merchantInfo,
    effectiveBalance: props.effectiveBalance,
    todayEarnings: props.todayEarnings,
    isMerchantOnline: props.isMerchantOnline,
    setIsMerchantOnline: props.setIsMerchantOnline,
    walletStatus: props.walletStatus,
    onAddWallet: props.onAddWallet,
    lockedInEscrow,
    activeCorridor: props.activeCorridor,
    onCorridorChange: props.onCorridorChange,
    openTradeForm: props.openTradeForm,
    setOpenTradeForm: props.setOpenTradeForm,
    isCreatingTrade: props.isCreatingTrade,
    handleDirectOrderCreation: props.handleDirectOrderCreation,
    refreshBalance: props.refreshBalance,
    pendingOrders: props.pendingOrders,
    ongoingOrders: props.ongoingOrders,
    completedOrders: props.completedOrders,
    cancelledOrders: props.cancelledOrders,
    mempoolOrders: props.mempoolOrders,
    leaderboardData: props.leaderboardData,
    setSelectedOrderPopup: props.setSelectedOrderPopup,
    setSelectedMempoolOrder: props.setSelectedMempoolOrder,
    setSelectedOrderId: props.setSelectedOrderId,
    acceptOrder: props.acceptOrder,
    acceptingOrderId: props.acceptingOrderId,
    lockingEscrowOrderId: props.lockingEscrowOrderId,
    confirmingOrderId: props.confirmingOrderId,
    markingDone: props.markingDone,
    cancellingOrderId: props.cancellingOrderId,
    handleCancelOrder: props.handleCancelOrder,
    handleOpenChat: props.handleOpenChat,
    handleOrderAction: props.handleOrderAction,
    fetchOrders: props.fetchOrders,
    loadMoreOrders: props.loadMoreOrders,
    hasMoreOrders: props.hasMoreOrders,
    isLoadingMore: props.isLoadingMore,
    openDisputeModal: props.openDisputeModal,
    setRatingModalData: props.setRatingModalData,
    inProgressCollapsed: props.inProgressCollapsed,
    setInProgressCollapsed: props.setInProgressCollapsed,
    completedCollapsed: props.completedCollapsed,
    setCompletedCollapsed: props.setCompletedCollapsed,
    activityCollapsed: props.activityCollapsed,
    setActivityCollapsed: props.setActivityCollapsed,
    leaderboardCollapsed: props.leaderboardCollapsed,
    setLeaderboardCollapsed: props.setLeaderboardCollapsed,
    leaderboardTab: props.leaderboardTab,
    setLeaderboardTab: props.setLeaderboardTab,
    notifications: props.notifications,
    markNotificationRead: props.markNotificationRead,
    orderConversations: props.orderConversations,
    totalUnread: props.totalUnread,
    isLoadingConversations: props.isLoadingConversations,
    activeOrderChat: props.activeOrderChat,
    onOpenOrderChat: props.onOpenOrderChat,
    onCloseOrderChat: props.onCloseOrderChat,
    onClearUnread: props.onClearUnread,
    onClearAllUnread: props.onClearAllUnread,
    playSound: props.playSound,
    onOpenPaymentMethods: props.onOpenPaymentMethods,
    onOpenSettings: props.onOpenSettings,
    onOpenSwap: props.onOpenSwap,
    onOpenSend: props.onOpenSend,
    onOpenDeposit: props.onOpenDeposit,
    activeDisputeOrderId,
    setActiveDisputeOrderId,
    activeDisputeUserName,
    setActiveDisputeUserName,
  };

  const sizes = DEFAULT_PANEL_SIZES.wide;
  // In edit mode keep empty columns visible as drop targets; otherwise
  // skip them so a hollow strip doesn't render its border-r for nothing.
  const renderedColumns = isEditing
    ? layout.columns
    : layout.columns.filter((c) => c.widgets.length > 0);

  return (
    <div className="hidden lg:flex lg:flex-col h-screen overflow-hidden">
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {isEditing && (
          <HiddenWidgetsTray
            hidden={layout.hidden}
            onRestore={onRestore}
            onResetToDefault={resetToDefault}
          />
        )}
        <PanelGroup
          orientation="horizontal"
          className="flex-1 overflow-hidden"
          key="wide-v2"
        >
          {renderedColumns.map((col, i) => {
            const size = sizes[col.id] ?? {
              defaultSize: "20%",
              minSize: "12%",
              maxSize: "40%",
            };
            const isLeft = col.id === "left";
            const isRight = col.id === "right";
            // Outer column chrome. The data columns wrap their widgets
            // in a vertical PanelGroup so the merchant can drag the
            // dividers to rebalance widget heights — that's where height-
            // resize actually matters (orders / leaderboard / activity
            // lists). The left column instead uses a flex stack with
            // `flex-1` on each card; that gives an even share of the
            // column height by flex distribution while letting the
            // widgets' own `h-full` flex layouts stretch their internal
            // content to fill the card — no empty card-coloured strip at
            // the bottom that reads as a "gap".
            const wrapperClass = isLeft
              ? "flex flex-col h-full bg-background border-r border-white/[0.05]"
              : isRight
                ? "flex flex-col h-full bg-background border-l border-white/[0.05]"
                : "flex flex-col h-full bg-background border-r border-white/[0.05]";
            const evenSize =
              col.widgets.length > 0
                ? `${Math.floor(100 / col.widgets.length)}%`
                : "100%";
            return (
              <Fragment key={col.id}>
                {i > 0 && (
                  <PanelResizeHandle
                    className={
                      isEditing
                        ? "w-[5px] bg-white/[0.06] hover:bg-white/[0.08] transition-colors cursor-col-resize"
                        : "w-px bg-white/[0.05] hover:bg-white/[0.08] hover:w-[3px] transition-all cursor-col-resize"
                    }
                  />
                )}
                <Panel
                  id={col.id}
                  defaultSize={size.defaultSize}
                  minSize={size.minSize}
                  maxSize={size.maxSize}
                >
                  <DroppableColumn
                    id={col.id}
                    className={wrapperClass}
                    isEditing={isEditing}
                  >
                    {col.widgets.length === 0 ? (
                      isEditing ? (
                        <div className="flex-1 flex items-center justify-center text-foreground/30 text-[11px] font-mono uppercase tracking-wider border border-dashed border-foreground/15 m-2 rounded-lg">
                          Drop a widget here
                        </div>
                      ) : null
                    ) : isLeft ? (
                      // Left column: flex stack inside inner padded wrapper so
                      // the PanelHeader sits flush at the top without the p-2
                      // bleed, while the cards below retain their gap+padding.
                      <div className="flex flex-col flex-1 p-2 gap-2 min-h-0">
                        <SortableContext
                          items={col.widgets}
                          strategy={verticalListSortingStrategy}
                        >
                          {col.widgets.map((wid) => {
                            const Widget = WIDGET_REGISTRY[wid];
                            return (
                              <div key={wid} className="min-h-0 rounded-xl overflow-hidden flex flex-col border border-white/[0.08] bg-white/[0.02] shadow-[0_2px_16px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]" style={{ flex: wid === "dashboardWidgets" ? 2 : 3 }}>
                                <CardLabel label={wid === "dashboardWidgets" ? "Balance" : "Trade"} live={wid === "dashboardWidgets"} />
                                <div className="flex-1 min-h-0 overflow-hidden">
                                  <WidgetShell
                                    id={wid}
                                    isEditing={isEditing}
                                    onHide={onHide}
                                    fillHeight={true}
                                  >
                                    <Widget ctx={ctx} />
                                  </WidgetShell>
                                </div>
                              </div>
                            );
                          })}
                        </SortableContext>
                      </div>
                    ) : (
                      <SortableContext
                        items={col.widgets}
                        strategy={verticalListSortingStrategy}
                      >
                        <PanelGroup
                          orientation="vertical"
                          className="flex-1 min-h-0"
                          key={col.widgets.join("|")}
                        >
                          {col.widgets.map((wid, wi) => {
                            const Widget = WIDGET_REGISTRY[wid];
                            return (
                              <Fragment key={wid}>
                                {wi > 0 && (
                                  // Resize handle. In edit mode it's
                                  // louder + taller so the merchant can
                                  // see where to grab to rebalance widget
                                  // heights; outside edit mode it stays
                                  // subtle (1 px line, brightens on
                                  // hover) so the dashboard reads clean.
                                  <PanelResizeHandle
                                    className={
                                      isEditing
                                        ? "h-[6px] bg-white/[0.06] hover:bg-white/[0.08] transition-colors cursor-row-resize"
                                        : "h-[2px] bg-foreground/[0.04] hover:bg-white/[0.08] transition-colors cursor-row-resize"
                                    }
                                  />
                                )}
                                <Panel
                                  id={`${col.id}/${wid}`}
                                  defaultSize={evenSize}
                                  minSize="5%"
                                >
                                  <WidgetShell
                                    id={wid}
                                    isEditing={isEditing}
                                    onHide={onHide}
                                  >
                                    <Widget ctx={ctx} />
                                  </WidgetShell>
                                </Panel>
                              </Fragment>
                            );
                          })}
                        </PanelGroup>
                      </SortableContext>
                    )}
                  </DroppableColumn>
                </Panel>
              </Fragment>
            );
          })}
        </PanelGroup>
        {/* Floating ghost of the dragged widget — escapes the panel's
              overflow:hidden so the drag visual is never clipped by a
              column or panel boundary. */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <div className="px-3 py-2 rounded-lg bg-foreground text-background text-[11px] font-bold uppercase tracking-wider shadow-2xl shadow-black/40">
              {WIDGET_LABELS[activeDragId]}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <AppDownloadSection />
    </div>
  );
}


function CardLabel({ label, live }: { label: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-2 h-7 px-3 shrink-0 border-b border-white/[0.06] bg-white/[0.015]">
      {live && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-40" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white/80 shadow-[0_0_6px_rgba(255,255,255,0.8)]" />
        </span>
      )}
      <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-white/35 select-none">
        {label}
      </span>
    </div>
  );
}


// Column wrapper that's also a dnd-kit droppable so cross-column drag
// (and drops onto empty columns) works without an inner sentinel widget.
function DroppableColumn({
  id,
  className,
  isEditing,
  children,
}: {
  id: ColumnId;
  className: string;
  isEditing: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !isEditing });
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${
        isEditing && isOver ? "ring-2 ring-white/20 ring-inset" : ""
      }`}
    >
      {children}
    </div>
  );
}
