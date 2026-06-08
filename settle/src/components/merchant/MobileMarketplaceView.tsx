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
      {/* Sliding tab strip — matches New Orders / Chat / History / Escrow */}
      <div style={{ position: "relative", display: "flex", background: "rgba(255,255,255,0.055)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12, padding: 3, width: "100%" }}>
        {/* sliding thumb */}
        <div style={{
          position: "absolute", top: 3, bottom: 3, borderRadius: 11,
          background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.14)",
          transition: "left 0.22s cubic-bezier(0.22,1,0.36,1), width 0.22s",
          left: `calc(${marketSubTab === 'browse' ? 0 : 1} * (100% - 6px) / 2 + 3px)`,
          width: "calc((100% - 6px) / 2)",
          pointerEvents: "none",
        }} />
        {([
          { key: 'browse' as const, label: 'Browse', Icon: Globe },
          { key: 'offers' as const, label: 'My Offers', Icon: Package },
        ]).map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMarketSubTab(key)}
            style={{ flex: 1, position: "relative", zIndex: 1, padding: "7px 0", fontSize: 13, fontWeight: 700, color: marketSubTab === key ? "#f5f5f7" : "#86868b", background: "none", border: "none", cursor: "pointer", borderRadius: 11, transition: "color 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
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
