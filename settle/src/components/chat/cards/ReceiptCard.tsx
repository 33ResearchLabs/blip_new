'use client';

import { ArrowRightLeft } from 'lucide-react';
import { formatCrypto, formatRate } from '@/lib/format';

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

function formatAmount(value: string | number | undefined): string {
  if (value === undefined || value === null) return formatCrypto(0);
  return formatCrypto(value);
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  pending:          { dot: 'bg-yellow-400',  label: 'Pending' },
  accepted:         { dot: 'bg-emerald-400', label: 'Accepted' },
  escrowed:         { dot: 'bg-purple-400',  label: 'Escrowed' },
  escrow_pending:   { dot: 'bg-purple-400',  label: 'Escrowed' },
  payment_pending:  { dot: 'bg-cyan-400',    label: 'Payment Pending' },
  payment_sent:     { dot: 'bg-cyan-400',    label: 'Payment Sent' },
  payment_confirmed:{ dot: 'bg-teal-400',    label: 'Confirmed' },
  releasing:        { dot: 'bg-emerald-400', label: 'Releasing' },
  completed:        { dot: 'bg-emerald-400', label: 'Completed' },
  cancelled:        { dot: 'bg-red-400',     label: 'Cancelled' },
  disputed:         { dot: 'bg-orange-400',  label: 'Disputed' },
  expired:          { dot: 'bg-zinc-400',    label: 'Expired' },
  active:           { dot: 'bg-emerald-400', label: 'Accepted' },
  escrow:           { dot: 'bg-purple-400',  label: 'Escrowed' },
  payment:          { dot: 'bg-purple-400',  label: 'Escrowed' },
  waiting:          { dot: 'bg-cyan-400',    label: 'Payment Sent' },
  complete:         { dot: 'bg-emerald-400', label: 'Completed' },
};

export function ReceiptCard({ data, currentStatus }: ReceiptCardProps) {
  const effectiveStatus = currentStatus || data.status || 'pending';
  const statusStyle = STATUS_STYLES[effectiveStatus] || STATUS_STYLES.pending;
  const isBuy = data.order_type === 'buy';

  return (
    <div className="rounded-xl overflow-hidden bg-white/[0.05] border border-white/[0.07] w-full max-w-[280px]">
      {/* Top strip: order number + status */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.05]">
        <span className="text-[10px] font-mono text-white/30 truncate">#{data.order_number}</span>
        <span className="flex items-center gap-1 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
          <span className="text-[10px] font-semibold text-white/50">{statusStyle.label}</span>
        </span>
      </div>

      {/* Amounts row */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="text-center">
          <p className="text-[15px] font-black tabular-nums text-white leading-none">
            {formatAmount(data.crypto_amount)}
          </p>
          <p className="text-[9px] text-white/30 font-medium mt-0.5">{data.crypto_currency || 'USDT'}</p>
        </div>
        <ArrowRightLeft className="w-3 h-3 text-white/15 shrink-0" strokeWidth={2} />
        <div className="text-center">
          <p className="text-[15px] font-black tabular-nums text-primary leading-none">
            {formatAmount(data.fiat_amount)}
          </p>
          <p className="text-[9px] text-primary/40 font-medium mt-0.5">{data.fiat_currency || 'AED'}</p>
        </div>
      </div>

      {/* Rate + type footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/[0.04] bg-white/[0.02]">
        <span className="text-[9px] font-mono text-white/20">
          @ {formatRate(data.rate)}
        </span>
        <span className={`text-[8px] font-black tracking-widest px-2 py-0.5 rounded-full ${
          isBuy ? 'bg-white/[0.06] text-white/40' : 'bg-primary/[0.15] text-primary border border-primary/20'
        }`}>
          {isBuy ? 'BUY' : 'SELL'}
        </span>
      </div>
    </div>
  );
}

export default ReceiptCard;
