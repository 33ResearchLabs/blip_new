'use client';

/**
 * BackendOrderDetail - Fully backend-driven order detail view (hardened).
 *
 * RULES:
 * - NO computeMyRole() / NO deriveOrderUI() / NO manual status logic
 * - Renders ONLY what the backend sends
 * - primaryAction is ALWAYS present (never null)
 * - Error toast with auto-dismiss
 * - Re-fetches order on action failure
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  X, Clock, User, Building2, Copy, Check,
  MessageCircle, ArrowRight, AlertTriangle,
} from 'lucide-react';
import { OrderActionButtons } from './OrderActionButtons';
import { OrderStatusBadge } from './OrderStatusBadge';
import { useOrderActionDispatch } from '@/hooks/useOrderActionDispatch';
import type { BackendOrder, ActionType } from '@/types/backendOrder';

interface BackendOrderDetailProps {
  order: BackendOrder;
  actorId: string;
  actorType: 'user' | 'merchant';
  onOrderUpdated?: (order: BackendOrder) => void;
  onClose?: () => void;
  onOpenChat?: (orderId: string) => void;
  /** Called to re-fetch order from backend (e.g. after error) */
  onRefetch?: () => void;
  onEscrowAction?: (orderId: string, action: ActionType) => Promise<{
    tx_hash?: string;
    escrow_trade_id?: number;
    escrow_trade_pda?: string;
    escrow_pda?: string;
    escrow_creator_wallet?: string;
  } | null>;
}

