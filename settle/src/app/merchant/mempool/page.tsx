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
        <Loader2 className="w-8 h-8 text-[#c9a962] animate-spin" />
      </div>
    );
  }

  // Redirect if no merchant (handled by useEffect)
  if (!merchantId || !merchantInfo) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-[#0d0d0d]">
        <div className="max-w-[1800px] mx-auto px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/merchant')}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-white/60" />
            </button>
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-[#c9a962]" />
              <div>
                <h1 className="text-2xl font-bold text-white font-mono">
                  AED MEMPOOL
                </h1>
                <p className="text-sm text-white/50 font-mono">
                  USDT→AED Priority Fee Market
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Market Data & Quote Control */}
          <div className="space-y-6">
            {/* Market Snapshot */}
            <MarketSnapshot />

            {/* Merchant Quote Control */}
            <MerchantQuoteControl
              merchantId={merchantId}
              corridorId="USDT_AED"
            />

            {/* Filters */}
            <MempoolFilters
              filters={filters}
              onChange={setFilters}
              onReset={handleResetFilters}
            />
          </div>

          {/* Right Column - Mempool Orders */}
          <div className="lg:col-span-2 h-[calc(100vh-200px)]">
            <MempoolWidget
              onSelectOrder={handleOrderSelect}
              selectedOrderId={selectedOrder?.id}
            />
          </div>
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
