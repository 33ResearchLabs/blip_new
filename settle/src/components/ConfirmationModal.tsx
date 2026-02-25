'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Info, X } from 'lucide-react';
import { useConfirmationStore, closeConfirmation } from '@/stores/confirmationStore';

const VARIANT_STYLES = {
  danger: {
    icon: AlertTriangle,
    iconColor: 'text-red-400',
    iconBg: 'bg-red-500/10',
    confirmBtn: 'bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white shadow-[0_2px_12px_rgba(239,68,68,0.15)]',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-orange-400',
    iconBg: 'bg-orange-500/10',
    confirmBtn: 'bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-black shadow-[0_2px_12px_rgba(249,115,22,0.15)]',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    confirmBtn: 'bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-black shadow-[0_2px_12px_rgba(249,115,22,0.15)]',
  },
};

export function ConfirmationModal() {
  const { isOpen, title, message, confirmText, cancelText, variant, isAlert } = useConfirmationStore();
  const style = VARIANT_STYLES[variant];
  const Icon = style.icon;

  // Lock body scroll when open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConfirmation(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => closeConfirmation(false)}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="glass-card rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${style.iconBg}`}>
                    <Icon className={`w-5 h-5 ${style.iconColor}`} />
                  </div>
                  <h2 className="text-base font-bold text-white">{title}</h2>
                </div>
                <button
                  onClick={() => closeConfirmation(false)}
                  className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors -mt-1 -mr-1"
                >
                  <X className="w-4 h-4 text-white/40" />
                </button>
              </div>
            </div>

            {/* Message */}
            <div className="px-5 pb-5">
              <p className="text-[13px] text-white/60 leading-relaxed">{message}</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 px-5 pb-5">
              {!isAlert && (
                <button
                  onClick={() => closeConfirmation(false)}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-white/[0.06]
                             text-[12px] text-white/50 hover:bg-white/[0.04] transition-colors font-medium"
                >
                  {cancelText}
                </button>
              )}
              <button
                onClick={() => closeConfirmation(true)}
                autoFocus
                className={`flex-1 px-3 py-2.5 rounded-xl text-[12px] font-bold transition-all ${style.confirmBtn}`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
