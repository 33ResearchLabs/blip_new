"use client";

import React from "react";
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
import { useState } from "react";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import { DisputeChatView } from "@/components/merchant/DisputeChatView";

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
  handleCancelOrder: (order: Order) => void;
  handleOpenChat: (order: Order) => void;
  handleOrderAction: (order: any, action: string) => void;
  fetchOrders: () => Promise<void>;
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

  // Chat
  directChat: any;
  activeContactOrderStatus: string | undefined;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
}

export const MerchantDesktopLayout = React.memo(function MerchantDesktopLayout(props: MerchantDesktopLayoutProps) {
  const [activeDisputeOrderId, setActiveDisputeOrderId] = useState<string | null>(null);
  const [activeDisputeUserName, setActiveDisputeUserName] = useState('');
  const {
    isWideScreen,
    pendingOrders, ongoingOrders, completedOrders, cancelledOrders,
    mempoolOrders, leaderboardData,
    merchantId, merchantInfo, effectiveBalance, todayEarnings,
    isMerchantOnline, setIsMerchantOnline,
    openTradeForm, setOpenTradeForm, isCreatingTrade,
    handleDirectOrderCreation, refreshBalance,
    setSelectedOrderPopup, setSelectedMempoolOrder, setSelectedOrderId,
    acceptOrder, acceptingOrderId, handleCancelOrder, handleOpenChat,
    handleOrderAction, fetchOrders, openDisputeModal, setRatingModalData,
    inProgressCollapsed, setInProgressCollapsed,
    completedCollapsed, setCompletedCollapsed,
    activityCollapsed, setActivityCollapsed,
    leaderboardCollapsed, setLeaderboardCollapsed,
    leaderboardTab, setLeaderboardTab,
    notifications, markNotificationRead,
    directChat, activeContactOrderStatus, playSound,
  } = props;

  return (
    <div className="hidden md:flex md:flex-col h-screen overflow-hidden">
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
          <div className="flex flex-col h-full bg-background overflow-y-auto p-2 gap-2 scrollbar-thin scrollbar-thumb-white/10">
            <div
              className="glass-card rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.06]"
              style={{ minHeight: "220px" }}
            >
              <DashboardWidgets
                todayEarnings={todayEarnings}
                completedOrders={completedOrders.length}
                cancelledOrders={cancelledOrders.length}
                avgResponseMins={0}
                rank={12}
                balance={effectiveBalance || 0}
                lockedInEscrow={245.5}
                isOnline={isMerchantOnline}
                merchantId={merchantId || undefined}
                onToggleOnline={() => setIsMerchantOnline((prev) => !prev)}
                onOpenCorridor={() => window.open("/merchant/mempool", "_blank")}
              />
            </div>
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
        <Panel
          defaultSize={isWideScreen ? "24%" : "27%"}
          minSize="16%"
          maxSize={isWideScreen ? "35%" : "40%"}
          id="center-left"
        >
          <div className="flex flex-col h-full bg-background">
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
              />
            ) : (
              <>
                <div
                  style={{ height: "60%" }}
                  className="flex flex-col border-b border-white/[0.04]"
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
        <PanelResizeHandle className="w-[3px]" />
        <Panel
          defaultSize={isWideScreen ? "20%" : "27%"}
          minSize={isWideScreen ? "14%" : "18%"}
          maxSize={isWideScreen ? "32%" : "40%"}
          id="center-right"
        >
          <div className="flex flex-col h-full bg-background">
            <div
              className={`flex flex-col border-b border-white/[0.04] transition-all duration-200 ${inProgressCollapsed ? "" : "flex-1 min-h-0"}`}
            >
              <InProgressPanel
                orders={ongoingOrders}
                onSelectOrder={setSelectedOrderPopup}
                onAction={handleOrderAction}
                onOpenChat={handleOpenChat}
                onOpenDispute={(order) => openDisputeModal(order.id)}
                collapsed={inProgressCollapsed}
                onCollapseChange={setInProgressCollapsed}
              />
            </div>
            <div
              className={`flex flex-col border-b border-white/[0.04] transition-all duration-200 ${completedCollapsed ? "" : "flex-1 min-h-0"}`}
            >
              <CompletedOrdersPanel
                orders={completedOrders}
                onSelectOrder={setSelectedOrderPopup}
                collapsed={completedCollapsed}
                onCollapseChange={setCompletedCollapsed}
              />
            </div>
            {!isWideScreen && activityCollapsed && inProgressCollapsed && completedCollapsed && (
              <div className="flex-1" />
            )}
            {!isWideScreen && (
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
            )}
          </div>
        </Panel>
        {isWideScreen && (
          <>
            <PanelResizeHandle className="w-[3px]" />
            <Panel
              defaultSize="18%"
              minSize="12%"
              maxSize="30%"
              id="transactions"
            >
              <div className="flex flex-col h-full bg-background">
                <div
                  className={`flex flex-col border-b border-white/[0.04] transition-all duration-200 ${leaderboardCollapsed ? "" : "flex-1 min-h-0"}`}
                >
                  <LeaderboardPanel
                    leaderboardData={leaderboardData}
                    leaderboardTab={leaderboardTab}
                    setLeaderboardTab={setLeaderboardTab}
                    onCollapseChange={setLeaderboardCollapsed}
                  />
                </div>
                {activityCollapsed && leaderboardCollapsed && (
                  <div className="flex-1" />
                )}
                <div
                  className={`flex flex-col transition-all duration-200 ${activityCollapsed ? "" : "flex-1 min-h-0"}`}
                >
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
        <PanelResizeHandle className="w-[3px]" />
        <Panel
          defaultSize={isWideScreen ? "18%" : "22%"}
          minSize={isWideScreen ? "12%" : "15%"}
          maxSize={isWideScreen ? "30%" : "35%"}
          id="right"
        >
          <div className="flex flex-col h-full bg-background overflow-hidden">
            <NotificationsPanel
              notifications={notifications}
              onMarkRead={markNotificationRead}
              onSelectOrder={setSelectedOrderId}
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
              ) : directChat.activeContactId ? (
                <DirectChatView
                  contactName={directChat.activeContactName}
                  contactType={directChat.activeContactType}
                  messages={directChat.messages}
                  isLoading={directChat.isLoadingMessages}
                  onSendMessage={(text, imageUrl) => {
                    directChat.sendMessage(text, imageUrl);
                    playSound("send");
                  }}
                  onBack={() => directChat.closeChat()}
                  orderStatus={activeContactOrderStatus}
                />
              ) : (
                <MerchantChatTabs
                  merchantId={merchantId || ""}
                  conversations={directChat.conversations}
                  totalUnread={directChat.totalUnread}
                  isLoading={directChat.isLoadingConversations}
                  onOpenChat={(targetId, targetType, username) => {
                    directChat.addContact(targetId, targetType).then(() => {
                      directChat.openChat(targetId, targetType, username);
                    });
                  }}
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
