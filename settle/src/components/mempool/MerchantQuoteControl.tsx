'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Loader2, Power, DollarSign, Package } from 'lucide-react';

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

interface MerchantQuoteControlProps {
  merchantId: string;
  corridorId?: string;
}

export function MerchantQuoteControl({
  merchantId,
  corridorId = 'USDT_AED',
}: MerchantQuoteControlProps) {
  const [quote, setQuote] = useState<MerchantQuote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [minPrice, setMinPrice] = useState('3.67');
  const [minSize, setMinSize] = useState('10');
  const [maxSize, setMaxSize] = useState('10000');
  const [slaMinutes, setSlaMinutes] = useState('15');
  const [liquidity, setLiquidity] = useState('0');
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    fetchQuote();
  }, [merchantId, corridorId]);

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
          alert('Quote saved successfully!');
        } else {
          alert(data.error || 'Failed to save quote');
        }
      }
    } catch (error) {
      console.error('Failed to save quote:', error);
      alert('Failed to save quote');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Settings className="w-3.5 h-3.5 text-white/30" />
          <span className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
            Quote Control
          </span>
          <span className="text-[10px] text-white/40 font-mono ml-auto">{corridorId}</span>
        </div>
      </div>

      {/* Form */}
      <div className="p-4 space-y-4">
        {/* Online/Offline Toggle */}
        <div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.06] rounded-lg">
          <div className="flex items-center gap-2">
            <Power className={`w-4 h-4 ${isOnline ? 'text-green-500' : 'text-red-500'}`} />
            <span className="text-sm font-mono text-white">
              Status: {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <button
            onClick={() => setIsOnline(!isOnline)}
            className={`px-3 py-1.5 rounded font-mono text-xs font-bold transition-colors ${
              isOnline
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            }`}
          >
            {isOnline ? 'GO OFFLINE' : 'GO ONLINE'}
          </button>
        </div>

        {/* Min Price */}
        <div>
          <label className="block text-[10px] text-white/50 font-mono uppercase mb-2 flex items-center gap-1.5">
            <DollarSign className="w-3 h-3" />
            Minimum Price (AED/USDT)
          </label>
          <input
            type="number"
            step="0.000001"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                       text-white font-mono text-sm focus:outline-none focus:border-orange-500/50"
            placeholder="3.67"
          />
          <p className="text-[9px] text-white/30 font-mono mt-1">
            Only accept orders at or above this price
          </p>
        </div>

        {/* Size Range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-white/50 font-mono uppercase mb-2 flex items-center gap-1.5">
              <Package className="w-3 h-3" />
              Min Size (USDT)
            </label>
            <input
              type="number"
              step="1"
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                         text-white font-mono text-sm focus:outline-none focus:border-orange-500/50"
              placeholder="10"
            />
          </div>

          <div>
            <label className="block text-[10px] text-white/50 font-mono uppercase mb-2">
              Max Size (USDT)
            </label>
            <input
              type="number"
              step="1"
              value={maxSize}
              onChange={(e) => setMaxSize(e.target.value)}
              className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                         text-white font-mono text-sm focus:outline-none focus:border-orange-500/50"
              placeholder="10000"
            />
          </div>
        </div>

        {/* SLA */}
        <div>
          <label className="block text-[10px] text-white/50 font-mono uppercase mb-2">
            SLA (minutes)
          </label>
          <input
            type="number"
            step="1"
            value={slaMinutes}
            onChange={(e) => setSlaMinutes(e.target.value)}
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                       text-white font-mono text-sm focus:outline-none focus:border-orange-500/50"
            placeholder="15"
          />
          <p className="text-[9px] text-white/30 font-mono mt-1">
            Time commitment to fulfill accepted orders
          </p>
        </div>

        {/* Available Liquidity */}
        <div>
          <label className="block text-[10px] text-white/50 font-mono uppercase mb-2">
            Available Liquidity (USDT)
          </label>
          <input
            type="number"
            step="1"
            value={liquidity}
            onChange={(e) => setLiquidity(e.target.value)}
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg
                       text-white font-mono text-sm focus:outline-none focus:border-orange-500/50"
            placeholder="1000"
          />
          <p className="text-[9px] text-white/30 font-mono mt-1">
            Total USDT you can sell right now
          </p>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full px-4 py-3 rounded-lg bg-orange-500 text-black font-medium font-mono
                     hover:bg-orange-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Quote
            </>
          )}
        </button>

        {/* Last Updated */}
        {quote && (
          <div className="text-center text-[9px] text-white/30 font-mono">
            Last updated: {new Date(quote.updated_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}
