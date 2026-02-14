'use client';

import { Plus, Settings, DollarSign, Zap, TrendingUp, Target } from 'lucide-react';

interface ConfigPanelProps {
  merchantId: string | null;
  merchantInfo: any;
  effectiveBalance: number | null;
  openTradeForm: {
    tradeType: 'buy' | 'sell';
    cryptoAmount: string;
    paymentMethod: 'bank' | 'cash';
    spreadPreference: 'best' | 'fastest' | 'cheap';
  };
  setOpenTradeForm: (form: any) => void;
  isCreatingTrade: boolean;
  onCreateOrder: () => void;
  refreshBalance: () => void;
}

export function ConfigPanel({
  merchantId,
  merchantInfo,
  effectiveBalance,
  openTradeForm,
  setOpenTradeForm,
  isCreatingTrade,
  onCreateOrder,
  refreshBalance,
}: ConfigPanelProps) {
  const netLiquidity = effectiveBalance || 0;

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Trade Form */}
        <div className="space-y-3">
          {/* Create Button - Top */}
          <button
            onClick={onCreateOrder}
            disabled={isCreatingTrade || !openTradeForm.cryptoAmount || parseFloat(openTradeForm.cryptoAmount) <= 0}
            className="w-full py-3 rounded-lg bg-[#c9a962] text-black font-bold text-sm hover:bg-[#d4b76e] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isCreatingTrade ? 'Creating...' : 'Create Order'}
          </button>

          {/* Amount - First */}
          <div>
            <label className="text-[10px] text-white/40 mb-2 block font-mono uppercase">Amount (USDT)</label>
            <input
              type="number"
              value={openTradeForm.cryptoAmount}
              onChange={(e) => setOpenTradeForm({ ...openTradeForm, cryptoAmount: e.target.value })}
              placeholder="100"
              className="w-full bg-black/40 border border-white/[0.08] rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-white/[0.16] transition-colors"
            />
          </div>

          {/* Order Type */}
          <div>
            <label className="text-[10px] text-white/40 mb-2 block font-mono uppercase">Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setOpenTradeForm({ ...openTradeForm, tradeType: 'buy' })}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                  openTradeForm.tradeType === 'buy'
                    ? 'bg-[#c9a962] text-black'
                    : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => setOpenTradeForm({ ...openTradeForm, tradeType: 'sell' })}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                  openTradeForm.tradeType === 'sell'
                    ? 'bg-[#c9a962] text-black'
                    : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
                }`}
              >
                Sell
              </button>
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="text-[10px] text-white/40 mb-2 block font-mono uppercase">Payment</label>
            <div className="flex gap-2">
              <button
                onClick={() => setOpenTradeForm({ ...openTradeForm, paymentMethod: 'bank' })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  openTradeForm.paymentMethod === 'bank'
                    ? 'bg-white/[0.12] text-white'
                    : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
                }`}
              >
                Bank
              </button>
              <button
                onClick={() => setOpenTradeForm({ ...openTradeForm, paymentMethod: 'cash' })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                  openTradeForm.paymentMethod === 'cash'
                    ? 'bg-white/[0.12] text-white'
                    : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
                }`}
              >
                Cash
              </button>
            </div>
          </div>

          {/* Fee Mode */}
          <div>
            <label className="text-[10px] text-white/40 mb-2 block font-mono uppercase">Fee Mode</label>
            <div className="grid grid-cols-3 gap-2">
              {['best', 'fastest', 'cheap'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setOpenTradeForm({ ...openTradeForm, spreadPreference: mode as any })}
                  className={`py-2 rounded-lg text-[11px] font-medium uppercase transition-all ${
                    openTradeForm.spreadPreference === mode
                      ? 'bg-white/[0.12] text-white'
                      : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08]'
                  }`}
                >
                  {mode === 'fastest' ? 'Fast' : mode}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="pt-3 border-t border-white/[0.06]">
          <button className="w-full py-2 bg-[#1a1a1a] hover:bg-[#1f1f1f] border border-white/[0.06] rounded-lg text-xs text-white/70 font-medium flex items-center justify-center gap-2 transition-colors">
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}
