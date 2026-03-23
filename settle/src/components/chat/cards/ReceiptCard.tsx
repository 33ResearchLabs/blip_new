'use client';

import { Receipt, ArrowRightLeft, User, Store, Clock } from 'lucide-react';

interface ReceiptData {
  order_number?: string;
  order_type?: string;
  payment_method?: string;
  crypto_amount?: string | number;
  crypto_currency?: string;
  fiat_amount?: string | number;
  fiat_currency?: string;
  rate?: string | number;
  platform_fee?: string | number;
  creator_type?: string;
  creator_name?: string;
  acceptor_type?: string;
  acceptor_name?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

interface ReceiptCardProps {
  data: ReceiptData;
  currentStatus?: string;
}

function formatAmount(value: string | number | undefined, decimals = 2): string {
  if (value === undefined || value === null) return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDateTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  // DB status names
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending' },
  accepted: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Accepted' },
  escrow_pending: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Escrow Pending' },
  escrowed: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Escrowed' },
  payment_pending: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', label: 'Payment Pending' },
  payment_sent: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', label: 'Payment Sent' },
  payment_confirmed: { bg: 'bg-teal-500/20', text: 'text-teal-400', label: 'Payment Confirmed' },
  releasing: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Releasing' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Completed' },
  cancelled: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Cancelled' },
  disputed: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Disputed' },
  expired: { bg: 'bg-zinc-500/20', text: 'text-zinc-400', label: 'Expired' },
  // UI-mapped aliases (user side: mapDbStatusToUI)
  payment: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Escrowed' },
  waiting: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', label: 'Payment Sent' },
  complete: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Completed' },
  // UI-mapped aliases (merchant side: mapDbOrderToUI)
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Accepted' },
  escrow: { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Escrowed' },
};

export function ReceiptCard({ data, currentStatus }: ReceiptCardProps) {
  const isBuy = data.order_type === 'buy';
  const effectiveStatus = currentStatus || data.status || '';
  const statusStyle = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.pending;
  const isCompleted = effectiveStatus === 'completed';
  const isCancelled = effectiveStatus === 'cancelled';

  return (
    <div className="bg-white/5 border border-white/6 rounded-xl overflow-hidden">
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isCompleted ? 'bg-emerald-500/10 border-emerald-500/20' :
        isCancelled ? 'bg-red-500/10 border-red-500/20' :
        'bg-white/[0.02] border-white/[0.06]'
      }`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/6 flex items-center justify-center">
            <Receipt className="w-4 h-4 text-white/70" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-white">
              Receipt #{data.order_number}
            </h4>
            <p className="text-xs text-white/50">
              {isBuy ? 'Buy' : 'Sell'} Order
              {data.payment_method && ` via ${data.payment_method}`}
            </p>
          </div>
        </div>
        {/* Status badge */}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
          {statusStyle.label}
        </span>
      </div>

      {/* Parties */}
      <div className="px-4 py-3 border-b border-white/[0.04] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {data.creator_type === 'merchant' ? (
              <Store className="w-3.5 h-3.5 text-white/40" />
            ) : (
              <User className="w-3.5 h-3.5 text-white/40" />
            )}
            <span className="text-xs text-white/50">From</span>
          </div>
          <span className="text-sm text-white">{data.creator_name || 'Unknown'}</span>
        </div>
        <div className="flex items-center justify-center">
          <ArrowRightLeft className="w-3 h-3 text-white/20" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {data.acceptor_type === 'merchant' ? (
              <Store className="w-3.5 h-3.5 text-white/40" />
            ) : (
              <User className="w-3.5 h-3.5 text-white/40" />
            )}
            <span className="text-xs text-white/50">To</span>
          </div>
          <span className="text-sm text-white">{data.acceptor_name || 'Unknown'}</span>
        </div>
      </div>

      {/* Amounts */}
      <div className="px-4 py-3 space-y-2.5 border-b border-white/[0.04]">
        <div className="flex justify-between items-center">
          <span className="text-xs text-white/50">Crypto</span>
          <span className="text-sm text-white font-medium">
            {formatAmount(data.crypto_amount, 6)} {data.crypto_currency || 'USDC'}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-white/50">Fiat</span>
          <span className="text-sm text-white font-medium">
            {formatAmount(data.fiat_amount)} {data.fiat_currency || ''}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs text-white/50">Rate</span>
          <span className="text-sm text-white/70">
            {formatAmount(data.rate, 4)}
          </span>
        </div>

        {data.platform_fee != null && parseFloat(String(data.platform_fee)) > 0 && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/50">Fee</span>
            <span className="text-sm text-white/70">
              {formatAmount(data.platform_fee, 6)} {data.crypto_currency || 'USDC'}
            </span>
          </div>
        )}
      </div>

      {/* Timestamps */}
      {(data.created_at || data.updated_at) && (
        <div className="px-4 py-2.5 flex items-center gap-4">
          <Clock className="w-3 h-3 text-white/30" />
          {data.created_at && (
            <div>
              <span className="text-[10px] text-white/30">Created </span>
              <span className="text-[10px] text-white/50">{formatDateTime(data.created_at)}</span>
            </div>
          )}
          {data.updated_at && data.updated_at !== data.created_at && (
            <div>
              <span className="text-[10px] text-white/30">Updated </span>
              <span className="text-[10px] text-white/50">{formatDateTime(data.updated_at)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReceiptCard;
