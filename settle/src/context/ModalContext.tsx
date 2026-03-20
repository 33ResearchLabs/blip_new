'use client';

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { Modal, type ModalVariant } from '@/components/Modal';

interface ModalEntry {
  id: string;
  title: string;
  message: string;
  variant: ModalVariant;
  type: 'alert' | 'confirm';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void | Promise<void>;
  onClose?: () => void;
}

interface ModalContextType {
  showAlert: (title: string, message: string, variant?: ModalVariant) => void;
  showConfirm: (
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
    options?: {
      variant?: ModalVariant;
      confirmLabel?: string;
      cancelLabel?: string;
      onCancel?: () => void;
    }
  ) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | null>(null);

// Global functions for usage outside React components
let showAlertGlobal: ModalContextType['showAlert'] | null = null;
let showConfirmGlobal: ModalContextType['showConfirm'] | null = null;

export function showAlert(title: string, message: string, variant?: ModalVariant) {
  if (showAlertGlobal) showAlertGlobal(title, message, variant);
}

export function showConfirm(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  options?: { variant?: ModalVariant; confirmLabel?: string; cancelLabel?: string; onCancel?: () => void }
) {
  if (showConfirmGlobal) showConfirmGlobal(title, message, onConfirm, options);
}

export function ModalProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ModalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const idRef = useRef(0);

  const addModal = useCallback((entry: Omit<ModalEntry, 'id'>) => {
    const id = `modal-${++idRef.current}`;
    setQueue(prev => [...prev, { ...entry, id }]);
  }, []);

  const closeModal = useCallback(() => {
    setLoading(false);
    setQueue(prev => {
      const [current, ...rest] = prev;
      current?.onClose?.();
      return rest;
    });
  }, []);

  const showAlertFn = useCallback<ModalContextType['showAlert']>((title, message, variant = 'info') => {
    addModal({ title, message, variant, type: 'alert' });
  }, [addModal]);

  const showConfirmFn = useCallback<ModalContextType['showConfirm']>((title, message, onConfirm, options) => {
    addModal({
      title,
      message,
      variant: options?.variant ?? 'warning',
      type: 'confirm',
      confirmLabel: options?.confirmLabel,
      cancelLabel: options?.cancelLabel,
      onConfirm,
      onClose: options?.onCancel,
    });
  }, [addModal]);

  // Expose globally
  React.useEffect(() => {
    showAlertGlobal = showAlertFn;
    showConfirmGlobal = showConfirmFn;
    return () => {
      showAlertGlobal = null;
      showConfirmGlobal = null;
    };
  }, [showAlertFn, showConfirmFn]);

  const current = queue[0] ?? null;

  const handleConfirm = useCallback(async () => {
    if (!current?.onConfirm) return;
    try {
      setLoading(true);
      await current.onConfirm();
      closeModal();
    } catch {
      setLoading(false);
    }
  }, [current, closeModal]);

  return (
    <ModalContext.Provider value={{ showAlert: showAlertFn, showConfirm: showConfirmFn, closeModal }}>
      {children}
      <Modal
        open={current !== null}
        onClose={closeModal}
        title={current?.title ?? ''}
        message={current?.message ?? ''}
        variant={current?.variant}
        type={current?.type}
        confirmLabel={current?.confirmLabel}
        cancelLabel={current?.cancelLabel}
        onConfirm={handleConfirm}
        loading={loading}
      />
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within ModalProvider');
  return ctx;
}
