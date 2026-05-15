"use client";

import { useMemo } from "react";
import { Activity } from "lucide-react";
import type { Order } from "@/types/merchant";
import { useMerchantStore } from "@/stores/merchantStore";
import { MobileOrderCard } from "@/components/merchant/MobileOrderCard";

// Unified Orders feed. Replaces the old Pending + Escrow split with a
// single list of orders the merchant is involved in. Each row carries
// the contextual action button for its current state (Accept, Lock
// Escrow, Mark Payment Sent, Confirm Payment, Cancel, View Dispute),
// so the merchant never has to switch tabs as an order progresses
// through its lifecycle.
//
// Sort order: orders needing the merchant's own action come first, then
// orders waiting on the counterparty, then pending offers, then the
// merchant's own broadcast offers. Within each group, most recent first
// based on the order's expiry countdown (more time left = more recent).

export interface MobileOrdersTabProps {
  // Pending list (status: pending / open)
  pendingOrders: Order[];
  onAcceptOrder: (order: Order) => void;
  acceptingOrderId: string | null;
  onCancelOrder?: (order: Order) => void;
  cancellingOrderId?: string | null;

  // Active escrow list (status: accepted / escrowed / payment_sent / disputed)
  ongoingOrders: Order[];
  markingDone: boolean;
  onOpenEscrowModal: (order: Order) => void;
  onMarkFiatPaymentSent: (order: Order) => void;
  onConfirmPayment: (order: Order) => void;
  onOpenDisputeModal: (orderId: string) => void;
  onOpenCancelModal: (order: Order) => void;

  // Shared
  onOpenChat: (order: Order) => void;
  setMobileView: (view: "orders" | "escrow" | "chat" | "history" | "marketplace") => void;
}

// Lifecycle priority for the unified sort. Lower number → higher in
// the feed. The bands are intentionally coarse so reordering within a
// band (by recency) feels natural — escrow work the merchant must do
// always floats above passive waits and incoming offers.
function priority(order: Order): number {
  const status =
    order.dbOrder?.minimal_status || order.dbOrder?.status || order.status;
  const role = order.myRole;
  switch (status) {
    case "accepted":
      return role === "seller" && !order.escrowTxHash ? 0 : 3;
    case "escrowed":
    case "escrow":
      return role === "buyer" ? 0 : 3;
    case "payment_sent":
      return role === "seller" ? 0 : 3;
    case "disputed":
      return 1;
    case "pending":
    case "open":
      return order.isMyOrder ? 4 : 2;
    default:
      return 5;
  }
}

export function MobileOrdersTab({
  pendingOrders,
  onAcceptOrder,
  acceptingOrderId,
  onCancelOrder,
  cancellingOrderId,
  ongoingOrders,
  markingDone,
  onOpenEscrowModal,
  onMarkFiatPaymentSent,
  onConfirmPayment,
  onOpenDisputeModal,
  onOpenCancelModal,
  onOpenChat,
  setMobileView,
}: MobileOrdersTabProps) {
  const merchantId = useMerchantStore((s) => s.merchantId);

  const orders = useMemo(() => {
    const all = [...ongoingOrders, ...pendingOrders];
    return all.sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      // Within the same band, prefer the order closer to expiry — those
      // are the most time-sensitive.
      return a.expiresIn - b.expiresIn;
    });
  }, [pendingOrders, ongoingOrders]);

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-foreground/35">
        <Activity className="w-8 h-8 mb-2 opacity-20" />
        <p className="text-xs font-mono">Waiting for orders…</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-1">
      {orders.map((order) => (
        <MobileOrderCard
          key={order.id}
          order={order}
          merchantId={merchantId}
          acceptingOrderId={acceptingOrderId}
          cancellingOrderId={cancellingOrderId}
          markingDone={markingDone}
          onAccept={onAcceptOrder}
          onCancelPending={onCancelOrder}
          onLockEscrow={onOpenEscrowModal}
          onMarkPaymentSent={onMarkFiatPaymentSent}
          onConfirmPayment={onConfirmPayment}
          onOpenDispute={onOpenDisputeModal}
          onOpenCancel={onOpenCancelModal}
          onOpenChat={onOpenChat}
          setMobileView={setMobileView}
        />
      ))}
    </div>
  );
}
