'use client';

import { useState } from 'react';
import { Building2, Copy, Check, User } from 'lucide-react';

interface BankInfo {
  bank_name?: string;
  account_name?: string;
  iban?: string;
  // For user bank accounts (sell orders)
  user_bank_name?: string;
  user_account_name?: string;
  user_iban?: string;
}

interface BankInfoCardProps {
  data: BankInfo;
  title?: string;
  subtitle?: string;
  variant?: 'merchant' | 'user';
}

export function BankInfoCard({
  data,
  title = 'Payment Details',
  subtitle,
  variant = 'merchant'
}: BankInfoCardProps) {
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

  // Determine which bank info to show based on variant
  const bankName = variant === 'user' ? data.user_bank_name : data.bank_name;
  const accountName = variant === 'user' ? data.user_account_name : data.account_name;
  const iban = variant === 'user' ? data.user_iban : data.iban;

  if (!bankName && !accountName && !iban) {
    return null;
  }

  const iconBg = 'bg-white/5 border border-white/6';
  const iconColor = 'text-white/70';

  return (
    <div className="bg-white/5 border border-white/6 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-white/[0.02] border-b border-white/[0.06] flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}>
          {variant === 'user' ? (
            <User className={`w-4 h-4 ${iconColor}`} />
          ) : (
            <Building2 className={`w-4 h-4 ${iconColor}`} />
          )}
        </div>
        <div>
          <h4 className="text-sm font-medium text-white">{title}</h4>
          {subtitle && (
            <p className="text-xs text-white/50">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Bank Details */}
      <div className="p-4 space-y-3">
        {bankName && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/50">Bank</span>
            <span className="text-sm text-white">{bankName}</span>
          </div>
        )}

        {accountName && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/50">Account Name</span>
            <span className="text-sm text-white">{accountName}</span>
          </div>
        )}

        {iban && (
          <div className="flex justify-between items-center">
            <span className="text-xs text-white/50">IBAN</span>
            <button
              onClick={() => handleCopy(iban, 'iban')}
              className="flex items-center gap-2 text-sm text-white hover:text-white/70 transition-colors font-mono"
            >
              <span className="truncate max-w-[180px]">{iban}</span>
              {copiedField === 'iban' ? (
                <Check className="w-3.5 h-3.5 text-white/70 flex-shrink-0" />
              ) : (
                <Copy className="w-3.5 h-3.5 flex-shrink-0" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default BankInfoCard;
