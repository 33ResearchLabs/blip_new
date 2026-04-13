'use client';

/**
 * Transaction Progress Banner
 *
 * Shows step-by-step progress during blockchain + API operations.
 * Renders as a fixed banner at the top of the screen.
 *
 * Steps: Signing → Confirming → Updating → Done/Failed
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, X, AlertTriangle } from 'lucide-react';

export type TransactionStep = {
  label: string;
  status: 'pending' | 'active' | 'done' | 'failed';
};

export type TransactionState = {
  visible: boolean;
  title: string;
  steps: TransactionStep[];
  currentStep: number;
  status: 'processing' | 'success' | 'error';
  errorMessage?: string;
};

export const INITIAL_TX_STATE: TransactionState = {
  visible: false,
  title: '',
  steps: [],
  currentStep: 0,
  status: 'processing',
};

/** Create a fresh transaction state for a given action */
export function createTxState(title: string, stepLabels: string[]): TransactionState {
  return {
    visible: true,
    title,
    steps: stepLabels.map((label, i) => ({
      label,
      status: i === 0 ? 'active' : 'pending',
    })),
    currentStep: 0,
    status: 'processing',
  };
}

/** Advance to the next step */
export function advanceTxStep(state: TransactionState): TransactionState {
  const next = state.currentStep + 1;
  return {
    ...state,
    currentStep: next,
    steps: state.steps.map((s, i) => ({
      ...s,
      status: i < next ? 'done' : i === next ? 'active' : 'pending',
    })),
  };
}

/** Mark transaction as complete */
export function completeTx(state: TransactionState): TransactionState {
  return {
    ...state,
    status: 'success',
    steps: state.steps.map(s => ({ ...s, status: 'done' as const })),
  };
}

/** Mark transaction as failed */
export function failTx(state: TransactionState, errorMessage: string): TransactionState {
  return {
    ...state,
    status: 'error',
    errorMessage,
    steps: state.steps.map((s, i) => ({
      ...s,
      status: i === state.currentStep ? 'failed' : s.status === 'active' ? 'failed' : s.status,
    })),
  };
}

interface TransactionProgressProps {
  state: TransactionState;
  onDismiss: () => void;
}

export function TransactionProgress({ state, onDismiss }: TransactionProgressProps) {
  if (!state.visible) return null;

  const bgColor = state.status === 'success'
    ? 'bg-success/10 border-success/20'
    : state.status === 'error'
      ? 'bg-error/10 border-error/20'
      : 'bg-surface-card border-border-subtle';

  return (
    <AnimatePresence>
      {state.visible && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[80] w-[90%] max-w-sm rounded-2xl p-4 border shadow-2xl shadow-black/30 ${bgColor}`}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-bold text-text-primary">{state.title}</p>
            {(state.status === 'success' || state.status === 'error') && (
              <button onClick={onDismiss} className="p-1 rounded-lg hover:bg-surface-hover">
                <X className="w-4 h-4 text-text-tertiary" />
              </button>
            )}
          </div>

          {/* Steps */}
          <div className="space-y-2">
            {state.steps.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {/* Step indicator */}
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                  {step.status === 'done' ? (
                    <Check className="w-4 h-4 text-success" />
                  ) : step.status === 'active' ? (
                    <Loader2 className="w-4 h-4 text-accent animate-spin" />
                  ) : step.status === 'failed' ? (
                    <AlertTriangle className="w-4 h-4 text-error" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-text-quaternary" />
                  )}
                </div>
                {/* Step label */}
                <span className={`text-[13px] ${
                  step.status === 'done' ? 'text-success font-medium' :
                  step.status === 'active' ? 'text-text-primary font-medium' :
                  step.status === 'failed' ? 'text-error font-medium' :
                  'text-text-quaternary'
                }`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>

          {/* Error message */}
          {state.status === 'error' && state.errorMessage && (
            <p className="mt-2 text-[12px] text-error">{state.errorMessage}</p>
          )}

          {/* Success auto-dismiss hint */}
          {state.status === 'success' && (
            <p className="mt-2 text-[11px] text-success">Done! Tap to dismiss.</p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
