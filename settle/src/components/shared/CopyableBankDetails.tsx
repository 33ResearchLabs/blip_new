"use client";

import { useState } from "react";
import { Copy, Check, Building2 } from "lucide-react";

interface CopyableBankDetailsProps {
  title?: string;
  bankName?: string;
  accountName?: string;
  iban?: string;
  fallbackText?: string;
  amount?: number;
  compact?: boolean;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded-md hover:bg-white/10 transition-colors shrink-0"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-neutral-500 hover:text-white/70" />
      )}
    </button>
  );
}

export function CopyableBankDetails({
  title = "Payment Details",
  bankName,
  accountName,
  iban,
  fallbackText,
  amount,
  compact = false,
}: CopyableBankDetailsProps) {
  // Fallback for legacy plain-text bank details
  if (fallbackText && !bankName && !accountName && !iban) {
    return (
      <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4">
        <p className="text-xs text-white/40 uppercase tracking-wide mb-2">{title}</p>
        <div className="flex items-center justify-between">
          <p className="text-sm font-mono text-white">{fallbackText}</p>
          <CopyButton text={fallbackText} />
        </div>
        {amount !== undefined && (
          <p className="text-xs text-white/40 mt-2">
            Amount: {"\u062F.\u0625"} {amount.toLocaleString()}
          </p>
        )}
      </div>
    );
  }

  const rows = [
    { label: "Bank", value: bankName },
    { label: "Account Name", value: accountName },
    { label: "IBAN", value: iban, mono: true },
  ].filter((r) => r.value);

  if (rows.length === 0) return null;

  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Building2 className="w-4 h-4 text-white/30" />
        <p className="text-xs text-white/40 uppercase tracking-wide">{title}</p>
      </div>
      <div className={`space-y-${compact ? "1.5" : "2"}`}>
        {rows.map(({ label, value, mono }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-neutral-500 shrink-0">{label}</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className={`text-[13px] text-white truncate ${mono ? "font-mono" : ""}`}
              >
                {value}
              </span>
              <CopyButton text={value!} />
            </div>
          </div>
        ))}
        {amount !== undefined && (
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
            <span className="text-[12px] text-neutral-500">Amount</span>
            <span className="text-[15px] font-semibold text-white">
              {"\u062F.\u0625"} {amount.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
