"use client";

import { motion } from "framer-motion";
import { ChevronLeft, Loader2 } from "lucide-react";

interface OrderLoadingScreenProps {
  maxW: string;
  setScreen: (s: any) => void;
  setActiveOrderId: (id: string | null) => void;
}

export function OrderLoadingScreen({
  maxW, setScreen, setActiveOrderId,
}: OrderLoadingScreenProps) {
  return (
          <motion.div
            key="order-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className={`flex-1 w-full ${maxW} flex flex-col bg-black items-center justify-center`}
          >
            <div className="h-12" />
            <div className="px-5 py-4 flex items-center w-full">
              <button onClick={() => setScreen("home")} className="p-2 -ml-2">
                <ChevronLeft className="w-6 h-6 text-white" />
              </button>
              <h1 className="flex-1 text-center text-[17px] font-semibold text-white pr-8">Order Details</h1>
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="w-6 h-6 text-white/40 animate-spin mx-auto mb-3" />
                <p className="text-[15px] text-neutral-400">Loading order...</p>
              </div>
            </div>
          </motion.div>
  );
}
