"use client";

import { motion } from "framer-motion";
import {
  Eye,
  MessageCircle,
  Scale,
  Search,
} from "lucide-react";
import type { DisputeOrder } from "@/hooks/useDisputeManagement";
import OrderLifecycle from "./OrderLifecycle";

// Helper to get emoji from name
const getEmoji = (name: string | null | undefined): string => {
  const emojis = ["\u{1F98A}", "\u{1F9A7}", "\u{1F40B}", "\u{1F984}", "\u{1F525}", "\u{1F48E}", "\u{1F43A}", "\u{1F981}", "\u{1F42F}", "\u{1F43B}"];
  if (!name) return emojis[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

// Format time ago
const formatTimeAgo = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
};

// ── Parties Display with Role Labels ────────────────────────────────
function PartiesDisplay({ dispute }: { dispute: DisputeOrder }) {
  const isM2M = !!(dispute as any).buyerMerchant;

  // Determine buyer and seller based on order type and M2M status
  let buyer: { name: string; trades: number; label: string; color: string; bg: string };
  let seller: { name: string; trades: number; label: string; color: string; bg: string };

  if (isM2M) {
    // M2M: buyer_merchant_id = buyer, merchant_id = seller
    const bm = (dispute as any).buyerMerchant;
    buyer = {
      name: bm.name,
      trades: bm.trades,
      label: "Buyer Merchant",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    };
    seller = {
      name: dispute.merchant.name,
      trades: dispute.merchant.trades,
      label: "Seller Merchant",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    };
  } else if (dispute.type === "buy") {
    // BUY: user = buyer, merchant = seller
    buyer = {
      name: dispute.user.name,
      trades: dispute.user.trades,
      label: "Buyer",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    };
    seller = {
      name: dispute.merchant.name,
      trades: dispute.merchant.trades,
      label: "Seller",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    };
  } else {
    // SELL: user = seller, merchant = buyer
    seller = {
      name: dispute.user.name,
      trades: dispute.user.trades,
      label: "Seller",
      color: "text-orange-400",
      bg: "bg-orange-500/10",
    };
    buyer = {
      name: dispute.merchant.name,
      trades: dispute.merchant.trades,
      label: "Buyer",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
    };
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center gap-3">
      <div className="flex items-center gap-1.5 flex-1">
        <div className={`w-6 h-6 rounded-full ${seller.bg} flex items-center justify-center text-xs`}>
          {getEmoji(seller.name)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-[10px] font-medium truncate">{seller.name}</p>
            <span className={`text-[8px] px-1 py-px rounded ${seller.color} bg-white/[0.04] font-semibold`}>
              {seller.label}
            </span>
          </div>
          <p className="text-[9px] text-gray-500">{seller.trades} trades · Locks crypto</p>
        </div>
      </div>
      <span className="text-[10px] text-gray-600">vs</span>
      <div className="flex items-center gap-1.5 flex-1 justify-end">
        <div className="min-w-0 text-right">
          <div className="flex items-center gap-1 justify-end">
            <span className={`text-[8px] px-1 py-px rounded ${buyer.color} bg-white/[0.04] font-semibold`}>
              {buyer.label}
            </span>
            <p className="text-[10px] font-medium truncate">{buyer.name}</p>
          </div>
          <p className="text-[9px] text-gray-500">Sends fiat · {buyer.trades} trades</p>
        </div>
        <div className={`w-6 h-6 rounded-full ${buyer.bg} flex items-center justify-center text-xs`}>
          {getEmoji(buyer.name)}
        </div>
      </div>
    </div>
  );
}

interface DisputeReasonInfo {
  icon: string;
  label: string;
  color: string;
}

interface DisputeCardProps {
  dispute: DisputeOrder;
  reasonInfo: DisputeReasonInfo;
  variant: "open" | "investigating";
  index: number;
  onInvestigate?: (orderId: string) => void;
  onChat: (dispute: DisputeOrder) => void;
  onResolve?: (dispute: DisputeOrder) => void;
}

export default function DisputeCard({
  dispute,
  reasonInfo,
  variant,
  index,
  onInvestigate,
  onChat,
  onResolve,
}: DisputeCardProps) {
  if (variant === "open") {
    return (
      <motion.div
        key={dispute.id}
        layout
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: -30 }}
        transition={{ delay: index * 0.03 }}
        className="p-3 bg-[#151515] rounded-xl border border-red-500/20 hover:border-red-500/40 transition-all group"
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center text-lg shrink-0">
            {reasonInfo.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">#{dispute.orderNumber}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  dispute.dispute?.initiatedBy === "user"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-purple-500/20 text-purple-400"
                }`}
              >
                {dispute.dispute?.initiatedBy === "user" ? "User" : "Merchant"}
              </span>
            </div>
            <p className={`text-xs ${reasonInfo.color} mt-0.5`}>{reasonInfo.label}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-bold">${dispute.cryptoAmount.toLocaleString()}</p>
            <p className="text-[10px] text-gray-500">
              {formatTimeAgo(dispute.dispute?.createdAt || dispute.createdAt)}
            </p>
          </div>
        </div>

        {/* Parties with Roles */}
        <PartiesDisplay dispute={dispute} />

        {/* Lifecycle Timeline */}
        {(dispute as any).lifecycle && (
          <OrderLifecycle events={(dispute as any).lifecycle} />
        )}

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => onInvestigate?.(dispute.id)}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg text-xs font-medium text-orange-400 transition-all"
          >
            <Eye className="w-3.5 h-3.5" />
            Investigate
          </motion.button>
          <button
            onClick={() => onChat(dispute)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-xs text-gray-400 transition-all"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Chat
          </button>
        </div>
      </motion.div>
    );
  }

  // variant === "investigating"
  return (
    <motion.div
      key={dispute.id}
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ delay: index * 0.03 }}
      className="p-3 bg-[#151515] rounded-xl border border-orange-500/20 hover:border-orange-500/30 transition-all"
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
          <Search className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">#{dispute.orderNumber}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded">In Progress</span>
          </div>
          <p className={`text-xs ${reasonInfo.color} mt-0.5`}>
            {reasonInfo.icon} {reasonInfo.label}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold">${dispute.cryptoAmount.toLocaleString()}</p>
          <p className="text-[10px] text-orange-400">
            {formatTimeAgo(dispute.dispute?.createdAt || dispute.createdAt)}
          </p>
        </div>
      </div>

      {/* Parties with Roles */}
      <PartiesDisplay dispute={dispute} />

      {/* Lifecycle Timeline */}
      {(dispute as any).lifecycle && (
        <OrderLifecycle events={(dispute as any).lifecycle} />
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onChat(dispute)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-xs text-gray-400 transition-all"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Chat
        </button>
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => onResolve?.(dispute)}
          className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 hover:bg-orange-400 rounded-lg text-xs font-bold text-black transition-all"
        >
          <Scale className="w-3.5 h-3.5" />
          Resolve
        </motion.button>
      </div>
    </motion.div>
  );
}

export { getEmoji, formatTimeAgo };
export type { DisputeReasonInfo };
