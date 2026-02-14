'use client';

import { useState, useEffect } from 'react';
import { X, Zap, Loader2, Power } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface MerchantQuote {
  id: string;
  merchant_id: string;
  corridor_id: string;
  min_price_aed_per_usdt: number;
  min_size_usdt: number;
  max_size_usdt: number;
  sla_minutes: number;
  available_liquidity_usdt: number;
  is_online: boolean;
  updated_at: string;
  created_at: string;
}

interface MerchantQuoteModalProps {
  merchantId: string;
  corridorId?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function MerchantQuoteModal({
  merchantId,
  corridorId = 'USDT_AED',
  isOpen,
  onClose,
}: MerchantQuoteModalProps) {
  const [quote, setQuote] = useState<MerchantQuote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [minPrice, setMinPrice] = useState('3.67');
  const [minSize, setMinSize] = useState('10');
  const [maxSize, setMaxSize] = useState('10000');
  const [slaMinutes, setSlaMinutes] = useState('15');
  const [liquidity, setLiquidity] = useState('0');
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (isOpen) {
      fetchQuote();
    }
  }, [isOpen, merchantId, corridorId]);

  const fetchQuote = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/merchant-quotes?merchant_id=${merchantId}&corridor_id=${corridorId}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data.quote) {
          const q = data.data.quote;
          setQuote(q);
          setMinPrice(q.min_price_aed_per_usdt.toString());
          setMinSize(q.min_size_usdt.toString());
          setMaxSize(q.max_size_usdt.toString());
          setSlaMinutes(q.sla_minutes.toString());
          setLiquidity(q.available_liquidity_usdt.toString());
          setIsOnline(q.is_online);
        }
      }
    } catch (error) {
      console.error('Failed to fetch merchant quote:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/merchant-quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          corridor_id: corridorId,
          min_price_aed_per_usdt: parseFloat(minPrice),
          min_size_usdt: parseFloat(minSize),
          max_size_usdt: parseFloat(maxSize),
          sla_minutes: parseInt(slaMinutes, 10),
          available_liquidity_usdt: parseFloat(liquidity),
          is_online: isOnline,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setQuote(data.data);
          onClose();
        }
      }
    } catch (error) {
      console.error('Failed to save quote:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.98, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.98, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="bg-[#0a0a0a] rounded-lg w-full max-w-md border border-white/[0.06] shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-white/60" />
              <span className="text-sm font-medium text-white/90">Priority Market</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4 text-white/40" />
            </button>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="p-12 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white/40 animate-spin" />
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Status */}
              <div className="flex items-center justify-between p-2.5 bg-white/[0.02] border border-white/[0.04] rounded">
                <div className="flex items-center gap-2">
                  <Power className={`w-3.5 h-3.5 ${isOnline ? 'text-green-500' : 'text-gray-500'}`} />
                  <span className="text-xs text-white/70">
                    {isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
                <button
                  onClick={() => setIsOnline(!isOnline)}
                  className={`text-[10px] px-2 py-1 rounded ${
                    isOnline
                      ? 'bg-green-500/10 text-green-500'
                      : 'bg-gray-500/10 text-gray-400'
                  }`}
                >
                  {isOnline ? 'Disable' : 'Enable'}
                </button>
              </div>

              {/* Price */}
              <div>
                <label className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5 block">
                  Min Price
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.000001"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded
                               text-sm text-white/90 focus:outline-none focus:border-white/[0.12] transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/30">
                    AED
                  </span>
                </div>
              </div>

              {/* Size Range */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5 block">
                    Min Size
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={minSize}
                      onChange={(e) => setMinSize(e.target.value)}
                      className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded
                                 text-sm text-white/90 focus:outline-none focus:border-white/[0.12] transition-colors"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30">
                      USDT
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5 block">
                    Max Size
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={maxSize}
                      onChange={(e) => setMaxSize(e.target.value)}
                      className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded
                                 text-sm text-white/90 focus:outline-none focus:border-white/[0.12] transition-colors"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30">
                      USDT
                    </span>
                  </div>
                </div>
              </div>

              {/* SLA & Liquidity */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5 block">
                    SLA
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={slaMinutes}
                      onChange={(e) => setSlaMinutes(e.target.value)}
                      className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded
                                 text-sm text-white/90 focus:outline-none focus:border-white/[0.12] transition-colors"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30">
                      MIN
                    </span>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-white/40 uppercase tracking-wide mb-1.5 block">
                    Capital
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={liquidity}
                      onChange={(e) => setLiquidity(e.target.value)}
                      className="w-full px-3 py-2 bg-white/[0.02] border border-white/[0.06] rounded
                                 text-sm text-white/90 focus:outline-none focus:border-white/[0.12] transition-colors"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30">
                      USDT
                    </span>
                  </div>
                </div>
              </div>

              {/* Info */}
              <p className="text-[10px] text-white/30 leading-relaxed pt-1">
                Configure your pricing preferences for accepting priority orders
              </p>
            </div>
          )}

          {/* Footer */}
          {!isLoading && (
            <div className="px-4 py-3 border-t border-white/[0.06] flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-3 py-2 text-xs text-white/60 hover:text-white/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 px-3 py-2 bg-white text-black text-xs font-medium rounded
                           hover:bg-white/90 transition-colors disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
