'use client';

/**
 * WhatsApp-style Image Preview Modal
 *
 * Full-screen preview shown AFTER image selection but BEFORE sending.
 * No upload happens here — this is preview-only state.
 *
 * State machine: IMAGE_SELECTED → PREVIEW_OPEN → (send click) → SENDING
 */

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2 } from 'lucide-react';

interface ImagePreviewModalProps {
  /** The local blob URL for the preview (created via URL.createObjectURL) */
  previewUrl: string;
  /** Called when user clicks Send. Upload has NOT started yet. */
  onSend: (caption: string) => void;
  /** Called when user closes the modal (cancels the selection). */
  onClose: () => void;
  /** True when the upload is in progress (after send was clicked on a previous attempt). */
  isSending?: boolean;
}

export function ImagePreviewModal({
  previewUrl,
  onSend,
  onClose,
  isSending = false,
}: ImagePreviewModalProps) {
  const [caption, setCaption] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus caption input on mount
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 200);
    return () => clearTimeout(timer);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSending) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, isSending]);

  const handleSend = () => {
    if (isSending) return;
    onSend(caption.trim());
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[90] flex flex-col bg-black"
      >
        {/* Header: close button */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 pt-safe">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            disabled={isSending}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 disabled:opacity-40"
          >
            <X className="w-5 h-5 text-white" />
          </motion.button>
        </div>

        {/* Image preview — fills available space */}
        <div className="flex-1 flex items-center justify-center px-4 min-h-0 overflow-hidden">
          <img
            src={previewUrl}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        </div>

        {/* Bottom: caption + send */}
        <div className="shrink-0 px-4 py-4 pb-safe">
          <div className="flex items-center gap-3">
            <input
              ref={inputRef}
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Add a caption..."
              disabled={isSending}
              className="flex-1 rounded-full px-5 py-3 text-[15px] outline-none text-white placeholder:text-white/40 bg-white/10 border border-white/10 disabled:opacity-40"
            />
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={handleSend}
              disabled={isSending}
              className="w-12 h-12 rounded-full flex items-center justify-center bg-accent disabled:opacity-60"
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 text-accent-text animate-spin" />
              ) : (
                <Send className="w-5 h-5 text-accent-text" />
              )}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
