'use client';

import { AlertCircle, X } from 'lucide-react';
import type { ValidationError } from '../types';

interface ValidationErrorsProps {
  errors: ValidationError[];
  onDismiss?: () => void;
}

/** Assertive, screen-reader-announced list of validation failures. */
export function ValidationErrors({ errors, onDismiss }: ValidationErrorsProps) {
  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mb-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
      <ul className="flex-1 space-y-0.5">
        {errors.map((error, index) => (
          <li key={`${error.code}-${error.fileName ?? index}`}>{error.message}</li>
        ))}
      </ul>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss errors"
          className="rounded p-0.5 text-red-300 outline-none transition-colors hover:text-red-100 focus-visible:ring-2 focus-visible:ring-red-400/70"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
