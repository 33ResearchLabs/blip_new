"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Shield,
  Lock,
  MessageCircle,
  Zap,
  Loader2,
  ExternalLink,
  Check,
} from "lucide-react";
import type { Order } from "@/types/merchant";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { getAuthoritativeStatus, computeMyRole } from "@/lib/orders/statusResolver";

export interface OrderDetailPopupProps {
  order: Order | null;
  onClose: () => void;
  onViewFullDetails: (orderId: string) => void;
  merchantId: string | null;
  isMockMode: boolean;
  cancelOrderWithoutEscrow: (orderId: string) => Promise<void>;
  acceptOrder: (order: Order) => Promise<void>;
  openEscrowModal: (order: Order) => void;
  markFiatPaymentSent: (order: Order) => Promise<void>;
  confirmPayment: (orderId: string) => Promise<void>;
  executeRelease: () => void;
  openReleaseModal: (order: Order) => void;
  handleOpenChat: (order: Order) => void;
  openDisputeModal: (orderId: string) => void;
  isAccepting: boolean;
  isCancellingOrder: boolean;
  isConfirmingPayment: boolean;
  isReleasingEscrow: boolean;
  isCompleting: boolean;
  markingDone: boolean;
}

export function OrderDetailPopup({
  order,
  onClose,
  onViewFullDetails,
  merchantId,
  // isMockMode is available via props but not used in the popup JSX currently
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isMockMode,
  cancelOrderWithoutEscrow,
  acceptOrder,
  openEscrowModal,
  markFiatPaymentSent,
  confirmPayment,
  // executeRelease and openReleaseModal are available via props but not used in the popup JSX currently
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  executeRelease,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  openReleaseModal,
  handleOpenChat,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  openDisputeModal,
  isAccepting,
  isCancellingOrder,
  isConfirmingPayment,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isReleasingEscrow,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isCompleting,
  markingDone,
}: OrderDetailPopupProps) {
  return (
    <AnimatePresence>
      {order && (
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
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-white/[0.03] rounded-2xl shadow-2xl border border-white/[0.08] overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl border border-white/[0.04]">
                  {order.emoji}
                </div>
                <div>
                  <p className="text-base font-semibold text-white">{order.user}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-white/40">
                      {order.orderType === 'buy' ? 'Selling' : 'Buying'} USDC
                    </p>
                    {order.myRole && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        order.myRole === 'buyer'
                          ? 'bg-blue-500/20 text-blue-400'
                          : order.myRole === 'seller'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {order.myRole === 'buyer' ? 'YOU BUY' : order.myRole === 'seller' ? 'YOU SELL' : 'OBSERVER'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Escrow Status */}
              {order.escrowTxHash && (
                <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-white">Escrow Secured</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href={getSolscanTxUrl(order.escrowTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-white/60 hover:text-white/80 transition-colors"
                    >
                      View TX <ExternalLink className="w-3 h-3" />
                    </a>
                    {order.escrowPda && (
                      <a
                        href={getBlipscanTradeUrl(order.escrowPda)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-orange-400/70 hover:text-orange-400 transition-colors"
                      >
                        BlipScan <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Order Details */}
              <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/40 uppercase tracking-wide">Amount</span>
                  <span className="text-sm font-semibold text-white">${order.amount.toLocaleString()} USDC</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/40 uppercase tracking-wide">Total Fiat</span>
                  <span className="text-sm font-semibold text-white">{'\u062F.\u0625'} {Math.round(order.total).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-white/[0.04]">
                  <span className="text-xs text-white/40 flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Rate (Locked)
                  </span>
                  <span className="text-xs font-mono text-white/50">1 USDC = {order.rate} AED</span>
                </div>
                {order.dbOrder?.accepted_at && (
                  <p className="text-[10px] text-white/25 text-right -mb-1">
                    Locked at {new Date(order.dbOrder.accepted_at).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Bank Account - Show to BUYER only (for M2M sell orders) */}
              {(() => {
                const popupBankRole = order.myRole || 'observer';
                const iAmBuyerInPopup = popupBankRole === 'buyer';

                if (iAmBuyerInPopup && order.userBankAccount) {
                  return (
                    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4">
                      <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Send AED to this account:</p>
                      <p className="text-sm font-mono text-white mb-1">{order.userBankAccount}</p>
                      <p className="text-xs text-white/40">Amount: {'\u062F.\u0625'} {Math.round(order.total).toLocaleString()}</p>
                    </div>
                  );
                }

                if (iAmBuyerInPopup && !order.userBankAccount) {
                  return (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                      <p className="text-xs text-red-400">No payment details provided. Chat to get bank details.</p>
                    </div>
                  );
                }

                return null;
              })()}

              {/* Status message for SELLER waiting for buyer */}
              {(() => {
                const popupSellerRole = order.myRole || 'observer';
                const popupStatus = order.dbOrder?.status;

                if (popupSellerRole === 'seller' && (popupStatus === 'escrowed' || popupStatus === 'accepted')) {
                  return (
                    <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                        <span className="text-xs">{'\u23F3'}</span>
                      </div>
                      <p className="text-xs text-white/50">Waiting for buyer to mark payment as sent...</p>
                    </div>
                  );
                }

                return null;
              })()}
            </div>

            {/* Actions */}
            <div className="px-5 pb-5 space-y-2">
              {/* Already taken banner -- show when order was accepted by someone else */}
              {(order.status as string) === 'accepted' && order.buyerMerchantId !== merchantId && order.orderMerchantId !== merchantId && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                  <span className="text-sm">{'\u26A1'}</span>
                  <p className="text-xs text-yellow-400 font-medium">This order was already taken by another merchant</p>
                </div>
              )}
              {/* Cancel button for order creator (before escrow lock) */}
              {(() => {
                const iAmOrderCreatorPopup = order.orderMerchantId === merchantId;
                const canCancelPopup = iAmOrderCreatorPopup &&
                  !order.escrowTxHash &&
                  (order.dbOrder?.status === 'pending' || order.dbOrder?.status === 'accepted');

                return canCancelPopup ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={async () => {
                      await cancelOrderWithoutEscrow(order.id);
                      onClose();
                    }}
                    disabled={isCancellingOrder}
                    className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/40 text-red-400 font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCancellingOrder ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Cancelling...
                      </>
                    ) : (
                      <>
                        <X className="w-4 h-4" />
                        Cancel Order
                      </>
                    )}
                  </motion.button>
                ) : null;
              })()}

              {/* For escrowed orders not yet accepted - show Go button */}
              {/* Covers: user SELL orders (type='sell') AND merchant pre-locked SELL orders (type='buy' due to inversion) */}
              {order.dbOrder?.status === 'escrowed' && !order.dbOrder?.accepted_at && !order.isMyOrder && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={async () => {
                    await acceptOrder(order);
                    onClose();
                  }}
                  disabled={isAccepting}
                  className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Go
                    </>
                  )}
                </motion.button>
              )}

              {/* For pending orders without escrow (regular flow) */}
              {order.status === 'pending' && !order.escrowTxHash && !order.isMyOrder && (
                <div className="space-y-2">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={async () => {
                      await acceptOrder(order);
                      onClose();
                    }}
                    disabled={isAccepting}
                    className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAccepting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Accepting...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Go
                      </>
                    )}
                  </motion.button>
                  {/* sAED corridor button removed -- not in this version */}
                </div>
              )}

              {/* For accepted orders without escrow -- only the SELLER locks escrow */}
              {(() => {
                const popupDbStatus = order.dbOrder?.status;
                if (popupDbStatus !== 'accepted' || order.escrowTxHash) return null;
                // Only seller locks escrow -- use myRole
                const popupEscrowRole = order.myRole || 'observer';
                if (popupEscrowRole !== 'seller') return null;
                return (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      openEscrowModal(order);
                      onClose();
                    }}
                    className="w-full py-3 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/40 text-orange-400 font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <Lock className="w-4 h-4" />
                    Lock Escrow
                  </motion.button>
                );
              })()}

              {/* For accepted/escrowed orders -- buyer needs to mark payment sent */}
              {(() => {
                const popupStatus = order.dbOrder?.status;
                const popupPayRole = order.myRole || 'observer';
                const canMarkPaidPopup = (popupStatus === 'accepted' || popupStatus === 'escrowed') && order.escrowTxHash && popupPayRole === 'buyer';

                if (canMarkPaidPopup) {
                  return (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={async () => {
                        await markFiatPaymentSent(order);
                        onClose();
                      }}
                      disabled={markingDone}
                      className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/6 hover:border-white/12 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                    >
                      {markingDone ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          I&apos;ve Paid
                        </>
                      )}
                    </motion.button>
                  );
                }
                return null;
              })()}

              {/* For payment_sent status -- seller confirms receipt and releases escrow */}
              {(() => {
                const minimalStatus = getAuthoritativeStatus(order);

                // Use computeMyRole for authoritative seller determination
                const popupRole = merchantId ? computeMyRole(order, merchantId) : 'observer';
                const canConfirmPayment = minimalStatus === 'payment_sent' && popupRole === 'seller';

                if (canConfirmPayment) {
                  return (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={async () => {
                        await confirmPayment(order.id);
                        onClose();
                      }}
                      disabled={isConfirmingPayment}
                      className="w-full py-3 rounded-xl bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/20 hover:border-orange-500/30 text-orange-400 font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConfirmingPayment ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Confirming...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          Confirm Receipt & Release Escrow
                        </>
                      )}
                    </motion.button>
                  );
                }
                return null;
              })()}

              <button
                onClick={() => {
                  onViewFullDetails(order.id);
                  onClose();
                }}
                className="w-full py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white text-sm font-medium flex items-center justify-center gap-2 border border-white/[0.04] transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View Full Details
              </button>

              <button
                onClick={() => {
                  handleOpenChat(order);
                  onClose();
                }}
                className="w-full py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white text-sm font-medium flex items-center justify-center gap-2 border border-white/[0.04] transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                Chat
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
