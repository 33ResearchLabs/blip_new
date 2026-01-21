'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Share } from 'lucide-react';
import usePWA from '@/hooks/usePWA';

interface PWAInstallBannerProps {
  appName?: string;
  accentColor?: string;
}

export default function PWAInstallBanner({
  appName = 'Settle',
  accentColor = '#c9a962',
}: PWAInstallBannerProps) {
  const { isInstallable, isIOS, isStandalone, install, dismissInstall, showInstallBanner } = usePWA();

  // Don't show if already installed or dismissed
  if (isStandalone || !showInstallBanner) return null;

  return (
    <AnimatePresence>
      {(isInstallable || isIOS) && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="fixed bottom-0 inset-x-0 z-[100] p-4 pb-safe"
        >
          <div className="max-w-md mx-auto bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 p-4 pb-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                style={{ backgroundColor: `${accentColor}20` }}
              >
                <Download className="w-6 h-6" style={{ color: accentColor }} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-white">Install {appName}</h3>
                <p className="text-xs text-gray-500">
                  {isIOS
                    ? 'Add to Home Screen for the best experience'
                    : 'Install app for quick access'}
                </p>
              </div>
              <button
                onClick={dismissInstall}
                className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* iOS Instructions */}
            {isIOS && (
              <div className="px-4 pb-4">
                <div className="bg-[#1a1a1a] rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">
                      1
                    </span>
                    <span className="text-gray-400">
                      Tap <Share className="w-4 h-4 inline text-blue-400 mx-1" /> Share button
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">
                      2
                    </span>
                    <span className="text-gray-400">
                      Select &quot;Add to Home Screen&quot;
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Install Button (non-iOS) */}
            {!isIOS && isInstallable && (
              <div className="px-4 pb-4">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={install}
                  className="w-full py-3 rounded-xl text-sm font-bold text-black flex items-center justify-center gap-2 transition-colors"
                  style={{ backgroundColor: accentColor }}
                >
                  <Download className="w-4 h-4" />
                  Install App
                </motion.button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
