'use client';

/**
 * OrderActionButtons - Backend-driven action buttons (hardened).
 *
 * Renders ONLY what the backend sends. No role checks, no status logic.
 *
 * SAFETY:
 *   - primaryAction is ALWAYS present (never null)
 *   - Disabled during any in-flight action (prevents double-click)
 *   - Loading spinner per-action
 *   - Null action types are rendered as disabled informational buttons
 */

import { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { PrimaryAction, SecondaryAction, ActionType } from '@/types/backendOrder';

interface OrderActionButtonsProps {
  orderId: string;
  /** ALWAYS present. When no action, type=null + enabled=false. */
  primaryAction: PrimaryAction;
  /** Explicitly null when no secondary action. */
  secondaryAction: SecondaryAction | null;
  onAction: (orderId: string, action: ActionType) => Promise<void>;
  className?: string;
}

const ACTION_VARIANTS: Record<string, string> = {
  ACCEPT: 'bg-green-600 hover:bg-green-700 text-white',
  CLAIM: 'bg-green-600 hover:bg-green-700 text-white',
  LOCK_ESCROW: 'bg-blue-600 hover:bg-blue-700 text-white',
  SEND_PAYMENT: 'bg-blue-600 hover:bg-blue-700 text-white',
  CONFIRM_PAYMENT: 'bg-green-600 hover:bg-green-700 text-white',
  CANCEL: 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30',
  DISPUTE: 'bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30',
};

const DISABLED_STYLE = 'bg-zinc-700/50 text-zinc-400 cursor-not-allowed';

export function OrderActionButtons({
  orderId,
  primaryAction,
  secondaryAction,
  onAction,
  className = '',
}: OrderActionButtonsProps) {
  const [loadingAction, setLoadingAction] = useState<ActionType | null>(null);
  const inflightRef = useRef(false);

  const handleAction = async (action: ActionType) => {
    // Double-click guard
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoadingAction(action);
    try {
      await onAction(orderId, action);
    } finally {
      setLoadingAction(null);
      inflightRef.current = false;
    }
  };

  const anyLoading = loadingAction !== null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Primary Action — always rendered */}
      <button
        onClick={() => primaryAction.type && primaryAction.enabled && handleAction(primaryAction.type)}
        disabled={!primaryAction.enabled || anyLoading}
        title={primaryAction.disabledReason}
        className={`
          w-full px-4 py-3 rounded-lg font-medium text-sm transition-all
          flex items-center justify-center gap-2
          ${primaryAction.enabled && !anyLoading
            ? (primaryAction.type
              ? ACTION_VARIANTS[primaryAction.type] || 'bg-blue-600 hover:bg-blue-700 text-white'
              : DISABLED_STYLE)
            : DISABLED_STYLE
          }
        `}
      >
        {loadingAction === primaryAction.type && primaryAction.type ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : null}
        {primaryAction.label}
      </button>

      {/* Disabled reason text */}
      {!primaryAction.enabled && primaryAction.disabledReason && (
        <p className="text-xs text-zinc-500 text-center px-2">
          {primaryAction.disabledReason}
        </p>
      )}

      {/* Secondary Action — only if present and has actionable type */}
      {secondaryAction && secondaryAction.type && (
        <button
          onClick={() => secondaryAction.type && handleAction(secondaryAction.type)}
          disabled={anyLoading}
          className={`
            w-full px-4 py-2 rounded-lg text-sm transition-all
            flex items-center justify-center gap-2
            ${anyLoading
              ? DISABLED_STYLE
              : (ACTION_VARIANTS[secondaryAction.type] || 'bg-zinc-700/50 hover:bg-zinc-700 text-zinc-300')
            }
          `}
        >
          {loadingAction === secondaryAction.type ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : null}
          {secondaryAction.label}
        </button>
      )}
    </div>
  );
}
