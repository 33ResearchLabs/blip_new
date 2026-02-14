'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Check, AlertCircle } from 'lucide-react';

// 50 pre-made avatar options using DiceBear API and other sources
const PRESET_AVATARS = [
  // Adventurer style (10)
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Max',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Luna',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Charlie',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Bella',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Oliver',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Milo',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Sophie',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Leo',

  // Avataaars style (10)
  'https://api.dicebear.com/7.x/avataaars/svg?seed=John',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Mike',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=David',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Alice',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Tom',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Kate',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=James',
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Lily',

  // Bottts style (10)
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot1',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot2',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot3',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot4',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Robot5',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot6',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot7',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot8',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot9',
  'https://api.dicebear.com/7.x/bottts/svg?seed=Bot10',

  // Pixel Art style (10)
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel1',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel2',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel3',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel4',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Pixel5',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game1',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game2',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game3',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game4',
  'https://api.dicebear.com/7.x/pixel-art/svg?seed=Game5',

  // Lorelei style (10)
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Anna',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Ben',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Clara',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Dan',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Eva',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Frank',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Grace',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Henry',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Iris',
  'https://api.dicebear.com/7.x/lorelei/svg?seed=Jack',
];

interface MerchantProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
  currentAvatar?: string | null;
  currentDisplayName?: string;
  onProfileUpdated: (avatarUrl: string, displayName?: string) => void;
}

export function MerchantProfileModal({
  isOpen,
  onClose,
  merchantId,
  currentAvatar,
  currentDisplayName,
  onProfileUpdated,
}: MerchantProfileModalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatar || null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(currentAvatar || null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handlePresetSelect = async (avatarUrl: string) => {
    setSelectedPreset(avatarUrl);
    setPreviewUrl(avatarUrl);
    setError(null);
    setIsUploading(true);

    try {
      // Update merchant profile with preset avatar
      const updateRes = await fetch(`/api/merchant/${merchantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: avatarUrl }),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to update profile');
      }

      setSuccess(true);
      onProfileUpdated(avatarUrl);

      // Close modal after success
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1500);
    } catch (err) {
      console.error('Update error:', err);
      setError(err instanceof Error ? err.message : 'Update failed');
      setSelectedPreset(currentAvatar || null);
    } finally {
      setIsUploading(false);
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
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-3xl bg-[#0a0a0a] rounded-2xl border border-white/[0.08] shadow-2xl max-h-[90vh] flex flex-col"
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-white/[0.04] rounded-lg transition-colors z-10"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>

          {/* Header */}
          <div className="p-6 border-b border-white/[0.06]">
            <h2 className="text-2xl font-bold text-white mb-2">
              Choose Avatar
            </h2>
            <p className="text-sm text-gray-400">
              Select from 50 preset avatars for your profile
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Current Preview */}
            <div className="flex flex-col items-center gap-4 mb-6 pb-6 border-b border-white/[0.06]">
              <div className="relative">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Profile"
                    className="w-24 h-24 rounded-full object-cover border-2 border-white/20"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full border-2 border-white/20 flex items-center justify-center text-3xl bg-white/5">
                    {currentDisplayName?.charAt(0)?.toUpperCase() || '🐋'}
                  </div>
                )}
                {success && (
                  <div className="absolute inset-0 bg-green-500/80 rounded-full flex items-center justify-center">
                    <Check className="w-8 h-8 text-white" />
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-400">
                {previewUrl ? 'Current Selection' : 'No avatar selected'}
              </p>
            </div>

            {/* Avatar Grid */}
            <div className="grid grid-cols-5 gap-3">
              {PRESET_AVATARS.map((avatarUrl, index) => (
                <motion.button
                  key={index}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handlePresetSelect(avatarUrl)}
                  disabled={isUploading}
                  className={`relative aspect-square rounded-full overflow-hidden border-2 transition-all ${
                    selectedPreset === avatarUrl
                      ? 'border-orange-500 ring-2 ring-orange-500/30'
                      : 'border-white/10 hover:border-white/30'
                  } ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <img
                    src={avatarUrl}
                    alt={`Avatar ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {selectedPreset === avatarUrl && !success && (
                    <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                      {isUploading && (
                        <Loader2 className="w-6 h-6 text-white animate-spin" />
                      )}
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mx-6 mb-6">
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="p-6 border-t border-white/[0.06]">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
