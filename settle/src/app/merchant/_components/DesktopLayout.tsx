"use client";

import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { DashboardWidgets } from "@/components/merchant/DashboardWidgets";
import { ConfigPanel } from "@/components/merchant/ConfigPanel";
import { PendingOrdersPanel } from "@/components/merchant/PendingOrdersPanel";
import { LeaderboardPanel } from "@/components/merchant/LeaderboardPanel";
import { InProgressPanel } from "@/components/merchant/InProgressPanel";
import { ActivityPanel } from "@/components/merchant/ActivityPanel";
import { CompletedOrdersPanel } from "@/components/merchant/CompletedOrdersPanel";
import { NotificationsPanel } from "@/components/merchant/NotificationsPanel";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import type { Order, Notification } from "@/types/merchant";

export interface DesktopLayoutProps {
  isWideScreen: boolean;
  todayEarnings: number;
  completedOrders: Order[];
  cancelledOrders: Order[];
  effectiveBalance: number | null;
  isMerchantOnline: boolean;
  merchantId: string | null;
  setIsMerchantOnline: React.Dispatch<React.SetStateAction<boolean>>;
  merchantInfo: any;
  openTradeForm: any;
  setOpenTradeForm: any;
  isCreatingTrade: boolean;
  handleDirectOrderCreation: (...args: any[]) => any;
  refreshBalance: () => void;
  pendingOrders: Order[];
  mempoolOrders: any[];
  setSelectedOrderPopup: (order: Order | null) => void;
  setSelectedMempoolOrder: (order: any) => void;
  handleCancelOrder: (order: Order) => void;
  handleOpenChat: (order: Order) => void;
  fetchOrders: () => void;
  leaderboardData: any[];
  leaderboardTab: "traders" | "rated" | "reputation";
  setLeaderboardTab: (tab: "traders" | "rated" | "reputation") => void;
  ongoingOrders: Order[];
  openDisputeModal: (orderId: string) => void;
  setRatingModalData: (data: { orderId: string; counterpartyName: string; counterpartyType: "user" | "merchant" } | null) => void;
  setSelectedOrderId: (orderId: string) => void;
  setActivityCollapsed: (collapsed: boolean) => void;
  leaderboardCollapsed: boolean;
  setLeaderboardCollapsed: (collapsed: boolean) => void;
  activityCollapsed: boolean;
  notifications: Notification[];
  markNotificationRead: (id: string) => void;
  directChat: any;
  playSound: (...args: any[]) => void;
}

