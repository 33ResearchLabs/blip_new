'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Lock,
  DollarSign,
  MessageCircle,
  Shield,
  X,
  Zap,
  ArrowRight,
} from 'lucide-react';

export type ToastType = 'order' | 'escrow' | 'payment' | 'dispute' | 'complete' | 'system' | 'message' | 'warning' | 'action';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  orderId?: string;
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
  timestamp: number;
}

const TOAST_ICONS: Record<ToastType, typeof Bell> = {
  order: Zap,
  escrow: Lock,
  payment: DollarSign,
  dispute: AlertTriangle,
  complete: CheckCircle2,
  system: Bell,
  message: MessageCircle,
  warning: AlertTriangle,
  action: Shield,
};

const TOAST_COLORS: Record<ToastType, { bg: string; border: string; icon: string; accent: string }> = {
  order: { bg: 'bg-[#1a1a1a]/95', border: 'border-orange-500/30', icon: 'text-orange-400', accent: 'bg-orange-500/10' },
  escrow: { bg: 'bg-[#1a1a1a]/95', border: 'border-blue-500/30', icon: 'text-blue-400', accent: 'bg-blue-500/10' },
  payment: { bg: 'bg-[#1a1a1a]/95', border: 'border-emerald-500/30', icon: 'text-emerald-400', accent: 'bg-emerald-500/10' },
  dispute: { bg: 'bg-[#1a1a1a]/95', border: 'border-red-500/30', icon: 'text-red-400', accent: 'bg-red-500/10' },
  complete: { bg: 'bg-[#1a1a1a]/95', border: 'border-emerald-500/30', icon: 'text-emerald-400', accent: 'bg-emerald-500/10' },
  system: { bg: 'bg-[#1a1a1a]/95', border: 'border-white/10', icon: 'text-gray-400', accent: 'bg-white/5' },
  message: { bg: 'bg-[#1a1a1a]/95', border: 'border-purple-500/30', icon: 'text-purple-400', accent: 'bg-purple-500/10' },
  warning: { bg: 'bg-[#1a1a1a]/95', border: 'border-amber-500/30', icon: 'text-amber-400', accent: 'bg-amber-500/10' },
  action: { bg: 'bg-[#1a1a1a]/95', border: 'border-orange-500/40', icon: 'text-orange-400', accent: 'bg-orange-500/15' },
};

const DEFAULT_DURATION = 5000;
const MAX_VISIBLE = 4;

