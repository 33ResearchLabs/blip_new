'use client';

import { useState } from 'react';
import { Music } from 'lucide-react';
import { formatDuration } from '../../lib/media';
import type { AttachmentPreviewProps } from '../../types';

/** Audio preview: filename, lazily-read duration, and a native audio player. */
export function AudioPreview({ attachment }: AttachmentPreviewProps) {
  const [duration, setDuration] = useState('');

  return (
    <div className="flex h-full w-full flex-col justify-between gap-1 p-2">
      <div className="flex items-center gap-1.5 pr-6">
        <Music className="h-4 w-4 shrink-0 text-gray-300" aria-hidden />
        <span className="truncate text-xs text-gray-200" title={attachment.name}>
          {attachment.name}
        </span>
      </div>
      <span className="text-[10px] text-gray-400">{duration || 'Audio'}</span>
      <audio
        src={attachment.previewUrl}
        preload="metadata"
        controls
        className="h-8 w-full"
        onLoadedMetadata={(event) => setDuration(formatDuration(event.currentTarget.duration))}
      />
    </div>
  );
}
