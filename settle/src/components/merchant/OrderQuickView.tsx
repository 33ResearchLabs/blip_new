"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Shield,
  Lock,
  MessageCircle,
  Zap,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { getAuthoritativeStatus, computeMyRole } from "@/lib/orders/statusResolver";
import type { Order } from "@/types/merchant";

export interface OrderQuickViewProps {
  selectedOrder: Order | null;
  merchantId: string | null;
  markingDone: boolean;
  acceptingOrderId?: string | null;
  confirmingOrderId?: string | null;
  cancellingOrderId?: string | null;
  onClose: () => void;
  onAcceptOrder: (order: Order) => void;
  onOpenEscrowModal: (order: Order) => void;
  onMarkFiatPaymentSent: (order: Order) => void;
  onConfirmPayment: (orderId: string) => Promise<void>;
  onCancelOrderWithoutEscrow: (orderId: string) => Promise<void>;
  onOpenChat: (order: Order) => void;
  onViewFullDetails: (orderId: string) => void;
}

export function OrderQuickView({
  selectedOrder,
  merchantId,
  markingDone,
  acceptingOrderId,
  confirmingOrderId,
  cancellingOrderId,
  onClose,
  onAcceptOrder,
  onOpenEscrowModal,
  onMarkFiatPaymentSent,
  onConfirmPayment,
  onCancelOrderWithoutEscrow,
  onOpenChat,
  onViewFullDetails,
}: OrderQuickViewProps) {
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
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-white/[0.03] rounded-2xl shadow-2xl border border-white/[0.08] overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-2xl border border-white/[0.04]">
                  {selectedOrder.emoji}
                </div>
                <div>
                  <p className="text-base font-semibold text-white">{selectedOrder.user}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] text-white/40">
                      {selectedOrder.orderType === 'buy' ? 'Selling' : 'Buying'} USDC
                    </p>
                    {selectedOrder.myRole && (
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-medium ${
                        selectedOrder.myRole === 'buyer'
                          ? 'bg-blue-500/20 text-blue-400'
                          : selectedOrder.myRole === 'seller'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {selectedOrder.myRole === 'buyer' ? 'YOU RECEIVE' : selectedOrder.myRole === 'seller' ? 'YOU SEND' : 'OBSERVER'}
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
              {selectedOrder.escrowTxHash && (
                <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                      <Shield className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-white">Escrow Secured</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <a
                      href={getSolscanTxUrl(selectedOrder.escrowTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-white/60 hover:text-white/80 transition-colors"
                    >
                      View TX <ExternalLink className="w-3 h-3" />
                    </a>
                    {selectedOrder.escrowPda && (
                      <a
                        href={getBlipscanTradeUrl(selectedOrder.escrowPda)}
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
                  <span className="text-sm font-semibold text-white">${selectedOrder.amount.toLocaleString()} USDC</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-white/40 uppercase tracking-wide">Total Fiat</span>
                  <span className="text-sm font-semibold text-white">{'\u062F.\u0625'} {Math.round(selectedOrder.total).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-white/[0.04]">
                  <span className="text-xs text-white/40 flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Rate (Locked)
                  </span>
                  <span className="text-xs font-mono text-white/50">1 USDC = {selectedOrder.rate} AED</span>
                </div>
                {selectedOrder.dbOrder?.accepted_at && (
                  <p className="text-[10px] text-white/25 text-right -mb-1">
                    Locked at {new Date(selectedOrder.dbOrder.accepted_at).toLocaleString()}
                  </p>
                )}
              </div>

              {/* Bank Account - Show to BUYER only */}
              {(() => {
                const popupBankRole = selectedOrder.myRole || 'observer';
                const iAmBuyerInPopup = popupBankRole === 'buyer';

                if (iAmBuyerInPopup && selectedOrder.userBankAccount) {
                  return (
                    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4">
                      <p className="text-xs text-white/40 uppercase tracking-wide mb-2">Send AED to this account:</p>
                      <p className="text-sm font-mono text-white mb-1">{selectedOrder.userBankAccount}</p>
                      <p className="text-xs text-white/40">Amount: {'\u062F.\u0625'} {Math.round(selectedOrder.total).toLocaleString()}</p>
                    </div>
                  );
                }

                if (iAmBuyerInPopup && !selectedOrder.userBankAccount) {
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
                const popupSellerRole = selectedOrder.myRole || 'observer';
                const popupStatus = selectedOrder.dbOrder?.status;
                const popupAccepted = !!selectedOrder.dbOrder?.accepted_at;

                if (popupSellerRole === 'seller' && (popupStatus === 'escrowed' || popupStatus === 'accepted')) {
                  return (
                    <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-white/[0.04] flex items-center justify-center shrink-0">
                        <span className="text-xs">{'\u231B'}</span>
                      </div>
                      <p className="text-xs text-white/50">
                        {popupAccepted
                          ? 'Waiting for buyer to mark payment as sent...'
                          : 'Escrow locked by user. Waiting for a merchant to accept...'}
                      </p>
                    </div>
                  );
                }

                return null;
              })()}
            </div>

            {/* Actions */}
            <div className="px-5 pb-5 space-y-2">
              {/* Cancel button for order creator (before escrow lock) */}
              {(() => {
                const iAmOrderCreatorPopup = selectedOrder.orderMerchantId === merchantId;
                const canCancelPopup = iAmOrderCreatorPopup &&
                  !selectedOrder.escrowTxHash &&
                  (selectedOrder.dbOrder?.status === 'pending' || selectedOrder.dbOrder?.status === 'accepted');

                return canCancelPopup ? (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    disabled={cancellingOrderId === selectedOrder.id}
                    onClick={async () => {
                      await onCancelOrderWithoutEscrow(selectedOrder.id);
                      onClose();
                    }}
                    className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                      cancellingOrderId === selectedOrder.id
                        ? 'bg-red-500/5 border-red-500/20 text-red-400/50 cursor-wait'
                        : 'bg-red-500/10 hover:bg-red-500/20 border-red-500/30 hover:border-red-500/40 text-red-400'
                    }`}
                  >
                    {cancellingOrderId === selectedOrder.id ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling...</>
                    ) : (
                      <><X className="w-4 h-4" /> Cancel Order</>
                    )}
                  </motion.button>
                ) : null;
              })()}

              {/* For escrowed orders not yet accepted - show Go button */}
              {/* Note: don't gate on isMyOrder — user-created orders assign merchant_id before acceptance */}
              {selectedOrder.dbOrder?.status === 'escrowed' && !selectedOrder.dbOrder?.accepted_at && (
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  disabled={acceptingOrderId === selectedOrder.id}
                  onClick={async () => {
                    await onAcceptOrder(selectedOrder);
                    onClose();
                  }}
                  className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                    acceptingOrderId === selectedOrder.id
                      ? 'bg-white/5 border-white/4 text-white/50 cursor-wait'
                      : 'bg-white/10 hover:bg-white/20 border-white/6 hover:border-white/12 text-white'
                  }`}
                >
                  {acceptingOrderId === selectedOrder.id ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Accepting...</>
                  ) : (
                    <><Zap className="w-4 h-4" /> Go</>
                  )}
                </motion.button>
              )}

              {/* For pending orders without escrow (regular flow) */}
              {selectedOrder.status === 'pending' && !selectedOrder.escrowTxHash && !selectedOrder.isMyOrder && (
                <div className="space-y-2">
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    disabled={acceptingOrderId === selectedOrder.id}
                    onClick={() => {
                      onAcceptOrder(selectedOrder);
                      onClose();
                    }}
                    className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                      acceptingOrderId === selectedOrder.id
                        ? 'bg-white/5 border-white/4 text-white/50 cursor-wait'
                        : 'bg-white/10 hover:bg-white/20 border-white/6 hover:border-white/12 text-white'
                    }`}
                  >
                    {acceptingOrderId === selectedOrder.id ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Accepting...</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Go</>
                    )}
                  </motion.button>
                </div>
              )}

              {/* For accepted orders without escrow -- only the SELLER locks escrow */}
              {(() => {
                const popupDbStatus = selectedOrder.dbOrder?.status;
                if (popupDbStatus !== 'accepted' || selectedOrder.escrowTxHash) return null;
                const popupEscrowRole = selectedOrder.myRole || 'observer';
                if (popupEscrowRole !== 'seller') return null;
                return (
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      onOpenEscrowModal(selectedOrder);
                      onClose();
                    }}
                    className="w-full py-3 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 hover:border-orange-500/40 text-orange-400 font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <Lock className="w-4 h-4" />
                    Lock Escrow
                  </motion.button>
                );
              })()}

              {/* For accepted/escrowed orders -- buyer needs to mark payment sent (only after merchant accepted) */}
              {(() => {
                const popupStatus = selectedOrder.dbOrder?.status;
                const popupPayRole = selectedOrder.myRole || 'observer';
                const hasBeenAccepted = !!selectedOrder.dbOrder?.accepted_at;
                const canMarkPaidPopup = (popupStatus === 'accepted' || (popupStatus === 'escrowed' && hasBeenAccepted)) && selectedOrder.escrowTxHash && popupPayRole === 'buyer';

                if (canMarkPaidPopup) {
                  return (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={async () => {
                        await onMarkFiatPaymentSent(selectedOrder);
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
                const minimalStatus = getAuthoritativeStatus(selectedOrder);
                const popupRole = merchantId ? computeMyRole(selectedOrder, merchantId) : 'observer';
                const canConfirmPaymentPopup = minimalStatus === 'payment_sent' && popupRole === 'seller';

                if (canConfirmPaymentPopup) {
                  return (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      disabled={confirmingOrderId === selectedOrder.id}
                      onClick={async () => {
                        await onConfirmPayment(selectedOrder.id);
                        onClose();
                      }}
                      className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                        confirmingOrderId === selectedOrder.id
                          ? 'bg-orange-500/5 border-orange-500/10 text-orange-400/50 cursor-wait'
                          : 'bg-orange-500/10 hover:bg-orange-500/15 border-orange-500/20 hover:border-orange-500/30 text-orange-400'
                      }`}
                    >
                      {confirmingOrderId === selectedOrder.id ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Accepting...</>
                      ) : (
                        <><Check className="w-4 h-4" /> Confirm Receipt & Release Escrow</>
                      )}
                    </motion.button>
                  );
                }
                return null;
              })()}

              <button
                onClick={() => {
                  onViewFullDetails(selectedOrder.id);
                  onClose();
                }}
                className="w-full py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white text-sm font-medium flex items-center justify-center gap-2 border border-white/[0.04] transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View Full Details
              </button>

              <button
                onClick={() => {
                  onOpenChat(selectedOrder);
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
