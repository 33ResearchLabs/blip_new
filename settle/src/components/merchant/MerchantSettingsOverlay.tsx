'use client';

import { useEffect, useState } from 'react';
import MerchantSettingsPage from '@/app/merchant/settings/page';

interface MerchantSettingsOverlayProps {
  open: boolean;
  onClose: () => void;
  onOpenWallet?: () => void;
}

export function MerchantSettingsOverlay({ open, onClose, onOpenWallet }: MerchantSettingsOverlayProps) {
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (open) setHasOpened(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!hasOpened) return null;

  return (
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-[70] bg-background overflow-y-auto transition-opacity duration-150 ${
        open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{ visibility: open ? 'visible' : 'hidden' }}
    >
      <MerchantSettingsPage onClose={onClose} onOpenWallet={onOpenWallet} />
    </div>
  );
}