export function DesktopLayout({
  isWideScreen,
  todayEarnings,
  completedOrders,
  cancelledOrders,
  effectiveBalance,
  isMerchantOnline,
  merchantId,
  setIsMerchantOnline,
  merchantInfo,
  openTradeForm,
  setOpenTradeForm,
  isCreatingTrade,
  handleDirectOrderCreation,
  refreshBalance,
  pendingOrders,
  mempoolOrders,
  setSelectedOrderPopup,
  setSelectedMempoolOrder,
  handleCancelOrder,
  handleOpenChat,
  fetchOrders,
  leaderboardData,
  leaderboardTab,
  setLeaderboardTab,
  ongoingOrders,
  openDisputeModal,
  setRatingModalData,
  setSelectedOrderId,
  setActivityCollapsed,
  leaderboardCollapsed,
  setLeaderboardCollapsed,
  activityCollapsed,
  notifications,
  markNotificationRead,
  directChat,
  playSound,
}: DesktopLayoutProps) {
  return (
      <div className="hidden md:flex md:flex-col h-screen overflow-hidden">
        {/* Main Resizable Grid */}
        <PanelGroup orientation="horizontal" className="flex-1 overflow-hidden" key={isWideScreen ? 'wide' : 'narrow'}>
        {/* LEFT: Balance Widget + Create Order Widget */}
        <Panel defaultSize={isWideScreen ? "20%" : "24%"} minSize={isWideScreen ? "14%" : "16%"} maxSize={isWideScreen ? "30%" : "35%"} id="left">
        <div className="flex flex-col h-full bg-[#060606] overflow-y-auto p-2 gap-2">
          {/* Widget 1: Balance */}
          <div className="glass-card rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.06]" style={{ height: '48%', minHeight: '260px' }}>
            <DashboardWidgets
              todayEarnings={todayEarnings}
              completedOrders={completedOrders.length}
              cancelledOrders={cancelledOrders.length}
              avgResponseMins={0}
              rank={12}
              balance={effectiveBalance || 0}
              lockedInEscrow={245.50}
              isOnline={isMerchantOnline}
              merchantId={merchantId || undefined}
              onToggleOnline={() => setIsMerchantOnline(prev => !prev)}
              onOpenCorridor={() => window.open('/merchant/mempool', '_blank')}
            />
          </div>

          {/* Widget 2: Create Order */}
          <div className="glass-card rounded-xl overflow-hidden flex-1 min-h-0 border border-white/[0.06]">
            <ConfigPanel
              merchantId={merchantId}
              merchantInfo={merchantInfo}
              effectiveBalance={effectiveBalance}
              openTradeForm={openTradeForm}
              setOpenTradeForm={setOpenTradeForm}
              isCreatingTrade={isCreatingTrade}
              onCreateOrder={handleDirectOrderCreation}
              refreshBalance={refreshBalance}
            />
          </div>
        </div>
        </Panel>

        <PanelResizeHandle className="w-[3px]" />

        {/* CENTER-LEFT: Pending Orders (+ Leaderboard on narrow screens) */}
        <Panel defaultSize={isWideScreen ? "24%" : "27%"} minSize="16%" maxSize={isWideScreen ? "35%" : "40%"} id="center-left">
        <div className="flex flex-col h-full bg-black">
          {isWideScreen ? (
            <PendingOrdersPanel
              orders={pendingOrders}
              mempoolOrders={mempoolOrders}
              merchantInfo={merchantInfo}
              onSelectOrder={setSelectedOrderPopup}
              onSelectMempoolOrder={setSelectedMempoolOrder}
              onCancelOrder={handleCancelOrder}
              onOpenChat={handleOpenChat}
              fetchOrders={fetchOrders}
            />
          ) : (
            <>
              <div style={{ height: '60%' }} className="flex flex-col border-b border-white/[0.04]">
                <PendingOrdersPanel
                  orders={pendingOrders}
                  mempoolOrders={mempoolOrders}
                  merchantInfo={merchantInfo}
                  onSelectOrder={setSelectedOrderPopup}
                  onSelectMempoolOrder={setSelectedMempoolOrder}
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

        <PanelResizeHandle className="w-[3px]" />

        {/* CENTER-RIGHT: In Progress + Completed (+ Activity on narrow screens) */}
        <Panel defaultSize={isWideScreen ? "20%" : "27%"} minSize={isWideScreen ? "14%" : "18%"} maxSize={isWideScreen ? "32%" : "40%"} id="center-right">
        <div className="flex flex-col h-full bg-black">
          <div style={{ height: '50%' }} className="flex flex-col border-b border-white/[0.04]">
            <InProgressPanel
              orders={ongoingOrders}
              onSelectOrder={setSelectedOrderPopup}
              onOpenChat={handleOpenChat}
              onOpenDispute={(order) => openDisputeModal(order.id)}
            />
          </div>
          <div style={{ height: '50%' }} className="flex flex-col border-b border-white/[0.04]">
            <CompletedOrdersPanel
              orders={completedOrders}
              onSelectOrder={setSelectedOrderPopup}
            />
          </div>
          {!isWideScreen && (
            <div className="flex-1 flex flex-col min-h-0">
              <ActivityPanel
                merchantId={merchantId}
                completedOrders={completedOrders}
                cancelledOrders={cancelledOrders}
                ongoingOrders={ongoingOrders}
                pendingOrders={pendingOrders}
                onRateOrder={(order) => {
                  const userName = order.user || 'User';
                  const counterpartyType = order.isM2M ? 'merchant' : 'user';
                  setRatingModalData({
                    orderId: order.id,
                    counterpartyName: userName,
                    counterpartyType,
                  });
                }}
                onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
                onCollapseChange={setActivityCollapsed}
              />
            </div>
          )}
        </div>
        </Panel>

        {/* 5th COLUMN: Leaderboard + Activity (wide screens only) */}
        {isWideScreen && (
          <>
            <PanelResizeHandle className="w-[3px]" />
            <Panel defaultSize="18%" minSize="12%" maxSize="30%" id="transactions">
            <div className="flex flex-col h-full bg-black overflow-hidden">
              <div className={`flex flex-col min-h-0 border-b border-white/[0.04] transition-all duration-200 ${leaderboardCollapsed ? 'flex-none' : 'flex-1 basis-0'}`}>
                <LeaderboardPanel
                  leaderboardData={leaderboardData}
                  leaderboardTab={leaderboardTab}
                  setLeaderboardTab={setLeaderboardTab}
                  onCollapseChange={setLeaderboardCollapsed}
                />
              </div>
              <div className={`flex flex-col min-h-0 transition-all duration-200 ${activityCollapsed ? 'flex-none' : 'flex-1 basis-0'}`}>
                <ActivityPanel
                  merchantId={merchantId}
                  completedOrders={completedOrders}
                  cancelledOrders={cancelledOrders}
                  ongoingOrders={ongoingOrders}
                  pendingOrders={pendingOrders}
                  onRateOrder={(order) => {
                    const userName = order.user || 'User';
                    const counterpartyType = order.isM2M ? 'merchant' : 'user';
                    setRatingModalData({
                      orderId: order.id,
                      counterpartyName: userName,
                      counterpartyType,
                    });
                  }}
                  onSelectOrder={(orderId) => setSelectedOrderId(orderId)}
                  onCollapseChange={setActivityCollapsed}
                />
              </div>
            </div>
            </Panel>
          </>
        )}

        <PanelResizeHandle className="w-[3px]" />

        {/* RIGHT SIDEBAR: Notifications (max 50%) + Chat (rest) */}
        <Panel defaultSize={isWideScreen ? "18%" : "22%"} minSize={isWideScreen ? "12%" : "15%"} maxSize={isWideScreen ? "30%" : "35%"} id="right">
        <div className="flex flex-col h-full bg-[#060606] overflow-hidden">
          {/* Notifications Panel - Top, max 50% of sidebar */}
          <NotificationsPanel
            notifications={notifications}
            onMarkRead={markNotificationRead}
            onSelectOrder={setSelectedOrderId}
          />

          {/* Chat Messages Panel - Bottom (takes remaining space) */}
          <div className="flex-1 flex flex-col min-h-0">
            {directChat.activeContactId ? (
              <DirectChatView
                contactName={directChat.activeContactName}
                contactType={directChat.activeContactType}
                messages={directChat.messages}
                isLoading={directChat.isLoadingMessages}
                onSendMessage={(text, imageUrl) => {
                  directChat.sendMessage(text, imageUrl);
                  playSound('send');
                }}
                onBack={() => directChat.closeChat()}
              />
            ) : (
              <MerchantChatTabs
                merchantId={merchantId || ''}
                conversations={directChat.conversations}
                totalUnread={directChat.totalUnread}
                isLoading={directChat.isLoadingConversations}
                onOpenChat={(targetId, targetType, username) => {
                  directChat.addContact(targetId, targetType).then(() => {
                    directChat.openChat(targetId, targetType, username);
                  });
                }}
              />
            )}
          </div>
        </div>
        </Panel>
        </PanelGroup>
      </div>
  );
}
