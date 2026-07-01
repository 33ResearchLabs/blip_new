'use client';

import { useState } from 'react';
import { formatDuration } from '../../lib/media';
import type { AttachmentPreviewProps } from '../../types';

/**
 * Inline video preview with native controls. Duration is read lazily from the
 * element's metadata (`preload="metadata"`) so the full file is never decoded.
 */
export function VideoPreview({ attachment }: AttachmentPreviewProps) {
  const [duration, setDuration] = useState('');

  return (
    <div className="relative h-full w-full bg-black">
      <video
        src={attachment.previewUrl}
        preload="metadata"
        controls
        className="h-full w-full object-contain"
        onLoadedMetadata={(event) => setDuration(formatDuration(event.currentTarget.duration))}
      />
      {/* Name + duration overlaid at the top so the native controls bar stays clear. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-1 bg-gradient-to-b from-black/80 to-transparent px-1.5 py-1">
        <span className="truncate text-[10px] text-white/90" title={attachment.name}>
          {attachment.name}
        </span>
        {duration && <span className="shrink-0 text-[10px] text-white/80">{duration}</span>}
      </div>
    </div>
  );
}
