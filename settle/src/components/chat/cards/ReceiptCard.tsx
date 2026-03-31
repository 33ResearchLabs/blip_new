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
  theme?: 'dark' | 'light';
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

export function ReceiptCard({ data, currentStatus, theme = 'dark' }: ReceiptCardProps) {
  const isBuy = data.order_type === 'buy';
  const effectiveStatus = currentStatus || data.status || '';
  const statusStyle = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.pending;
  const isCompleted = effectiveStatus === 'completed';
  const isCancelled = effectiveStatus === 'cancelled';
  const isExpired = effectiveStatus === 'expired';

  // Theme-aware color tokens
  const isLight = theme === 'light';
  const t = {
    card: isLight ? 'bg-white border border-black/[0.08]' : 'bg-white/5 border border-white/6',
    title: isLight ? 'text-black' : 'text-white',
    subtitle: isLight ? 'text-black/50' : 'text-white/50',
    label: isLight ? 'text-black/40' : 'text-white/50',
    value: isLight ? 'text-black' : 'text-white',
    valueDim: isLight ? 'text-black/60' : 'text-white/70',
    icon: isLight ? 'text-black/40' : 'text-white/40',
    iconDim: isLight ? 'text-black/20' : 'text-white/20',
    iconBg: isLight ? 'bg-black/5 border border-black/[0.08]' : 'bg-white/5 border border-white/6',
    divider: isLight ? 'border-black/[0.06]' : 'border-white/[0.04]',
    headerDefault: isLight ? 'bg-black/[0.02] border-black/[0.06]' : 'bg-white/[0.02] border-white/[0.06]',
    timestamp: isLight ? 'text-black/30' : 'text-white/30',
    timestampVal: isLight ? 'text-black/50' : 'text-white/50',
    receiptIcon: isLight ? 'text-black/60' : 'text-white/70',
  };

  return (
    <div className={`${t.card} rounded-xl overflow-hidden`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between ${
        isCompleted ? 'bg-emerald-500/10 border-emerald-500/20' :
        isCancelled ? 'bg-red-500/10 border-red-500/20' :
        isExpired ? 'bg-zinc-500/10 border-zinc-500/20' :
        t.headerDefault
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${t.iconBg} flex items-center justify-center`}>
            <Receipt className={`w-4 h-4 ${t.receiptIcon}`} />
          </div>
          <div>
            <h4 className={`text-[15px] font-bold ${t.title} font-mono tracking-tight`}>
              #{data.order_number}
            </h4>
            <p className={`text-[11px] ${t.subtitle}`}>
              {isBuy ? 'Buy' : 'Sell'} Order
              {data.payment_method && ` via ${data.payment_method}`}
            </p>
          </div>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${statusStyle.bg} ${statusStyle.text}`}>
          {statusStyle.label}
        </span>
      </div>

      {/* Parties */}
      <div className={`px-4 py-3 border-b ${t.divider} space-y-2`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {data.creator_type === 'merchant' ? (
              <Store className={`w-3.5 h-3.5 ${t.icon}`} />
            ) : (
              <User className={`w-3.5 h-3.5 ${t.icon}`} />
            )}
            <span className={`text-xs ${t.label}`}>From</span>
          </div>
          <span className={`text-sm ${t.value}`}>{data.creator_name || 'Unknown'}</span>
        </div>
        <div className="flex items-center justify-center">
          <ArrowRightLeft className={`w-3 h-3 ${t.iconDim}`} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {data.acceptor_type === 'merchant' ? (
              <Store className={`w-3.5 h-3.5 ${t.icon}`} />
            ) : (
              <User className={`w-3.5 h-3.5 ${t.icon}`} />
            )}
            <span className={`text-xs ${t.label}`}>To</span>
          </div>
          <span className={`text-sm ${t.value}`}>{data.acceptor_name || 'Unknown'}</span>
        </div>
      </div>

      {/* Amounts */}
      <div className={`px-4 py-3 space-y-2.5 border-b ${t.divider}`}>
        <div className="flex justify-between items-center">
          <span className={`text-xs ${t.label}`}>Crypto</span>
          <span className={`text-[15px] ${t.value} font-bold font-mono tabular-nums`}>
            {formatAmount(data.crypto_amount, 6)} {data.crypto_currency || 'USDC'}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className={`text-xs ${t.label}`}>Fiat</span>
          <span className="text-[15px] text-orange-500 font-bold font-mono tabular-nums">
            {formatAmount(data.fiat_amount)} {data.fiat_currency || ''}
          </span>
        </div>

        <div className="flex justify-between items-center">
          <span className={`text-xs ${t.label}`}>Rate</span>
          <span className={`text-sm ${t.valueDim} font-mono`}>
            {formatAmount(data.rate, 4)}
          </span>
        </div>

        {data.platform_fee != null && parseFloat(String(data.platform_fee)) > 0 && (
          <div className="flex justify-between items-center">
            <span className={`text-xs ${t.label}`}>Fee</span>
            <span className={`text-sm ${t.valueDim}`}>
              {formatAmount(data.platform_fee, 6)} {data.crypto_currency || 'USDC'}
            </span>
          </div>
        )}
      </div>

      {/* Timestamps */}
      {(data.created_at || data.updated_at) && (
        <div className="px-4 py-2.5 flex items-center gap-4">
          <Clock className={`w-3 h-3 ${t.timestamp}`} />
          {data.created_at && (
            <div>
              <span className={`text-[10px] ${t.timestamp}`}>Created </span>
              <span className={`text-[10px] ${t.timestampVal}`}>{formatDateTime(data.created_at)}</span>
            </div>
          )}
          {data.updated_at && data.updated_at !== data.created_at && (
            <div>
              <span className={`text-[10px] ${t.timestamp}`}>Updated </span>
              <span className={`text-[10px] ${t.timestampVal}`}>{formatDateTime(data.updated_at)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ReceiptCard;
