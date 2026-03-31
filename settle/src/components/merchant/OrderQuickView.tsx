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
// Backend-driven: action buttons read from dbOrder.primaryAction/secondaryAction
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
        <Lock className="w-3.5 h-3.5 text-primary" />
        <span className="text-[11px] text-primary uppercase tracking-wide font-bold">Send AED Here</span>
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
  isRequestingCancel?: boolean;
  onClose: () => void;
  onAcceptOrder: (order: Order) => void;
  onOpenEscrowModal: (order: Order) => void;
  onMarkFiatPaymentSent: (order: Order) => void;
  onConfirmPayment: (orderId: string) => Promise<void>;
  onCancelOrderWithoutEscrow: (orderId: string) => void;
  onRespondToCancel?: (orderId: string, accept: boolean) => void;
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
  isRequestingCancel,
  onClose,
  onAcceptOrder,
  onOpenEscrowModal,
  onMarkFiatPaymentSent,
  onConfirmPayment,
  onCancelOrderWithoutEscrow,
  onRespondToCancel,
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
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[90%] max-w-md bg-card-solid rounded-2xl shadow-2xl border border-white/[0.08] overflow-hidden"
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
                        className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary transition-colors"
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
                  const detailStr = typeof spm.details === 'string' ? spm.details : JSON.stringify(spm.details);
                  return (
                    <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2 text-xs text-zinc-400 uppercase tracking-wide">
                        {typeIcon}
                        <span>Seller&apos;s Payment Method</span>
                      </div>
                      <div className="text-sm text-white font-medium">{spm.name}</div>
                      <div className="text-xs text-zinc-400">{detailStr}</div>
                      <div className="text-right text-sm font-semibold text-green-400">{Math.round(selectedOrder.total)} د.إ</div>
                    </div>
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

            {/* Cancel Request Banner — shown when counterparty requested cancellation */}
            {(() => {
              if (!selectedOrder.cancelRequestedBy && !selectedOrder.dbOrder?.cancel_requested_by) return null;

              const cancelBy = selectedOrder.cancelRequestedBy || selectedOrder.dbOrder?.cancel_requested_by;
              const cancelReason = selectedOrder.cancelRequestReason || selectedOrder.dbOrder?.cancel_request_reason;

              // Determine if counterparty requested (I need to respond) or I requested (waiting)
              const dbUsername = selectedOrder.dbOrder?.user?.username || '';
              const isPlaceholderUser = dbUsername.startsWith('open_order_') || dbUsername.startsWith('m2m_');
              const iRequestedIt = isPlaceholderUser
                ? cancelBy === 'merchant' && selectedOrder.orderMerchantId === merchantId
                : cancelBy === 'merchant';
              const counterpartyRequested = !iRequestedIt;

              if (counterpartyRequested) {
                return (
                  <div className="mx-5 mb-2 rounded-xl border border-primary/30 bg-primary/[0.06] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <X className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-primary">
                        Cancel Requested by {cancelBy === 'user' ? 'User' : 'Merchant'}
                      </span>
                    </div>
                    {cancelReason && (
                      <p className="text-xs text-white/50 mb-3">{cancelReason}</p>
                    )}
                    <div className="flex gap-2">
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={isRequestingCancel}
                        onClick={() => {
                          onRespondToCancel?.(selectedOrder.id, true);
                          onClose();
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary text-sm font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        {isRequestingCancel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Agree to Cancel
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={isRequestingCancel}
                        onClick={() => {
                          onRespondToCancel?.(selectedOrder.id, false);
                          onClose();
                        }}
                        className="flex-1 py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/70 text-sm font-medium flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
                      >
                        Continue Order
                      </motion.button>
                    </div>
                  </div>
                );
              }

              // I requested — show waiting status
              return (
                <div className="mx-5 mb-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-primary">Cancel Request Sent</p>
                    <p className="text-xs text-white/40">Waiting for counterparty to approve</p>
                  </div>
                </div>
              );
            })()}

            {/* Actions — Backend-driven: only show what enrichOrderResponse allows */}
            <div className="px-5 pb-5 space-y-2">
              {(() => {
                // Read backend-computed actions (source of truth)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const enriched = selectedOrder.dbOrder as any;
                const primary = enriched?.primaryAction;
                const secondary = enriched?.secondaryAction;

                // Guard: don't render action buttons until backend data is loaded
                if (!primary) return null;

                // Map backend action type → frontend handler
                const ACTION_HANDLER: Record<string, () => void> = {
                  ACCEPT: () => { onAcceptOrder(selectedOrder); onClose(); },
                  CLAIM: () => { onAcceptOrder(selectedOrder); onClose(); },
                  LOCK_ESCROW: () => { onOpenEscrowModal(selectedOrder); onClose(); },
                  SEND_PAYMENT: () => { onMarkFiatPaymentSent(selectedOrder); onClose(); },
                  CONFIRM_PAYMENT: () => { onConfirmPayment(selectedOrder.id).then(onClose); },
                  CANCEL: () => { onCancelOrderWithoutEscrow(selectedOrder.id); onClose(); },
                  DISPUTE: () => { onViewFullDetails(selectedOrder.id); onClose(); },
                };

                // Loading state per action type
                const isActionLoading = (type: string | null) => {
                  if (!type) return false;
                  if (type === 'ACCEPT' || type === 'CLAIM') return acceptingOrderId === selectedOrder.id;
                  if (type === 'CONFIRM_PAYMENT') return confirmingOrderId === selectedOrder.id;
                  if (type === 'CANCEL') return cancellingOrderId === selectedOrder.id;
                  if (type === 'SEND_PAYMENT') return markingDone;
                  return false;
                };

                // Action button styles
                const PRIMARY_STYLE = 'bg-primary/10 hover:bg-primary/20 border-primary/30 hover:border-primary/40 text-primary';
                const PRIMARY_LOADING = 'bg-primary/5 border-primary/10 text-primary/50 cursor-wait';
                const SECONDARY_STYLE = 'bg-red-500/10 hover:bg-red-500/20 border-red-500/30 hover:border-red-500/40 text-red-400';
                const DISABLED_STYLE = 'bg-white/[0.04] border-white/[0.06] text-white/40 cursor-not-allowed';

                const loading = isActionLoading(primary.type);

                return (
                  <>
                    {/* Primary Action — from backend */}
                    {primary.type && primary.enabled ? (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={loading}
                        onClick={() => ACTION_HANDLER[primary.type!]?.()}
                        className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                          loading ? PRIMARY_LOADING : PRIMARY_STYLE
                        }`}
                      >
                        {loading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Zap className="w-4 h-4" />
                        )}
                        {primary.label}
                      </motion.button>
                    ) : primary.label && primary.disabledReason && !primary.disabledReason.includes('No actions available') ? (
                      /* Disabled informational button (e.g., "Waiting for Payment") — hidden for terminal states */
                      <div className={`w-full py-3 rounded-xl border font-medium flex items-center justify-center gap-2 text-sm ${DISABLED_STYLE}`}
                        title={primary.disabledReason}
                      >
                        <Loader2 className="w-4 h-4 animate-spin opacity-40" />
                        {primary.label}
                      </div>
                    ) : null}

                    {/* Secondary Action — from backend (CANCEL or DISPUTE) */}
                    {secondary?.type && (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        disabled={isActionLoading(secondary.type)}
                        onClick={() => ACTION_HANDLER[secondary.type!]?.()}
                        className={`w-full py-3 rounded-xl border font-semibold flex items-center justify-center gap-2 transition-all ${
                          isActionLoading(secondary.type) ? PRIMARY_LOADING : SECONDARY_STYLE
                        }`}
                      >
                        {isActionLoading(secondary.type) ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                        {secondary.label}
                      </motion.button>
                    )}
                  </>
                );
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
