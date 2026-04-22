'use client';

import { useEffect, useState } from 'react';
import WalletPage from '@/app/merchant/wallet/page';

interface MerchantWalletOverlayProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export function MerchantWalletOverlay({ open, onClose, onOpenSettings }: MerchantWalletOverlayProps) {
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
      <WalletPage onClose={onClose} onOpenSettings={onOpenSettings} />
    </div>
  );
}
