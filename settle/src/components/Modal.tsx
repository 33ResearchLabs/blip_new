'use client';

import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, Info, XCircle, Loader2 } from 'lucide-react';

export type ModalVariant = 'success' | 'error' | 'warning' | 'info';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  variant?: ModalVariant;
  type?: 'alert' | 'confirm';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void | Promise<void>;
  loading?: boolean;
  closeOnOutsideClick?: boolean;
  closeOnEsc?: boolean;
}

const VARIANT_CONFIG: Record<ModalVariant, {
  icon: typeof Info;
  iconColor: string;
  iconBg: string;
  border: string;
  buttonBg: string;
  buttonHover: string;
  buttonShadow: string;
}> = {
  success: {
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    buttonBg: 'bg-gradient-to-b from-emerald-500 to-emerald-600',
    buttonHover: 'hover:from-emerald-400 hover:to-emerald-500',
    buttonShadow: 'shadow-[0_2px_12px_rgba(16,185,129,0.15)]',
  },
  error: {
    icon: XCircle,
    iconColor: 'text-red-400',
    iconBg: 'bg-red-500/10',
    border: 'border-red-500/20',
    buttonBg: 'bg-gradient-to-b from-red-500 to-red-600',
    buttonHover: 'hover:from-red-400 hover:to-red-500',
    buttonShadow: 'shadow-[0_2px_12px_rgba(239,68,68,0.15)]',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    buttonBg: 'bg-gradient-to-b from-amber-500 to-amber-600',
    buttonHover: 'hover:from-amber-400 hover:to-amber-500',
    buttonShadow: 'shadow-[0_2px_12px_rgba(245,158,11,0.15)]',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    buttonBg: 'bg-gradient-to-b from-blue-500 to-blue-600',
    buttonHover: 'hover:from-blue-400 hover:to-blue-500',
    buttonShadow: 'shadow-[0_2px_12px_rgba(59,130,246,0.15)]',
  },
};

export function Modal({
  open,
  onClose,
  title,
  message,
  variant = 'info',
  type = 'alert',
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
  closeOnOutsideClick = true,
  closeOnEsc = true,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;

  // Store previous focus and trap focus inside modal
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return;
      const focusable = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTab);
    // Focus first button
    requestAnimationFrame(() => {
      const firstBtn = modalRef.current?.querySelector<HTMLElement>('button');
      firstBtn?.focus();
    });

    return () => {
      document.removeEventListener('keydown', handleTab);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  // ESC key
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [open, closeOnEsc, onClose, loading]);

  // Prevent body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleBackdropClick = useCallback(() => {
    if (closeOnOutsideClick && !loading) onClose();
  }, [closeOnOutsideClick, loading, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          onClick={handleBackdropClick}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          aria-describedby="modal-message"
        >
          <motion.div
            ref={modalRef}
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`glass-card rounded-2xl w-full max-w-sm border ${config.border} shadow-2xl overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Color accent bar */}
            <div className={`h-[2px] w-full ${config.iconBg}`} />

            {/* Header */}
            <div className="px-5 pt-5 pb-2">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex-shrink-0 w-9 h-9 rounded-xl ${config.iconBg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${config.iconColor}`} />
                  </div>
                  <h2 id="modal-title" className="text-sm font-bold text-white">
                    {title}
                  </h2>
                </div>
                {!loading && (
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors -mt-1 -mr-1"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4 text-white/40" />
                  </button>
                )}
              </div>
            </div>

            {/* Message */}
            <div className="px-5 py-3">
              <p id="modal-message" className="text-[12px] text-white/60 leading-relaxed">
                {message}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 px-5 pb-5 pt-1">
              {type === 'confirm' && (
                <button
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-white/[0.06]
                             text-[12px] text-white/50 hover:bg-white/[0.04] transition-colors font-medium
                             disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                onClick={type === 'confirm' ? onConfirm : onClose}
                disabled={loading}
                className={`flex-1 px-3 py-2.5 rounded-xl ${config.buttonBg} text-white text-[12px] font-bold
                           ${config.buttonHover} transition-all disabled:opacity-50 disabled:cursor-not-allowed
                           flex items-center justify-center gap-1.5 ${config.buttonShadow}`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  type === 'confirm' ? (confirmLabel || 'Confirm') : 'OK'
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
