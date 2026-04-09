"use client";

import { Globe } from "lucide-react";
import { Package } from "lucide-react";
import { Marketplace } from "@/components/merchant/Marketplace";
import { MyOffers } from "@/components/merchant/MyOffers";

export interface MobileMarketplaceViewProps {
  merchantId: string;
  marketSubTab: 'browse' | 'offers';
  setMarketSubTab: (tab: 'browse' | 'offers') => void;
  onTakeOffer: (offer: any) => void;
  onCreateOffer: () => void;
}

export function MobileMarketplaceView({
  merchantId,
  marketSubTab,
  setMarketSubTab,
  onTakeOffer,
  onCreateOffer,
}: MobileMarketplaceViewProps) {
  return (
    <div className="space-y-3">
      <div className="flex bg-white/[0.03] rounded-xl p-1">
        <button
          onClick={() => setMarketSubTab('browse')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            marketSubTab === 'browse' ? 'bg-white/10 text-white' : 'text-foreground/35'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          Browse
        </button>
        <button
          onClick={() => setMarketSubTab('offers')}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            marketSubTab === 'offers' ? 'bg-white/10 text-white' : 'text-foreground/35'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          My Offers
        </button>
      </div>
      {marketSubTab === 'browse' ? (
        <Marketplace
          merchantId={merchantId}
          onTakeOffer={onTakeOffer}
        />
      ) : (
        <MyOffers
          merchantId={merchantId}
          onCreateOffer={onCreateOffer}
        />
      )}
    </div>
  );
}
