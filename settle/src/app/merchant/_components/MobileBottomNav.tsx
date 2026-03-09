"use client";

import { motion } from "framer-motion";
import {
  Sparkles,
  Lock,
  MessageCircle,
  History,
  Globe,
  Plus,
} from "lucide-react";
import type { Order } from "@/types/merchant";

type MobileView = "orders" | "escrow" | "chat" | "history" | "marketplace";

interface MobileBottomNavProps {
  mobileView: MobileView;
  setMobileView: (view: MobileView) => void;
  setShowOpenTradeModal: (show: boolean) => void;
  pendingOrders: Order[];
  ongoingOrders: Order[];
  totalUnread: number;
}

export function MobileBottomNav({
  mobileView,
  setMobileView,
  setShowOpenTradeModal,
  pendingOrders,
  ongoingOrders,
  totalUnread,
}: MobileBottomNavProps) {
  return (
    <>
      {/* Mobile FAB — Create Order */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowOpenTradeModal(true)}
        className="md:hidden fixed right-4 bottom-[88px] z-40 w-14 h-14 rounded-full bg-orange-500 shadow-lg shadow-orange-500/25 flex items-center justify-center"
      >
        <Plus className="w-6 h-6 text-black" />
      </motion.button>

      {/* Mobile Bottom Navigation — 5 tabs */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-[#060606]/95 backdrop-blur-lg border-t border-white/[0.04] px-1 py-1.5 pb-safe z-50">
        <div className="flex items-center justify-around">
          <button
            onClick={() => setMobileView('orders')}
            className={`flex flex-col items-center gap-0.5 px-2 py-2.5 min-w-[56px] rounded-xl transition-all ${
              mobileView === 'orders' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Sparkles className={`w-[22px] h-[22px] ${mobileView === 'orders' ? 'text-orange-400' : 'text-gray-500'}`} />
              {pendingOrders.length > 0 && (
                <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-white text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {pendingOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'orders' ? 'text-white' : 'text-gray-500'}`}>Pending</span>
          </button>

          <button
            onClick={() => setMobileView('escrow')}
            className={`flex flex-col items-center gap-0.5 px-2 py-2.5 min-w-[56px] rounded-xl transition-all ${
              mobileView === 'escrow' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <Lock className={`w-[22px] h-[22px] ${mobileView === 'escrow' ? 'text-white/70' : 'text-gray-500'}`} />
              {ongoingOrders.length > 0 && (
                <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-orange-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {ongoingOrders.length}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'escrow' ? 'text-white' : 'text-gray-500'}`}>Escrow</span>
          </button>

          <button
            onClick={() => setMobileView('chat')}
            className={`flex flex-col items-center gap-0.5 px-2 py-2.5 min-w-[56px] rounded-xl transition-all ${
              mobileView === 'chat' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <MessageCircle className={`w-[22px] h-[22px] ${mobileView === 'chat' ? 'text-orange-400' : 'text-gray-500'}`} />
              {totalUnread > 0 && (
                <span className="absolute -top-1 -right-1.5 w-4 h-4 bg-orange-500 text-black text-[10px] font-bold rounded-full flex items-center justify-center">
                  {totalUnread}
                </span>
              )}
            </div>
            <span className={`text-[10px] ${mobileView === 'chat' ? 'text-white' : 'text-gray-500'}`}>Chat</span>
          </button>

          <button
            onClick={() => setMobileView('history')}
            className={`flex flex-col items-center gap-0.5 px-2 py-2.5 min-w-[56px] rounded-xl transition-all ${
              mobileView === 'history' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <div className="relative">
              <History className={`w-[22px] h-[22px] ${mobileView === 'history' ? 'text-white/70' : 'text-gray-500'}`} />
            </div>
            <span className={`text-[10px] ${mobileView === 'history' ? 'text-white' : 'text-gray-500'}`}>History</span>
          </button>

          <button
            onClick={() => setMobileView('marketplace')}
            className={`flex flex-col items-center gap-0.5 px-2 py-2.5 min-w-[56px] rounded-xl transition-all ${
              mobileView === 'marketplace' ? 'bg-white/[0.08]' : ''
            }`}
          >
            <Globe className={`w-[22px] h-[22px] ${mobileView === 'marketplace' ? 'text-white/70' : 'text-gray-500'}`} />
            <span className={`text-[10px] ${mobileView === 'marketplace' ? 'text-white' : 'text-gray-500'}`}>Market</span>
          </button>
        </div>
      </nav>
    </>
  );
}
