'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Loader2, AlertCircle } from 'lucide-react';

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
        const response = await fetch(apiEndpoint, {
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
          className="relative w-full max-w-md bg-[#0a0a0a] rounded-2xl border border-white/[0.08] p-6 shadow-2xl"
        >
          {/* Close button (only if canClose) */}
          {canClose && onClose && (
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          )}

          {/* Header */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white mb-2">
              Choose Your Username
            </h2>
            <p className="text-sm text-gray-400">
              This will be your unique identity on Blip <span className="text-orange-500">Money</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Cannot be changed later
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Wallet Display */}
            <div className="p-3 bg-white/[0.02] border border-white/[0.08] rounded-xl">
              <p className="text-xs text-gray-500 mb-1">Connected Wallet</p>
              <p className="text-sm text-white font-mono">
                {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
              </p>
            </div>

            {/* Username Input */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-white mb-2">
                Username
              </label>
              <div className="relative">
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="your_username"
                  className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50 transition-colors"
                  disabled={isSubmitting}
                  autoComplete="off"
                  autoFocus
                />

                {/* Status Indicator */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isChecking && (
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                  )}
                  {!isChecking && username && isAvailable === true && (
                    <Check className="w-5 h-5 text-green-500" />
                  )}
                  {!isChecking && username && isAvailable === false && (
                    <AlertCircle className="w-5 h-5 text-red-500" />
                  )}
                </div>
              </div>

              {/* Error/Success Message */}
              {error && (
                <p className="mt-2 text-sm text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </p>
              )}
              {!error && username && isAvailable === true && (
                <p className="mt-2 text-sm text-green-400 flex items-center gap-1">
                  <Check className="w-4 h-4" />
                  Username is available!
                </p>
              )}

              {/* Format Helper */}
              <p className="mt-2 text-xs text-gray-500">
                3-20 characters • Letters, numbers, and underscores only
              </p>
            </div>

            {/* Submit Button */}
            <motion.button
              type="submit"
              disabled={!isAvailable || isSubmitting || isChecking}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
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
