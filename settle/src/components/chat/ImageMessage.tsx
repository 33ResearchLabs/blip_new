'use client';

import { useState } from 'react';
import { X, Download, ExternalLink } from 'lucide-react';

interface ImageMessageProps {
  imageUrl: string;
  caption?: string;
  isOwn?: boolean;
}

export function ImageMessage({ imageUrl, caption, isOwn = false }: ImageMessageProps) {
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const openLightbox = () => setIsLightboxOpen(true);
  const closeLightbox = () => setIsLightboxOpen(false);

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  return (
    <>
      {/* Thumbnail in chat */}
      <div
        className={`max-w-[200px] rounded-xl overflow-hidden cursor-pointer ${
          isOwn ? 'bg-emerald-500/20' : 'bg-white/10'
        }`}
        onClick={openLightbox}
      >
        <div className="relative">
          {isLoading && (
            <div className="absolute inset-0 bg-white/5 animate-pulse" />
          )}
          <img
            src={imageUrl}
            alt="Chat image"
            className="w-full h-auto max-h-[200px] object-cover"
            onLoad={() => setIsLoading(false)}
          />
        </div>
        {caption && (
          <p className={`px-3 py-2 text-sm ${isOwn ? 'text-emerald-100' : 'text-white/90'}`}>
            {caption}
          </p>
        )}
      </div>

      {/* Lightbox */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4"
          onClick={closeLightbox}
        >
          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <X className="w-6 h-6 text-white" />
          </button>

          {/* Actions */}
          <div className="absolute top-4 left-4 flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              title="Download"
            >
              <Download className="w-5 h-5 text-white" />
            </button>
            <a
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              title="Open in new tab"
            >
              <ExternalLink className="w-5 h-5 text-white" />
            </a>
          </div>

          {/* Full size image */}
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

export default ImageMessage;
