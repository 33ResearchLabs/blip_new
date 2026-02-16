'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Check, AlertCircle, Shield, Star } from 'lucide-react';

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

const TIER_COLORS: Record<string, string> = {
  newcomer: 'text-white/40',
  bronze: 'text-orange-700',
  silver: 'text-gray-300',
  gold: 'text-yellow-400',
  platinum: 'text-blue-200',
  diamond: 'text-cyan-300',
};

interface MerchantProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
  currentAvatar?: string | null;
  currentDisplayName?: string;
  currentBio?: string | null;
  onProfileUpdated: (avatarUrl: string, displayName?: string, bio?: string) => void;
}

export function MerchantProfileModal({
  isOpen,
  onClose,
  merchantId,
  currentAvatar,
  currentDisplayName,
  currentBio,
  onProfileUpdated,
}: MerchantProfileModalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatar || null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(currentAvatar || null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bio, setBio] = useState(currentBio || '');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [reputation, setReputation] = useState<{
    score: { total_score: number; tier: string; badges: string[] };
    tierInfo: { name: string; color: string };
    progress: { currentTier: string; nextTier: string | null; progress: number };
  } | null>(null);

  useEffect(() => {
    if (isOpen && merchantId) {
      fetch(`/api/reputation?entityId=${merchantId}&entityType=merchant`)
        .then(r => r.json())
        .then(data => { if (data.success) setReputation(data.data); })
        .catch(() => {});
    }
  }, [isOpen, merchantId]);

  const handlePresetSelect = async (avatarUrl: string) => {
    setSelectedPreset(avatarUrl);
    setPreviewUrl(avatarUrl);
    setError(null);
    setIsUploading(true);

    try {
      const updateRes = await fetch(`/api/merchant/${merchantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: avatarUrl }),
      });

      if (!updateRes.ok) throw new Error('Failed to update profile');

      setSuccess(true);
      onProfileUpdated(avatarUrl);
      setTimeout(() => { onClose(); setSuccess(false); }, 1500);
    } catch (err) {
      console.error('Update error:', err);
      setError(err instanceof Error ? err.message : 'Update failed');
      setSelectedPreset(currentAvatar || null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveBio = async () => {
    setIsSavingBio(true);
    setError(null);
    try {
      const res = await fetch(`/api/merchant/${merchantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio }),
      });
      if (!res.ok) throw new Error('Failed to save bio');
      onProfileUpdated(previewUrl || '', undefined, bio);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bio');
    } finally {
      setIsSavingBio(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-3xl bg-[#0a0a0a] rounded-2xl border border-white/[0.08] shadow-2xl max-h-[90vh] flex flex-col"
        >
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-white/[0.04] rounded-lg transition-colors z-10"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>

          {/* Header with reputation */}
          <div className="p-6 border-b border-white/[0.06]">
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                {previewUrl ? (
                  <img src={previewUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover border-2 border-white/20" />
                ) : (
                  <div className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center text-2xl bg-white/5">
                    {currentDisplayName?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                )}
                {success && (
                  <div className="absolute inset-0 bg-green-500/80 rounded-full flex items-center justify-center">
                    <Check className="w-6 h-6 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-white truncate">{currentDisplayName || 'Profile'}</h2>
                {reputation && (
                  <div className="flex items-center gap-2 mt-1">
                    <Shield className={`w-4 h-4 ${TIER_COLORS[reputation.score.tier] || 'text-white/40'}`} />
                    <span className={`text-sm font-bold ${TIER_COLORS[reputation.score.tier] || 'text-white/40'}`}>
                      {reputation.tierInfo.name}
                    </span>
                    <span className="text-xs text-white/30 font-mono">{reputation.score.total_score}/1000</span>
                    {reputation.progress.nextTier && (
                      <div className="flex items-center gap-1.5 ml-2">
                        <div className="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-orange-500/60 rounded-full transition-all"
                            style={{ width: `${reputation.progress.progress}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-white/20 font-mono">{Math.round(reputation.progress.progress)}%</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Bio section */}
            <div className="mb-6 pb-6 border-b border-white/[0.06]">
              <label className="block text-xs text-white/40 font-mono uppercase tracking-wider mb-2">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 200))}
                placeholder="Tell traders about yourself..."
                rows={2}
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-orange-500/30 resize-none transition-colors"
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[10px] text-white/20 font-mono">{bio.length}/200</span>
                <button
                  onClick={handleSaveBio}
                  disabled={isSavingBio || bio === (currentBio || '')}
                  className="px-3 py-1 rounded-lg bg-orange-500/10 border border-orange-500/20 text-[11px] text-orange-400 font-medium hover:bg-orange-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {isSavingBio ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Save Bio
                </button>
              </div>
            </div>

            {/* Reputation badges */}
            {reputation && reputation.score.badges.length > 0 && (
              <div className="mb-6 pb-6 border-b border-white/[0.06]">
                <label className="block text-xs text-white/40 font-mono uppercase tracking-wider mb-2">Badges</label>
                <div className="flex flex-wrap gap-2">
                  {reputation.score.badges.map((badge: string) => (
                    <span key={badge} className="px-2 py-1 rounded-lg bg-white/[0.04] border border-white/[0.06] text-[11px] text-white/60 font-medium">
                      {badge.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Avatar Grid */}
            <label className="block text-xs text-white/40 font-mono uppercase tracking-wider mb-3">Choose Avatar</label>
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
                  <img src={avatarUrl} alt={`Avatar ${index + 1}`} className="w-full h-full object-cover" />
                  {selectedPreset === avatarUrl && !success && (
                    <div className="absolute inset-0 bg-orange-500/20 flex items-center justify-center">
                      {isUploading && <Loader2 className="w-6 h-6 text-white animate-spin" />}
                    </div>
                  )}
                </motion.button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mx-6 mb-4">
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <p className="text-sm text-red-400">{error}</p>
              </div>
            </div>
          )}

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
