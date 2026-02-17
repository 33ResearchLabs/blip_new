'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Droplets,
  ToggleLeft,
  ToggleRight,
  DollarSign,
  BarChart3,
  Clock,
  CheckCircle2,
} from 'lucide-react';

interface CorridorProviderSettingsProps {
  merchantId: string | null;
}

interface ProviderData {
  id?: string;
  merchant_id?: string;
  is_active: boolean;
  fee_percentage: number;
  min_amount: number;
  max_amount: number;
  auto_accept: boolean;
  total_fulfillments?: number;
  total_volume?: number;
  avg_fulfillment_time_sec?: number | null;
  last_fulfillment_at?: string | null;
}

export function CorridorProviderSettings({ merchantId }: CorridorProviderSettingsProps) {
  const [provider, setProvider] = useState<ProviderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Form state
  const [isActive, setIsActive] = useState(false);
  const [feePercentage, setFeePercentage] = useState('0.50');
  const [minAmount, setMinAmount] = useState('100');
  const [maxAmount, setMaxAmount] = useState('50000');
  const [autoAccept, setAutoAccept] = useState(true);

  const fetchProvider = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/corridor/providers?merchant_id=${merchantId}`);
      const json = await res.json();
      if (json.success && json.data) {
        const p = json.data as ProviderData;
        setProvider(p);
        setIsActive(p.is_active);
        setFeePercentage(String(p.fee_percentage));
        setMinAmount(String(p.min_amount));
        setMaxAmount(String(p.max_amount));
        setAutoAccept(p.auto_accept);
      }
    } catch (err) {
      console.error('Failed to fetch provider:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    fetchProvider();
  }, [fetchProvider]);

  const handleSave = async () => {
    if (!merchantId) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/corridor/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          is_active: isActive,
          fee_percentage: parseFloat(feePercentage) || 0.5,
          min_amount: parseFloat(minAmount) || 100,
          max_amount: parseFloat(maxAmount) || 50000,
          auto_accept: autoAccept,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setProvider(json.data);
        setSaveMsg('Saved');
        setTimeout(() => setSaveMsg(''), 2000);
      } else {
        setSaveMsg(json.error || 'Failed to save');
      }
    } catch (err) {
      setSaveMsg('Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-white/30" />
      </div>
    );
  }

  const fee = parseFloat(feePercentage) || 0;
  const min = parseFloat(minAmount) || 0;
  const max = parseFloat(maxAmount) || 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Droplets className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-white/80">Liquidity Provider (LP)</span>
      </div>

      <p className="text-xs text-white/40 leading-relaxed">
        Earn fees by bridging sAED to AED. When a buyer pays with sAED, you send real AED to the seller&apos;s bank and receive the buyer&apos;s sAED.
      </p>

      {/* Active toggle */}
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-white/60">Active</span>
        <button
          onClick={() => setIsActive(!isActive)}
          className="flex items-center gap-1.5"
        >
          {isActive ? (
            <ToggleRight className="w-6 h-6 text-green-400" />
          ) : (
            <ToggleLeft className="w-6 h-6 text-white/30" />
          )}
          <span className={`text-xs ${isActive ? 'text-green-400' : 'text-white/30'}`}>
            {isActive ? 'ON' : 'OFF'}
          </span>
        </button>
      </div>

      {/* Fee */}
      <div>
        <label className="text-xs text-white/40 block mb-1">Fee %</label>
        <input
          type="number"
          step="0.01"
          min="0"
          max="10"
          value={feePercentage}
          onChange={(e) => setFeePercentage(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-blue-500/50"
        />
        {fee > 0 && (
          <p className="text-[10px] text-white/30 mt-0.5">
            On a 1,000 AED trade you earn {(fee * 10).toFixed(0)} fils ({fee}%)
          </p>
        )}
      </div>

      {/* Min / Max */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-white/40 block mb-1">Min AED</label>
          <input
            type="number"
            min="1"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-blue-500/50"
          />
        </div>
        <div>
          <label className="text-xs text-white/40 block mb-1">Max AED</label>
          <input
            type="number"
            min="1"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-1.5 text-sm text-white/80 focus:outline-none focus:border-blue-500/50"
          />
        </div>
      </div>
      {max > 0 && min > max && (
        <p className="text-[10px] text-red-400">Max must be &gt;= min</p>
      )}

      {/* Auto accept */}
      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-white/50">Auto-accept assignments</span>
        <button onClick={() => setAutoAccept(!autoAccept)}>
          {autoAccept ? (
            <ToggleRight className="w-5 h-5 text-green-400" />
          ) : (
            <ToggleLeft className="w-5 h-5 text-white/30" />
          )}
        </button>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || (max > 0 && min > max)}
        className="w-full py-2 rounded bg-blue-600/80 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
      >
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : saveMsg === 'Saved' ? (
          <CheckCircle2 className="w-4 h-4 text-green-300" />
        ) : (
          <DollarSign className="w-4 h-4" />
        )}
        {saving ? 'Saving...' : saveMsg || 'Save LP Settings'}
      </button>

      {/* Stats (if provider exists) */}
      {provider && provider.total_fulfillments != null && provider.total_fulfillments > 0 && (
        <div className="border-t border-white/5 pt-3 mt-3 space-y-1.5">
          <span className="text-xs text-white/40 font-medium">Stats</span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-white/50">
              <BarChart3 className="w-3 h-3" />
              <span>{provider.total_fulfillments} fills</span>
            </div>
            <div className="flex items-center gap-1.5 text-white/50">
              <DollarSign className="w-3 h-3" />
              <span>{Number(provider.total_volume).toLocaleString()} AED</span>
            </div>
            {provider.avg_fulfillment_time_sec != null && (
              <div className="flex items-center gap-1.5 text-white/50">
                <Clock className="w-3 h-3" />
                <span>~{Math.round(provider.avg_fulfillment_time_sec / 60)}min avg</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
