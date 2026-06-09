'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Droplets,
  Save,
  CheckCircle2,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

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

// Visual redesign of the LP form to match the new merchant settings mocks.
// Same data + endpoint as before — only the JSX/styling has changed:
//   - Title row pulls the Status toggle to the right (was a stacked row).
//   - Fee input has a suffixed `%` chip and a helper line right below.
//   - Min/Max use AED suffix chips and a side-by-side grid.
//   - Auto-accept gets a description line and a fatter pill toggle.
//   - Primary "Save LP Settings" button is full-width with the brand fill.
export function CorridorProviderSettings({ merchantId }: CorridorProviderSettingsProps) {
  const [provider, setProvider] = useState<ProviderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const [isActive, setIsActive] = useState(false);
  const [feePercentage, setFeePercentage] = useState('0.50');
  const [minAmount, setMinAmount] = useState('100');
  const [maxAmount, setMaxAmount] = useState('50000');
  const [autoAccept, setAutoAccept] = useState(true);

  const fetchProvider = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetchWithAuth(`/api/corridor/providers?merchant_id=${merchantId}`);
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
      const res = await fetchWithAuth('/api/corridor/providers', {
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
    } catch {
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
    <div>
      {/* Title row — Droplets icon + name on the left, Status toggle on the
          right. Replaces the wrapper-card header that the settings page
          previously rendered, so the component is self-contained. */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex items-center gap-2">
          <Droplets className="w-5 h-5 text-[#f5f5f7]" />
          <span className="text-base font-bold text-white">Liquidity Provider (LP)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-white/40">Status</span>
          <button
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive(!isActive)}
            className={`w-11 h-6 rounded-full transition-all relative shrink-0 ${
              isActive ? 'bg-[var(--foreground)]' : 'bg-white/[0.10]'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full shadow-sm absolute top-0.5 transition-all ${
                isActive ? 'left-[22px] bg-[var(--background)]' : 'left-0.5 bg-[var(--foreground)]'
              }`}
            />
          </button>
          <span className={`text-[12px] font-medium ${isActive ? 'text-[#f5f5f7]' : 'text-white/50'}`}>
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <p className="text-[13px] text-white/45 leading-relaxed max-w-prose mb-6">
        Earn fees by bridging sAED to AED. When a buyer pays with sAED, you
        send real AED to the seller&apos;s bank and receive the buyer&apos;s
        sAED.
      </p>

      {/* Fee Percentage */}
      <div className="mb-1">
        <label className="text-[13px] text-white/70 font-medium mb-2 block">Fee Percentage</label>
        <div className="relative">
          <input
            type="number"
            step="0.01"
            min="0"
            max="10"
            value={feePercentage}
            onChange={(e) => setFeePercentage(e.target.value)}
            className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-14 text-[15px] text-white font-medium focus:outline-none focus:border-white/[0.12] focus:ring-1 focus:ring-white/20 transition-all"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-white/40 font-medium">%</span>
        </div>
      </div>
      <p className="text-[12px] text-white/35 mb-6">
        On a 1,000 AED trade you earn {(fee * 10).toFixed(0)} fils ({fee}%)
      </p>

      {/* Min / Max */}
      <div className="grid grid-cols-2 gap-4 mb-2">
        <div>
          <label className="text-[13px] text-white/70 font-medium mb-2 block">Minimum AED</label>
          <div className="relative">
            <input
              type="number"
              min="1"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-14 text-[15px] text-white font-medium focus:outline-none focus:border-white/[0.12] focus:ring-1 focus:ring-white/20 transition-all"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-white/40 font-medium">AED</span>
          </div>
        </div>
        <div>
          <label className="text-[13px] text-white/70 font-medium mb-2 block">Maximum AED</label>
          <div className="relative">
            <input
              type="number"
              min="1"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3 pr-14 text-[15px] text-white font-medium focus:outline-none focus:border-white/[0.12] focus:ring-1 focus:ring-white/20 transition-all"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] text-white/40 font-medium">AED</span>
          </div>
        </div>
      </div>
      {max > 0 && min > max && (
        <p className="text-[11px] text-red-400 mb-2">Max must be &gt;= min</p>
      )}

      {/* Auto-accept */}
      <div className="flex items-center justify-between py-4 mt-2 mb-2">
        <div>
          <p className="text-[14px] text-white font-medium">Auto-accept assignments</p>
          <p className="text-[12px] text-white/40 mt-0.5">
            Automatically accept new trade assignments
          </p>
        </div>
        <button
          role="switch"
          aria-checked={autoAccept}
          onClick={() => setAutoAccept(!autoAccept)}
          className={`w-12 h-6 rounded-full transition-all relative shrink-0 ${
            autoAccept ? 'bg-[var(--foreground)]' : 'bg-white/[0.10]'
          }`}
        >
          <div
            className={`w-5 h-5 rounded-full shadow-sm absolute top-0.5 transition-all ${
              autoAccept ? 'left-[26px] bg-[var(--background)]' : 'left-0.5 bg-[var(--foreground)]'
            }`}
          />
        </button>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || (max > 0 && min > max)}
        className="w-full py-3.5 rounded-xl bg-[#f5f5f7] hover:bg-white/[0.08] text-background text-sm font-bold disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
      >
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : saveMsg === 'Saved' ? (
          <CheckCircle2 className="w-4 h-4" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {saving ? 'Saving...' : saveMsg || 'Save LP Settings'}
      </button>

      {/* Stats — only shows once the merchant has actually been filling
          orders. Kept compact since the wrapper card is already dense. */}
      {provider && provider.total_fulfillments != null && provider.total_fulfillments > 0 && (
        <div className="border-t border-white/[0.06] pt-4 mt-5 grid grid-cols-3 gap-3 text-[12px]">
          <div>
            <p className="text-[10px] text-white/30 font-mono uppercase tracking-wider">Fills</p>
            <p className="text-white font-medium">{provider.total_fulfillments}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/30 font-mono uppercase tracking-wider">Volume</p>
            <p className="text-white font-medium">{Number(provider.total_volume).toLocaleString()} AED</p>
          </div>
          {provider.avg_fulfillment_time_sec != null && (
            <div>
              <p className="text-[10px] text-white/30 font-mono uppercase tracking-wider">Avg Time</p>
              <p className="text-white font-medium">~{Math.round(provider.avg_fulfillment_time_sec / 60)} min</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
