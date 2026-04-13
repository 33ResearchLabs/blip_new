'use client';

/**
 * Image Message Bubble — WhatsApp-style
 *
 * States:
 *  - uploading: shows local preview + circular progress + cancel button
 *  - sent:      shows final image from CDN + lightbox on click
 *  - failed:    shows dimmed preview + retry button
 *
 * The bubble ALWAYS shows an image (local or remote), never a blank box.
 * This gives the "instant send" feel even on slow connections.
 */

import { useState } from 'react';
import { X, RotateCcw, Loader2, Check, Download, ExternalLink } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

export type ImageUploadStatus = 'uploading' | 'sent' | 'failed' | 'cancelled';

interface ImageMessageBubbleProps {
  /** Local blob URL (available immediately) or remote CDN URL (after upload) */
  imageUrl: string;
  /** Optional caption text */
  caption?: string;
  /** Upload state */
  uploadStatus: ImageUploadStatus;
  /** Upload progress 0-100 (only meaningful when status=uploading) */
  uploadProgress?: number;
  /** Cancel the in-progress upload */
  onCancel?: () => void;
  /** Retry a failed upload */
  onRetry?: () => void;
  /** Whether this is the current user's message */
  isOwn?: boolean;
}

export function ImageMessageBubble({
  imageUrl,
  caption,
  uploadStatus,
  uploadProgress = 0,
  onCancel,
  onRetry,
  isOwn = true,
}: ImageMessageBubbleProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isImgLoaded, setIsImgLoaded] = useState(false);

  const canOpenLightbox = uploadStatus === 'sent';
  const showProgress = uploadStatus === 'uploading';
  const showRetry = uploadStatus === 'failed';

  const handleClick = () => {
    if (canOpenLightbox) setIsLightboxOpen(true);
  };

  const handleDownload = async () => {
    try {
      const response = await fetchWithAuth(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {}
  };

  // Circular progress SVG with smooth animation
  // The CSS transition on strokeDashoffset smooths out the jumpy XHR progress
  // events — feels like WhatsApp instead of raw percentage ticks.
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (uploadProgress / 100) * circumference;

  return (
    <>
      {/* Chat bubble image */}
      <div
        className={`relative max-w-[220px] rounded-xl overflow-hidden cursor-pointer ${
          showRetry ? 'opacity-60' : ''
        }`}
        onClick={handleClick}
      >
        {/* Image */}
        {!isImgLoaded && (
          <div className="w-[200px] h-[150px] bg-white/5 animate-pulse rounded-xl" />
        )}
        <img
          src={imageUrl}
          alt="Chat image"
          className={`w-full h-auto max-h-[250px] object-cover ${!isImgLoaded ? 'hidden' : ''}`}
          onLoad={() => setIsImgLoaded(true)}
        />

        {/* Upload progress overlay */}
        {showProgress && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            {/* Circular progress */}
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
              {/* Background circle */}
              <circle
                cx="22" cy="22" r={radius}
                fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3"
              />
              {/* Progress arc */}
              <circle
                cx="22" cy="22" r={radius}
                fill="none" stroke="white" strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-300"
              />
            </svg>
            {/* Cancel button overlaid on circle */}
            {onCancel && (
              <button
                onClick={(e) => { e.stopPropagation(); onCancel(); }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            )}
          </div>
        )}

        {/* Failed overlay */}
        {showRetry && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <button
              onClick={(e) => { e.stopPropagation(); onRetry?.(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-error/80 text-white text-[12px] font-bold"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        )}

        {/* Sent checkmark */}
        {uploadStatus === 'sent' && isOwn && (
          <div className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full bg-black/40 flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
        )}
      </div>

      {/* Caption */}
      {caption && caption !== 'Photo' && (
        <p className="mt-1 text-[14px] leading-relaxed">{caption}</p>
      )}

      {/* Lightbox */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setIsLightboxOpen(false)}
        >
          <button
            onClick={() => setIsLightboxOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20"
          >
            <X className="w-6 h-6 text-white" />
          </button>
          <div className="absolute top-4 left-4 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20"
            >
              <Download className="w-5 h-5 text-white" />
            </button>
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20"
            >
              <ExternalLink className="w-5 h-5 text-white" />
            </a>
          </div>
          <img
            src={imageUrl}
            alt="Full size"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