interface NotificationToastContainerProps {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

let addToastGlobal: ((toast: Omit<Toast, 'id' | 'timestamp'>) => void) | null = null;

export function showToast(toast: Omit<Toast, 'id' | 'timestamp'>) {
  if (addToastGlobal) {
    addToastGlobal(toast);
  }
}

export function NotificationToastContainer({ position = 'top-right' }: NotificationToastContainerProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id' | 'timestamp'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newToast: Toast = { ...toast, id, timestamp: Date.now() };

    setToasts(prev => {
      const next = [newToast, ...prev];
      if (next.length > MAX_VISIBLE + 2) {
        const removed = next.slice(MAX_VISIBLE + 2);
        removed.forEach(t => {
          const timer = timersRef.current.get(t.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(t.id);
          }
        });
        return next.slice(0, MAX_VISIBLE + 2);
      }
      return next;
    });

    const duration = toast.duration ?? DEFAULT_DURATION;
    if (duration > 0) {
      const timer = setTimeout(() => removeToast(id), duration);
      timersRef.current.set(id, timer);
    }
  }, [removeToast]);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => { addToastGlobal = null; };
  }, [addToast]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(timer => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  const positionClasses = {
    'top-right': 'top-3 right-3',
    'top-left': 'top-3 left-3',
    'bottom-right': 'bottom-3 right-3',
    'bottom-left': 'bottom-3 left-3',
  };

  const slideDirection = position.includes('right') ? 100 : -100;

  return (
    <div className={`fixed ${positionClasses[position]} z-[100] flex flex-col gap-2 pointer-events-none max-w-[380px] w-full`}>
      <AnimatePresence mode="popLayout">
        {toasts.slice(0, MAX_VISIBLE).map((toast) => {
          const Icon = TOAST_ICONS[toast.type];
          const colors = TOAST_COLORS[toast.type];
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, x: slideDirection, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: slideDirection, scale: 0.9 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className={`pointer-events-auto ${colors.bg} backdrop-blur-xl border ${colors.border} rounded-xl shadow-2xl shadow-black/40 overflow-hidden`}
            >
              <div className={`h-[2px] w-full ${colors.accent}`} />
              <div className="flex items-start gap-3 p-3">
                <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${colors.accent} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${colors.icon}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-medium text-white truncate">{toast.title}</p>
                    <span className="text-[9px] text-gray-500 flex-shrink-0">now</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">{toast.message}</p>
                  {toast.actionLabel && toast.onAction && (
                    <button
                      onClick={() => { toast.onAction?.(); removeToast(toast.id); }}
                      className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      {toast.actionLabel}
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => removeToast(toast.id)}
                  className="flex-shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
                >
                  <X className="w-3 h-3 text-gray-500" />
                </button>
              </div>
              <motion.div
                className={`h-[1px] ${colors.icon.replace('text-', 'bg-')} opacity-30`}
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: (toast.duration ?? DEFAULT_DURATION) / 1000, ease: 'linear' }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function useToast() {
  const show = useCallback((toast: Omit<Toast, 'id' | 'timestamp'>) => {
    showToast(toast);
  }, []);

  return {
    show,
    showOrderCreated: useCallback((info?: string) => {
      show({ type: 'order', title: 'New Order', message: info || 'A new order has been placed' });
    }, [show]),
    showPaymentSent: useCallback((orderId?: string) => {
      show({ type: 'payment', title: 'Payment Sent', message: 'Payment has been marked as sent. Please verify.', orderId, duration: 8000 });
    }, [show]),
    showTradeComplete: useCallback((amount?: string) => {
      show({ type: 'complete', title: 'Trade Complete', message: amount ? `${amount} USDC trade completed` : 'Trade completed successfully', duration: 6000 });
    }, [show]),
    showEscrowLocked: useCallback((amount?: string) => {
      show({ type: 'escrow', title: 'Escrow Locked', message: amount ? `${amount} USDC locked in escrow` : 'Funds locked in escrow' });
    }, [show]),
    showDisputeOpened: useCallback((orderId?: string) => {
      show({ type: 'dispute', title: 'Dispute Opened', message: 'A dispute has been raised on this order', orderId, duration: 10000 });
    }, [show]),
    showNewMessage: useCallback((from: string, preview?: string) => {
      show({ type: 'message', title: `Message from ${from}`, message: preview || 'You have a new message' });
    }, [show]),
    showActionRequired: useCallback((title: string, message: string, onAction?: () => void) => {
      show({ type: 'action', title, message, actionLabel: onAction ? 'View' : undefined, onAction, duration: 8000 });
    }, [show]),
    showWarning: useCallback((message: string) => {
      show({ type: 'warning', title: 'Warning', message, duration: 7000 });
    }, [show]),
    showExtensionRequest: useCallback((from: string, minutes: number) => {
      show({ type: 'system', title: 'Extension Requested', message: `${from} requested ${minutes} more minutes`, duration: 10000 });
    }, [show]),
    showOrderCancelled: useCallback((reason?: string) => {
      show({ type: 'warning', title: 'Order Cancelled', message: reason || 'The order has been cancelled', duration: 6000 });
    }, [show]),
    showOrderExpired: useCallback(() => {
      show({ type: 'warning', title: 'Order Expired', message: 'The order has expired due to timeout', duration: 6000 });
    }, [show]),
    showMerchantAccepted: useCallback((merchantName?: string) => {
      show({ type: 'order', title: 'Order Accepted!', message: merchantName ? `${merchantName} accepted your order` : 'A merchant has accepted your order', duration: 6000 });
    }, [show]),
    showEscrowReleased: useCallback((amount?: string) => {
      show({ type: 'complete', title: 'Escrow Released', message: amount ? `${amount} USDC released from escrow` : 'Escrow has been released', duration: 6000 });
    }, [show]),
  };
}

export function ConnectionIndicator({ isConnected, label }: { isConnected: boolean; label?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative">
        <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
        {isConnected && (
          <div className="absolute inset-0 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping opacity-40" />
        )}
      </div>
      {label !== undefined && (
        <span className={`text-[9px] ${isConnected ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
          {label || (isConnected ? 'Live' : 'Offline')}
        </span>
      )}
    </div>
  );
}

export function ActionPulse({ size = 'sm', label }: { size?: 'sm' | 'md'; label?: string }) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <div className={`${sizeClass} rounded-full bg-orange-400`} />
        <div className={`absolute inset-0 ${sizeClass} rounded-full bg-orange-400 animate-ping opacity-50`} />
      </div>
      {label && <span className="text-[9px] font-medium text-orange-400/80">{label}</span>}
    </div>
  );
}
