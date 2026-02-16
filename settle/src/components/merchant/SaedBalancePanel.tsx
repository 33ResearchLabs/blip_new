'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet,
  ArrowRightLeft,
  Loader2,
  X,
  Check,
  AlertCircle
} from 'lucide-react';

interface SaedBalancePanelProps {
  merchantId: string;
  isMockMode: boolean;
}

interface Balances {
  usdt: number;
  saed: number;
  rate: number;
  maxExposure: number | null;
}

export function SaedBalancePanel({
  merchantId,
  isMockMode,
}: SaedBalancePanelProps) {
  console.log('[SaedBalancePanel] Render - merchantId:', merchantId, 'isMockMode:', isMockMode);

  const [balances, setBalances] = useState<Balances>({
    usdt: 0,
    saed: 0,
    rate: 3.67,
    maxExposure: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [conversionDirection, setConversionDirection] = useState<'usdt_to_saed' | 'saed_to_usdt'>('usdt_to_saed');
  const [conversionAmount, setConversionAmount] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!merchantId) {
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/convert?userId=${merchantId}&type=merchant`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.balances) {
          setBalances(data.balances);
        }
      }
    } catch (err) {
      console.error('Failed to fetch sAED balances:', err);
    } finally {
      setIsLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    fetchBalances();
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  const handleConvert = async () => {
    const amount = parseFloat(conversionAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (conversionDirection === 'usdt_to_saed') {
      if (amount > balances.usdt) {
        setError('Insufficient USDT balance');
        return;
      }
    } else {
      const saedInAED = balances.saed / 100;
      if (amount > saedInAED) {
        setError('Insufficient sAED balance');
        return;
      }
    }

    setIsConverting(true);
    setError(null);

    try {
      const amountInSmallestUnits = conversionDirection === 'usdt_to_saed'
        ? Math.floor(amount * 1_000_000)
        : Math.floor(amount * 100);

      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: conversionDirection,
          amount: amountInSmallestUnits,
          accountType: 'merchant',
          accountId: merchantId,
          idempotencyKey: `${merchantId}-${Date.now()}-${Math.random()}`,
        }),
      });

      const data = await response.json();

      if (data.success) {
        await fetchBalances();
        const successMsg = conversionDirection === 'usdt_to_saed'
          ? `Converted ${amount.toFixed(6)} USDT to sAED`
          : `Converted ${amount.toFixed(2)} AED to USDT`;
        setSuccessMessage(successMsg);
        setShowConversionModal(false);
        setConversionAmount('');
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(data.error || 'Conversion failed');
      }
    } catch (err) {
      console.error('Conversion error:', err);
      setError('Network error. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };

  const previewAmount = (() => {
    const amount = parseFloat(conversionAmount);
    if (isNaN(amount) || amount <= 0) return null;

    if (conversionDirection === 'usdt_to_saed') {
      return (amount * balances.rate).toFixed(2);
    } else {
      return (amount / balances.rate).toFixed(6);
    }
  })();

  if (isLoading) {
    return (
      <div className="glass-card rounded-lg p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
      </div>
    );
  }

  console.log('[SaedBalancePanel] Rendering panel with balances:', balances);

  return (
    <>
      <div className="glass-card rounded-lg overflow-hidden">
        <div className="p-3 space-y-2.5">
          {/* Header */}
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-3.5 h-3.5 text-white/30" />
            <span className="text-[9px] text-white/40 font-mono uppercase tracking-wider">
              Synthetic AED
            </span>
          </div>

          {/* USDT Balance */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40 font-mono">USDT</span>
            <span className="text-lg font-bold text-white font-mono tabular-nums">
              ${balances.usdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* sAED Balance */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/40 font-mono">sAED</span>
            <span className="text-lg font-bold text-orange-400 font-mono tabular-nums">
              {(balances.saed / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          {/* Rate */}
          <div className="flex items-center justify-between py-1.5 px-2 bg-white/[0.02] border border-white/[0.04] rounded">
            <span className="text-[9px] text-white/30 font-mono">Rate</span>
            <span className="text-[10px] text-white/50 font-mono font-bold tabular-nums">
              1 USDT = AED{balances.rate.toFixed(2)}
            </span>
          </div>

          {/* Divider */}
          <div className="border-t border-white/[0.04]" />

          {/* Conversion Buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => {
                setConversionDirection('usdt_to_saed');
                setShowConversionModal(true);
                setError(null);
              }}
              className="py-1.5 px-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/20 text-[10px] text-orange-400 font-medium transition-all"
            >
              USDT → sAED
            </button>
            <button
              onClick={() => {
                setConversionDirection('saed_to_usdt');
                setShowConversionModal(true);
                setError(null);
              }}
              className="py-1.5 px-2 rounded-lg bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/20 text-[10px] text-orange-400 font-medium transition-all"
            >
              sAED → USDT
            </button>
          </div>

          {/* Success Message */}
          {successMessage && (
            <div className="flex items-center gap-2 py-1.5 px-2.5 bg-orange-500/10 border border-orange-500/20 rounded">
              <Check className="w-3.5 h-3.5 text-orange-400" />
              <span className="text-[10px] text-orange-400">{successMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* Conversion Modal */}
      {showConversionModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card rounded-lg p-5 w-full max-w-md mx-4 border border-white/[0.08]">
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-white font-mono">
                {conversionDirection === 'usdt_to_saed' ? 'USDT → sAED' : 'sAED → USDT'}
              </h3>
              <button
                onClick={() => {
                  setShowConversionModal(false);
                  setConversionAmount('');
                  setError(null);
                }}
                className="p-1 rounded hover:bg-white/[0.06] transition-colors"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>

            {/* Amount Input */}
            <div className="mb-4">
              <label className="block text-[10px] text-white/40 mb-1.5 font-mono uppercase tracking-wider">
                Amount {conversionDirection === 'usdt_to_saed' ? '(USDT)' : '(AED)'}
              </label>
              <input
                type="number"
                value={conversionAmount}
                onChange={(e) => setConversionAmount(e.target.value)}
                placeholder="0.00"
                step={conversionDirection === 'usdt_to_saed' ? '0.000001' : '0.01'}
                className="w-full bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2.5 text-white font-mono text-sm outline-none focus:border-white/[0.12] transition-colors"
                autoFocus
              />
              {conversionDirection === 'usdt_to_saed' && (
                <div className="mt-1 text-[9px] text-white/30 font-mono">
                  Available: ${balances.usdt.toFixed(6)} USDT
                </div>
              )}
              {conversionDirection === 'saed_to_usdt' && (
                <div className="mt-1 text-[9px] text-white/30 font-mono">
                  Available: AED{(balances.saed / 100).toFixed(2)}
                </div>
              )}
            </div>

            {/* Preview */}
            {previewAmount && (
              <div className="mb-4 py-2.5 px-3 bg-white/[0.02] border border-white/[0.06] rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-white/40 font-mono">You will receive</span>
                  <span className="text-sm font-bold text-orange-400 font-mono tabular-nums">
                    {conversionDirection === 'usdt_to_saed' ? `AED${previewAmount}` : `$${previewAmount}`}
                  </span>
                </div>
                <div className="mt-1 text-[9px] text-white/25 font-mono">
                  Rate: 1 USDT = AED{balances.rate.toFixed(2)}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mb-4 flex items-center gap-2 py-2 px-3 bg-white/[0.03] border border-white/[0.06] rounded">
                <AlertCircle className="w-3.5 h-3.5 text-white/40" />
                <span className="text-[10px] text-white/50">{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowConversionModal(false);
                  setConversionAmount('');
                  setError(null);
                }}
                className="flex-1 py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.06] border border-white/[0.06] text-white/60 text-xs font-medium transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleConvert}
                disabled={isConverting || !conversionAmount || parseFloat(conversionAmount) <= 0}
                className="flex-1 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-xs font-bold transition-all disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isConverting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Converting...
                  </>
                ) : (
                  'Convert'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
