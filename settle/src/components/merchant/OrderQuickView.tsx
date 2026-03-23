"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  Shield,
  Lock,
  MessageCircle,
  Smartphone,
  Building2,
  CreditCard,
  Zap,
  ExternalLink,
  Loader2,
  Copy,
} from "lucide-react";
import { useState as useLocalState } from "react";
import { getSolscanTxUrl, getBlipscanTradeUrl } from "@/lib/explorer";
import { getAuthoritativeStatus, computeMyRole } from "@/lib/orders/statusResolver";
import type { Order } from "@/types/merchant";
import { CopyableBankDetails } from "@/components/shared/CopyableBankDetails";

// Inline component for non-bank locked payment methods (UPI, Cash, Other)
function LockedPaymentMethodCard({
  lpm,
  amount,
  typeIcon,
}: {
  lpm: { type: string; label: string; details: Record<string, string> };
  amount: number;
  typeIcon: React.ReactNode;
}) {
  const [copiedKey, setCopiedKey] = useLocalState<string | null>(null);
  const copyField = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const fields: { label: string; value: string; key: string; mono?: boolean }[] = [];
  if (lpm.type === 'upi') {
    if (lpm.details.upi_id) fields.push({ label: 'UPI ID', value: lpm.details.upi_id, key: 'upi_id', mono: true });
    if (lpm.details.provider) fields.push({ label: 'Provider', value: lpm.details.provider, key: 'provider' });
  } else if (lpm.type === 'cash') {
    if (lpm.details.location_name) fields.push({ label: 'Location', value: lpm.details.location_name, key: 'location' });
    if (lpm.details.location_address) fields.push({ label: 'Address', value: lpm.details.location_address, key: 'address' });
    if (lpm.details.meeting_instructions) fields.push({ label: 'Instructions', value: lpm.details.meeting_instructions, key: 'instructions' });
  } else {
    if (lpm.details.method_name) fields.push({ label: 'Method', value: lpm.details.method_name, key: 'method' });
    if (lpm.details.account_identifier) fields.push({ label: 'Account', value: lpm.details.account_identifier, key: 'account', mono: true });
    if (lpm.details.instructions) fields.push({ label: 'Instructions', value: lpm.details.instructions, key: 'instructions' });
  }

  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-[11px] text-orange-400 uppercase tracking-wide font-bold">Send AED Here</span>
      </div>
      <div className="flex items-center gap-2">
        {typeIcon}
        <span className="text-sm text-white font-medium">{lpm.label}</span>
        <span className="text-[10px] text-white/30 uppercase">{lpm.type}</span>
      </div>
      {fields.map(({ label, value, key, mono }) => (
        <div key={key} className="flex justify-between items-center">
          <span className="text-white/50 text-sm">{label}</span>
          <button
            onClick={() => copyField(value, key)}
            className="flex items-center gap-1 text-white hover:text-white/70 transition-colors"
          >
            <span className={`text-sm ${mono ? 'font-mono' : ''}`}>{value}</span>
            {copiedKey === key ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-white/30" />}
          </button>
        </div>
      ))}
      <div className="flex justify-between items-center pt-2 border-t border-white/[0.04]">
        <span className="text-white/50 text-sm">Amount</span>
        <span className="text-base font-semibold text-white">{'\u062F.\u0625'} {amount.toLocaleString()}</span>
      </div>
    </div>
  );
}

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
  onCancelOrderWithoutEscrow: (orderId: string) => void;
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

              {/* Payment Method - Show to BUYER (fiat sender) only */}
              {(() => {
                const popupBankRole = selectedOrder.myRole || 'observer';
                const iAmBuyerInPopup = popupBankRole === 'buyer';
                if (!iAmBuyerInPopup) return null;

                // Priority 1: Seller's merchant payment method (explicitly added by seller)
                if (selectedOrder.sellerPaymentMethod) {
                  const spm = selectedOrder.sellerPaymentMethod;
                  const typeIcon = spm.type === 'upi' ? <Smartphone className="w-4 h-4 text-green-400" />
                    : spm.type === 'bank' ? <Building2 className="w-4 h-4 text-blue-400" />
                    : <CreditCard className="w-4 h-4 text-purple-400" />;

                  if (spm.type === 'bank' && spm.details && typeof spm.details === 'object') {
                    return (
                      <CopyableBankDetails
                        title="Send AED to this account"
                        bankName={spm.details.bank_name}
                        accountName={spm.details.account_name}
                        iban={spm.details.iban}
                        amount={Math.round(selectedOrder.total)}
                      />
                    );
                  }

                  // Card / UPI / Cash / Other
                  return (
                    <LockedPaymentMethodCard
                      lpm={spm}
                      amount={Math.round(selectedOrder.total)}
                      typeIcon={typeIcon}
                    />
                  );
                }

                // Priority 2: Locked payment method (user payment method system)
                if (selectedOrder.lockedPaymentMethod) {
                  const lpm = selectedOrder.lockedPaymentMethod;
                  const typeIcon = lpm.type === 'upi' ? <Smartphone className="w-4 h-4 text-green-400" />
                    : lpm.type === 'bank' ? <Building2 className="w-4 h-4 text-blue-400" />
                    : <CreditCard className="w-4 h-4 text-purple-400" />;

                  if (lpm.type === 'bank') {
                    return (
                      <CopyableBankDetails
                        title={`Send AED to this account`}
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
                    />
                  );
                }

                // Priority 3: Seller bank details from offer (legacy)
                if (selectedOrder.sellerBankDetails) {
                  return (
                    <CopyableBankDetails
                      title="Send AED to this account"
                      bankName={selectedOrder.sellerBankDetails.bank_name}
                      accountName={selectedOrder.sellerBankDetails.account_name}
                      iban={selectedOrder.sellerBankDetails.iban}
                      amount={Math.round(selectedOrder.total)}
                    />
                  );
                }

                // Priority 3: User bank details from payment_details (legacy)
                if (selectedOrder.userBankDetails || selectedOrder.userBankAccount) {
                  const details = selectedOrder.userBankDetails;
                  return (
                    <CopyableBankDetails
                      title="Send AED to this account"
                      bankName={details?.bank_name}
                      accountName={details?.account_name}
                      iban={details?.iban}
                      fallbackText={!details ? selectedOrder.userBankAccount : undefined}
                      amount={Math.round(selectedOrder.total)}
                    />
                  );
                }

                return (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                    <p className="text-xs text-red-400">No payment details provided. Chat to get bank details.</p>
                  </div>
                );
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
