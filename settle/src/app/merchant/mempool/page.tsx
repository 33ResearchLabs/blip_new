'use client';

import { useState, useEffect } from 'react';
import { MarketSnapshot } from '@/components/mempool/MarketSnapshot';
import { MempoolWidget } from '@/components/mempool/MempoolWidget';
import { OrderInspector } from '@/components/mempool/OrderInspector';
import { MerchantQuoteControl } from '@/components/mempool/MerchantQuoteControl';
import { MempoolFilters, MempoolFilterState } from '@/components/mempool/MempoolFilters';
import { Zap, ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface MempoolOrder {
  id: string;
  order_number: string;
  corridor_id: string;
  side: string;
  amount_usdt: number;
  ref_price_at_create: number;
  premium_bps_current: number;
  premium_bps_cap: number;
  bump_step_bps: number;
  current_offer_price: number;
  max_offer_price: number;
  expires_at: string;
  seconds_until_expiry: number;
  creator_username: string | null;
  creator_merchant_id: string | null;
  auto_bump_enabled: boolean;
  created_at: string;
}

interface MerchantInfo {
  id: string;
  username: string;
  display_name: string;
  wallet_address?: string;
}

export default function MempoolPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<MempoolOrder | null>(null);
  const [filters, setFilters] = useState<MempoolFilterState>({
    minPremiumBps: '',
    maxPremiumBps: '',
    minAmount: '',
    maxAmount: '',
  });

  // Restore merchant session from localStorage
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedMerchant = localStorage.getItem('blip_merchant');

        if (savedMerchant) {
          const merchant = JSON.parse(savedMerchant);

          // Validate merchant still exists
          const checkRes = await fetch(`/api/auth/merchant?action=check_session&merchant_id=${merchant.id}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.success && checkData.data?.valid) {
              const freshMerchant = checkData.data.merchant || merchant;
              setMerchantId(freshMerchant.id);
              setMerchantInfo(freshMerchant);
              setIsLoading(false);
              return;
            }
          }

          // Session invalid, clear and redirect
          localStorage.removeItem('blip_merchant');
          localStorage.removeItem('merchant_info');
        }
      } catch (err) {
        console.error('Failed to restore merchant session:', err);
        localStorage.removeItem('blip_merchant');
        localStorage.removeItem('merchant_info');
      }

      // No valid session, redirect to login
      setIsLoading(false);
      router.push('/merchant/login');
    };

    restoreSession();
  }, [router]);

  const handleResetFilters = () => {
    setFilters({
      minPremiumBps: '',
      maxPremiumBps: '',
      minAmount: '',
      maxAmount: '',
    });
  };

  const handleOrderSelect = (order: MempoolOrder) => {
    setSelectedOrder(order);
  };

  const handleCloseInspector = () => {
    setSelectedOrder(null);
  };

  const handleOrderBumped = (orderId: string) => {
    setSelectedOrder(null);
  };

  const handleOrderAccepted = (orderId: string) => {
    setSelectedOrder(null);
  };

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  // Redirect if no merchant (handled by useEffect)
  if (!merchantId || !merchantInfo) {
    return null;
  }

  return (
    <div className="h-screen flex flex-col bg-[#060606] overflow-hidden">
      {/* Navbar — matches main dashboard */}
      <header className="sticky top-0 z-50 bg-black/60 backdrop-blur-2xl border-b border-white/[0.05]">
        <div className="h-[50px] flex items-center px-4 gap-3">
          {/* Left: Back + Logo */}
          <button
            onClick={() => router.push('/merchant')}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-white/40" />
          </button>
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-white fill-white" />
            <span className="text-[17px] leading-none whitespace-nowrap">
              <span className="font-bold text-white">Blip</span>{' '}
              <span className="italic text-white/90">money</span>
            </span>
          </div>

          {/* Center: Page title pill */}
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg p-[3px]">
              <span className="px-3 py-[5px] rounded-md text-[12px] font-medium bg-white/[0.08] text-white flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-orange-400" />
                Priority Mempool
              </span>
            </nav>
            <div className="flex items-center gap-1 px-2 py-1 bg-white/[0.03] rounded-md">
              <span className="text-[10px] font-mono text-white/40">USDT/AED</span>
            </div>
          </div>

          {/* Right: Merchant info */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.02] rounded border border-white/[0.06]">
              <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse" />
              <span className="text-[9px] text-white/35 font-mono">Live</span>
            </div>
            <span className="text-[12px] font-medium text-white/60">
              {merchantInfo?.username || merchantInfo?.display_name || 'Merchant'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content — full-height flex panels */}
      <div className="flex-1 flex overflow-hidden p-2 gap-2">
        {/* Left Column — stacked widgets */}
        <div className="w-[320px] flex flex-col gap-2 shrink-0 overflow-y-auto">
          {/* Market Snapshot Widget */}
          <div className="glass-card rounded-xl overflow-hidden border border-white/[0.06] flex-shrink-0">
            <MarketSnapshot />
          </div>

          {/* Merchant Quote Control Widget */}
          <div className="glass-card rounded-xl overflow-hidden border border-white/[0.06] flex-shrink-0">
            <MerchantQuoteControl
              merchantId={merchantId}
              corridorId="USDT_AED"
            />
          </div>

          {/* Filters Widget */}
          <div className="glass-card rounded-xl overflow-hidden border border-white/[0.06] flex-shrink-0">
            <MempoolFilters
              filters={filters}
              onChange={setFilters}
              onReset={handleResetFilters}
            />
          </div>
        </div>

        {/* Right — Mempool Orders (full-height panel) */}
        <div className="flex-1 glass-card rounded-xl overflow-hidden border border-white/[0.06] flex flex-col">
          <MempoolWidget
            onSelectOrder={handleOrderSelect}
            selectedOrderId={selectedOrder?.id}
          />
        </div>
      </div>

      {/* Order Inspector Drawer */}
      {selectedOrder && (
        <OrderInspector
          order={selectedOrder}
          merchantId={merchantId}
          onClose={handleCloseInspector}
          onBump={handleOrderBumped}
          onAccept={handleOrderAccepted}
        />
      )}
    </div>
  );
}
