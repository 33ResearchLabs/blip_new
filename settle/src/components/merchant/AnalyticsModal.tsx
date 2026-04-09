"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, BarChart3, BookOpen } from "lucide-react";
import { AnalyticsDashboard } from "@/components/merchant/AnalyticsDashboard";
import { WalletLedger } from "@/components/merchant/WalletLedger";

interface AnalyticsModalProps {
  show: boolean;
  merchantId: string | null;
  onClose: () => void;
}

const TABS = [
  { id: 'overview', label: 'Overview', Icon: BarChart3 },
  { id: 'ledger', label: 'Ledger', Icon: BookOpen },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function AnalyticsModal({ show, merchantId, onClose }: AnalyticsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  return (
    <AnimatePresence>
      {show && merchantId && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-card-solid rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-white/[0.08] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] sticky top-0 bg-card-solid z-10">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-white">Analytics</h2>
                {/* Tabs */}
                <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-0.5">
                  {TABS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        activeTab === id
                          ? 'bg-white/10 text-white shadow-sm'
                          : 'text-white/50 hover:text-white/70'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-card rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-foreground/35" />
              </button>
            </div>
            <div className="p-6">
              {activeTab === 'overview' ? (
                <AnalyticsDashboard merchantId={merchantId} />
              ) : (
                <WalletLedger merchantId={merchantId} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
