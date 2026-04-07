'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Loader2, AlertCircle } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { colors } from "@/lib/design/theme";

interface UsernameModalProps {
  isOpen: boolean;
  walletAddress: string;
  onSubmit: (username: string) => Promise<void>;
  onClose?: () => void;
  canClose?: boolean;
  apiEndpoint?: string; // Default: '/api/auth/user', can be '/api/auth/merchant'
}

export default function UsernameModal({
  isOpen,
  walletAddress,
  onSubmit,
  onClose,
  canClose = false,
  apiEndpoint = '/api/auth/user',
}: UsernameModalProps) {
  const [username, setUsername] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState('');

  // Validate username format
  const validateUsername = (value: string): string | null => {
    if (value.length < 3) return 'Username must be at least 3 characters';
    if (value.length > 20) return 'Username must be 20 characters or less';
    if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Only letters, numbers, and underscores allowed';
    return null;
  };

  // Check username availability
  useEffect(() => {
    const checkAvailability = async () => {
      if (!username) {
        setIsAvailable(null);
        setError('');
        return;
      }

      const validationError = validateUsername(username);
      if (validationError) {
        setError(validationError);
        setIsAvailable(null);
        return;
      }

      setIsChecking(true);
      setError('');

      try {
        const response = await fetchWithAuth(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'check_username',
            username,
          }),
        });

        const data = await response.json();

        if (data.success) {
          setIsAvailable(data.data.available);
          if (!data.data.available) {
            setError('Username is already taken');
          }
        } else {
          setError('Could not check availability');
        }
      } catch (err) {
        console.error('Username check error:', err);
        setError('Could not check availability');
      } finally {
        setIsChecking(false);
      }
    };

    const debounce = setTimeout(checkAvailability, 500);
    return () => clearTimeout(debounce);
  }, [username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAvailable) {
      setError('Please choose an available username');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(username);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set username');
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80"
          onClick={canClose ? onClose : undefined}
        />

        {/* Modal */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-md rounded-2xl p-6 shadow-2xl"
          style={{ background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`, border: `1px solid ${colors.border.subtle}` }}
        >
          {/* Close button (only if canClose) */}
          {canClose && onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-lg transition-colors"
              style={{ background: colors.surface.card }}
            >
              <X className="w-5 h-5" style={{ color: colors.text.tertiary }} />
            </button>
          )}

          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold mb-2" style={{ color: colors.text.primary, letterSpacing: '-0.03em' }}>
              Choose Your Username
            </h2>
            <p className="text-sm" style={{ color: colors.text.secondary }}>
              This will be your unique identity on Blip <span style={{ color: colors.accent.primary }}>Money</span>
            </p>
            <p className="text-xs mt-1" style={{ color: colors.text.tertiary }}>
              Cannot be changed later
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Wallet Display */}
            <div className="p-3 rounded-xl" style={{ background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`, border: `1px solid ${colors.border.subtle}` }}>
              <p className="text-xs mb-1" style={{ color: colors.text.tertiary }}>Connected Wallet</p>
              <p className="text-sm font-mono font-semibold" style={{ color: colors.text.primary }}>
                {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
              </p>
            </div>

            {/* Username Input */}
            <div>
              <label htmlFor="username" className="block text-sm font-semibold mb-2" style={{ color: colors.text.primary }}>
                Username
              </label>
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="your_username"
                  className="w-full px-4 py-3 rounded-xl focus:outline-none transition-colors"
                  style={{
                    background: colors.surface.card,
                    border: `1px solid ${error ? 'rgba(220,38,38,0.4)' : isAvailable ? 'rgba(5,150,105,0.4)' : colors.border.subtle}`,
                    color: colors.text.primary,
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                  disabled={isSubmitting}
                  autoComplete="off"
                  autoFocus
                />

                {/* Status Indicator */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isChecking && (
                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: colors.text.tertiary }} />
                  )}
                  {!isChecking && username && isAvailable === true && (
                    <Check className="w-5 h-5 text-green-600" />
                  )}
                  {!isChecking && username && isAvailable === false && (
                    <AlertCircle className="w-5 h-5 text-red-500" />
                  )}
                </div>
              </div>

              {/* Error/Success Message */}
              {error && (
                <p className="mt-2 text-sm text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </p>
              )}
              {!error && username && isAvailable === true && (
                <p className="mt-2 text-sm text-green-600 flex items-center gap-1">
                  <Check className="w-4 h-4" />
                  Username is available!
                </p>
              )}

              {/* Format Helper */}
              <p className="mt-2 text-xs" style={{ color: colors.text.tertiary }}>
                3-20 characters • Letters, numbers, and underscores only
              </p>
            </div>

            {/* Submit Button */}
            <motion.button
              type="submit"
              disabled={!isAvailable || isSubmitting || isChecking}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
              style={{
                background: (!isAvailable || isSubmitting || isChecking) ? colors.surface.card : colors.accent.primary,
                color: (!isAvailable || isSubmitting || isChecking) ? colors.text.quaternary : colors.accent.text,
                fontSize: 15,
                letterSpacing: '-0.01em',
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Setting Username...
                </>
              ) : (
                'Continue'
              )}
            </motion.button>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
