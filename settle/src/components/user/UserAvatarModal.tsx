"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Check, AlertCircle } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { PRESET_AVATARS } from "@/lib/avatars";
import { UserAvatar } from "@/components/ui/UserAvatar";

interface UserAvatarModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Owner user id — target of the PATCH. */
  userId: string | null;
  /** Currently saved avatar URL (for the header preview + selected ring). */
  currentAvatar?: string | null;
  /** Username — seeds the deterministic fallback avatar. */
  userName?: string;
  /** Called with the new URL once the PATCH succeeds. */
  onAvatarUpdated: (avatarUrl: string) => void;
}

/**
 * User-side avatar picker. Mirrors the merchant profile modal's preset grid
 * (50 shared DiceBear avatars) but scoped to just the avatar and styled with
 * the user-app theme tokens. Tapping a preset PATCHes /api/users/{id} with the
 * new avatar_url, shows a per-tile spinner, then a checkmark before closing.
 */
export function UserAvatarModal({
  isOpen,
  onClose,
  userId,
  currentAvatar,
  userName,
  onAvatarUpdated,
}: UserAvatarModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatar || null);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(currentAvatar || null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handlePresetSelect = async (avatarUrl: string) => {
    if (isSaving || !userId) return;
    setSelectedPreset(avatarUrl);
    setPreviewUrl(avatarUrl);
    setError(null);
    setIsSaving(true);

    try {
      const res = await fetchWithAuth(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: avatarUrl }),
      });

      if (!res.ok) throw new Error("Failed to update avatar");

      setSuccess(true);
      onAvatarUpdated(avatarUrl);
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1200);
    } catch (err) {
      console.error("Avatar update error:", err);
      setError(err instanceof Error ? err.message : "Update failed");
      setSelectedPreset(currentAvatar || null);
      setPreviewUrl(currentAvatar || null);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 16 }}
          className="relative w-full max-w-md rounded-t-[24px] sm:rounded-[24px] bg-surface-card border border-border-subtle shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden"
        >
          {/* Header — live preview + title */}
          <div className="flex items-center gap-3 p-5 border-b border-border-subtle">
            <div className="relative shrink-0">
              <UserAvatar
                src={previewUrl}
                seed={userName}
                size={52}
                className="border border-border-medium"
                alt="Your avatar"
              />
              {success && (
                <div className="absolute inset-0 rounded-full bg-accent/85 flex items-center justify-center">
                  <Check className="w-6 h-6 text-accent-text" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[16px] font-bold tracking-[-0.02em] text-text-primary truncate">
                Choose your avatar
              </h2>
              <p className="text-[12px] font-medium text-text-tertiary mt-0.5">
                Tap any avatar to set it
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-[12px] hover:bg-surface-active transition-colors"
            >
              <X className="w-[18px] h-[18px] text-text-tertiary" />
            </button>
          </div>

          {/* Error row */}
          {error && (
            <div className="mx-5 mt-4">
              <div className="flex items-center gap-2 p-3 rounded-[12px] bg-red-500/10 border border-red-500/20">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <p className="text-[13px] text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Avatar grid */}
          <div className="flex-1 overflow-y-auto scrollbar-hide p-5">
            <div className="grid grid-cols-5 gap-3">
              {PRESET_AVATARS.map((avatarUrl, index) => {
                const isSelected = selectedPreset === avatarUrl;
                return (
                  <motion.button
                    key={avatarUrl}
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => handlePresetSelect(avatarUrl)}
                    disabled={isSaving}
                    className={`relative aspect-square rounded-full overflow-hidden border-2 transition-all ${
                      isSelected
                        ? "border-accent ring-2 ring-accent/30"
                        : "border-border-subtle hover:border-border-strong"
                    } ${isSaving ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <img
                      src={avatarUrl}
                      alt={`Avatar ${index + 1}`}
                      className="absolute inset-0 w-full h-full object-cover bg-surface-active"
                    />
                    {isSelected && !success && isSaving && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </div>

          <div className="p-4 pb-[max(16px,env(safe-area-inset-bottom,16px))] border-t border-border-subtle">
            <button
              onClick={onClose}
              className="w-full h-11 rounded-[14px] bg-surface-active text-[13px] font-bold text-text-secondary tracking-[-0.01em] transition-colors hover:bg-surface-hover"
            >
              Done
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
