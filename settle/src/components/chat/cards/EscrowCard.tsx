'use client';

import { useState } from 'react';
import { Lock, Unlock, Copy, Check, ExternalLink, Shield } from 'lucide-react';

interface EscrowData {
  amount?: number;
  currency?: string;
  txHash?: string;
  escrowPda?: string;
  status?: 'locked' | 'released' | 'refunded';
}

interface EscrowCardProps {
  data: EscrowData;
  status?: 'locked' | 'released' | 'refunded';
}

// Truncate hash for display
function truncateHash(hash: string, startChars = 6, endChars = 4): string {
  if (hash.length <= startChars + endChars + 3) return hash;
  return `${hash.slice(0, startChars)}...${hash.slice(-endChars)}`;
}

// Get Blipscan URL for transaction or account
function getBlipscanUrl(value: string, type: 'tx' | 'account' = 'account'): string {
  const baseUrl = process.env.NEXT_PUBLIC_BLIPSCAN_URL || 'https://blipscan.xyz';
  return type === 'tx'
    ? `${baseUrl}/tx/${value}`
    : `${baseUrl}/account/${value}`;
}

export function EscrowCard({ data, status = 'locked' }: EscrowCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (value: string, field: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const effectiveStatus = data.status || status;

  const statusConfig = {
    locked: {
      icon: Lock,
      bg: 'bg-white/5 border border-white/6',
      iconColor: 'text-white/70',
      label: 'Escrow Locked',
      borderColor: 'border-white/6',
    },
    released: {
      icon: Unlock,
      bg: 'bg-white/5 border border-white/6',
      iconColor: 'text-white/70',
      label: 'Escrow Released',
      borderColor: 'border-white/6',
    },
    refunded: {
      icon: Shield,
      bg: 'bg-white/5 border border-white/6',
      iconColor: 'text-white/70',
      label: 'Escrow Refunded',
      borderColor: 'border-white/6',
    },
  };

  const config = statusConfig[effectiveStatus];
  const Icon = config.icon;

  return (
    <div className={`bg-white/5 border border-white/6 rounded-xl ${config.borderColor} overflow-hidden`}>
      {/* Header */}
      <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${config.iconColor}`} />
        </div>
        <div>
          <h4 className="text-sm font-medium text-white">{config.label}</h4>
          {data.amount && (
            <p className="text-xs text-white/50">
              {data.amount} {data.currency || 'USDC'} secured
            </p>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="p-4 space-y-3">
        {data.txHash && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/50">TX Hash</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(data.txHash!, 'txHash')}
                className="flex items-center gap-1.5 text-sm text-white/80 hover:text-white transition-colors font-mono"
              >
                {truncateHash(data.txHash)}
                {copiedField === 'txHash' ? (
                  <Check className="w-3 h-3 text-white/70" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              <a
                href={getBlipscanUrl(data.txHash, 'tx')}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded hover:bg-white/10 transition-colors"
                title="View on Blipscan"
              >
                <ExternalLink className="w-3 h-3 text-white/50 hover:text-white" />
              </a>
            </div>
          </div>
        )}

        {data.escrowPda && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/50">Escrow Address</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleCopy(data.escrowPda!, 'escrowPda')}
                className="flex items-center gap-1.5 text-sm text-white/80 hover:text-white transition-colors font-mono"
              >
                {truncateHash(data.escrowPda)}
                {copiedField === 'escrowPda' ? (
                  <Check className="w-3 h-3 text-white/70" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
              <a
                href={getBlipscanUrl(data.escrowPda, 'account')}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded hover:bg-white/10 transition-colors"
                title="View on Blipscan"
              >
                <ExternalLink className="w-3 h-3 text-white/50 hover:text-white" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default EscrowCard;