export function BackendOrderDetail({
  order,
  actorId,
  actorType,
  onOrderUpdated,
  onClose,
  onOpenChat,
  onRefetch,
  onEscrowAction,
}: BackendOrderDetailProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss error after 8 seconds
  useEffect(() => {
    if (actionError) {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setActionError(null), 8000);
    }
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [actionError]);

  const { dispatch, isLoading } = useOrderActionDispatch({
    actorId,
    actorType,
    onSuccess: (response) => {
      setActionError(null);
      if (response.order) {
        onOrderUpdated?.(response.order);
      }
    },
    onError: (error) => {
      setActionError(error);
      // Re-fetch order on error so UI matches backend state
      onRefetch?.();
    },
    onSettled: () => {
      // Always re-fetch to ensure we have the latest state
      onRefetch?.();
    },
  });

  const handleAction = useCallback(async (orderId: string, action: ActionType) => {
    setActionError(null);

    // For LOCK_ESCROW, delegate to on-chain handler first
    if (action === 'LOCK_ESCROW' && onEscrowAction) {
      const escrowResult = await onEscrowAction(orderId, action);
      if (!escrowResult) return;

      await dispatch(orderId, action, {
        tx_hash: escrowResult.tx_hash,
        escrow_trade_id: escrowResult.escrow_trade_id,
        escrow_trade_pda: escrowResult.escrow_trade_pda,
        escrow_pda: escrowResult.escrow_pda,
        escrow_creator_wallet: escrowResult.escrow_creator_wallet,
      });
      return;
    }

    await dispatch(orderId, action);
  }, [dispatch, onEscrowAction]);

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const formatDate = (dateStr: string) => new Date(dateStr).toLocaleString();

  const formatAmount = (amount: number | string) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Countdown for expiry
  const expiresIn = order.expires_at
    ? Math.max(0, Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000))
    : null;
  const expiryMinutes = expiresIn !== null ? Math.floor(expiresIn / 60) : null;
  const expirySeconds = expiresIn !== null ? expiresIn % 60 : null;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <OrderStatusBadge status={order.status} statusLabel={order.statusLabel} />
          <span className="text-sm text-zinc-400">
            {order.order_number && `#${order.order_number}`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {order.showChat && onOpenChat && (
            <button
              onClick={() => onOpenChat(order.id)}
              className="relative p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              {(order.unread_count || 0) > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[10px] flex items-center justify-center">
                  {order.unread_count}
                </span>
              )}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Role indicator */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-400">Your role:</span>
          <span className={`font-medium ${
            order.my_role === 'buyer' ? 'text-blue-400' :
            order.my_role === 'seller' ? 'text-green-400' :
            'text-zinc-400'
          }`}>
            {order.my_role === 'buyer' ? 'Buyer (send fiat)' :
             order.my_role === 'seller' ? 'Seller (lock crypto)' :
             'Observer'}
          </span>
        </div>

        {/* Trade Summary */}
        <div className="bg-zinc-800/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">
              {order.type === 'buy' ? 'Buying' : 'Selling'}
            </span>
            <span className="text-lg font-bold">
              {formatAmount(order.crypto_amount)} USDC
            </span>
          </div>

          <div className="flex items-center justify-center">
            <ArrowRight className="w-4 h-4 text-zinc-500" />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">For</span>
            <span className="text-lg font-bold text-green-400">
              {formatAmount(order.fiat_amount)} AED
            </span>
          </div>

          <div className="flex items-center justify-between text-sm text-zinc-400">
            <span>Rate</span>
            <span>{formatAmount(order.rate)} AED/USDC</span>
          </div>

          <div className="flex items-center justify-between text-sm text-zinc-400">
            <span>Payment</span>
            <span className="capitalize">{order.payment_method}</span>
          </div>
        </div>

        {/* Next Step — always present */}
        <div className={`border rounded-lg p-3 ${
          order.isTerminal
            ? 'bg-zinc-800/30 border-zinc-700'
            : 'bg-blue-500/10 border-blue-500/20'
        }`}>
          <p className={`text-sm ${order.isTerminal ? 'text-zinc-400' : 'text-blue-300'}`}>
            {order.nextStepText}
          </p>
        </div>

        {/* Expiry countdown */}
        {expiresIn !== null && expiresIn > 0 && !order.isTerminal && (
          <div className="flex items-center gap-2 text-sm text-yellow-400">
            <Clock className="w-4 h-4" />
            <span>Expires in {expiryMinutes}:{String(expirySeconds).padStart(2, '0')}</span>
          </div>
        )}

        {/* Participants */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Participants</h3>

          {order.user && (
            <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/30">
              <User className="w-4 h-4 text-zinc-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {order.user.name || order.user.username || 'User'}
                </p>
                <p className="text-xs text-zinc-500">
                  {order.user.total_trades} trades
                  {order.user.rating ? ` | ${order.user.rating.toFixed(1)} rating` : ''}
                </p>
              </div>
            </div>
          )}

          {order.merchant && (
            <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/30">
              <Building2 className="w-4 h-4 text-zinc-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {order.merchant.display_name || order.merchant.business_name || 'Merchant'}
                </p>
                <p className="text-xs text-zinc-500">
                  {order.merchant.total_trades} trades
                  {order.merchant.rating ? ` | ${order.merchant.rating.toFixed(1)} rating` : ''}
                </p>
              </div>
            </div>
          )}

          {order.buyer_merchant && (
            <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-800/30">
              <Building2 className="w-4 h-4 text-purple-400" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {order.buyer_merchant.display_name || 'Counterparty Merchant'}
                </p>
                <p className="text-xs text-purple-400">M2M Trade</p>
              </div>
            </div>
          )}
        </div>

        {/* Payment Details */}
        {order.payment_details && order.payment_method === 'bank' && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {order.my_role === 'buyer' ? 'Send Payment To' : 'Payment Details'}
            </h3>
            <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
              {order.payment_details.bank_name && (
                <DetailRow label="Bank" value={order.payment_details.bank_name} />
              )}
              {order.payment_details.bank_account_name && (
                <DetailRow label="Account" value={order.payment_details.bank_account_name} />
              )}
              {order.payment_details.bank_iban && (
                <CopyableRow
                  label="IBAN"
                  value={order.payment_details.bank_iban}
                  copied={copiedField === 'iban'}
                  onCopy={() => copyToClipboard(order.payment_details!.bank_iban!, 'iban')}
                />
              )}
            </div>
          </div>
        )}

        {/* Locked Payment Method */}
        {order.locked_payment_method && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
              {order.my_role === 'seller' ? 'Buyer Receives Fiat At' : 'Your Payment Method'}
            </h3>
            <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
              <DetailRow label="Type" value={order.locked_payment_method.label} />
              {Object.entries(order.locked_payment_method.details).map(([key, value]) => (
                <DetailRow key={key} label={key.replace(/_/g, ' ')} value={value} />
              ))}
            </div>
          </div>
        )}

        {/* Escrow Details */}
        {order.escrow_tx_hash && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Escrow</h3>
            <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
              <CopyableRow
                label="TX Hash"
                value={`${order.escrow_tx_hash.slice(0, 8)}...${order.escrow_tx_hash.slice(-6)}`}
                fullValue={order.escrow_tx_hash}
                copied={copiedField === 'escrow_tx'}
                onCopy={() => copyToClipboard(order.escrow_tx_hash!, 'escrow_tx')}
              />
              {order.escrow_pda && (
                <CopyableRow
                  label="Escrow PDA"
                  value={`${order.escrow_pda.slice(0, 8)}...${order.escrow_pda.slice(-6)}`}
                  fullValue={order.escrow_pda}
                  copied={copiedField === 'escrow_pda'}
                  onCopy={() => copyToClipboard(order.escrow_pda!, 'escrow_pda')}
                />
              )}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Timeline</h3>
          <div className="bg-zinc-800/50 rounded-lg p-3 space-y-1">
            <DetailRow label="Created" value={formatDate(order.created_at)} />
          </div>
        </div>

        {/* Error toast */}
        {actionError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-400">{actionError}</p>
              <p className="text-xs text-red-400/60 mt-1">The order has been refreshed to reflect the current state.</p>
            </div>
            <button
              onClick={() => setActionError(null)}
              className="text-red-400/60 hover:text-red-400 flex-shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Action buttons - pinned to bottom */}
      {!order.isTerminal && (
        <div className="p-4 border-t border-zinc-800">
          <OrderActionButtons
            orderId={order.id}
            primaryAction={order.primaryAction}
            secondaryAction={order.secondaryAction}
            onAction={handleAction}
          />
        </div>
      )}
    </div>
  );
}

// ── Helper components ────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-400 capitalize">{label}</span>
      <span className="text-white font-medium">{value}</span>
    </div>
  );
}

function CopyableRow({
  label,
  value,
  fullValue,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  fullValue?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-400">{label}</span>
      <button
        onClick={onCopy}
        className="flex items-center gap-1 text-white hover:text-blue-400 transition-colors"
        title={fullValue || value}
      >
        <span className="font-mono">{value}</span>
        {copied ? (
          <Check className="w-3 h-3 text-green-400" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
    </div>
  );
}
