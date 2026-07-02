'use client';

import {
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';

export interface FileMessageBubbleProps {
  fileName?: string | null;
  fileSize?: number | null;
  fileUrl?: string | null;
  mimeType?: string | null;
  className?: string;
}

/** Short, human-readable byte count (e.g. "2.4 MB"). */
function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const rounded =
    value >= 10 || exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[exponent]}`;
}

/**
 * Theme-agnostic file card for a `file` chat message (pdf / sheet / doc / …).
 *
 * Colours are inherited from the surrounding bubble via `currentColor` (icon +
 * text) and `bg-current` tints, so it reads correctly on BOTH a light own-bubble
 * (dark text) and a dark counterparty bubble (light text) without per-surface
 * styling. The whole card is a link that opens the file in a new tab.
 */
export function FileMessageBubble({
  fileName,
  fileSize,
  fileUrl,
  mimeType,
  className = '',
}: FileMessageBubbleProps) {
  const icon = (() => {
    const type = mimeType ?? '';
    if (type.startsWith('image/')) return <ImageIcon className="h-4 w-4 shrink-0" />;
    if (type === 'application/pdf')
      return <FileText className="h-4 w-4 shrink-0 text-red-500" />;
    if (type.includes('sheet') || type.includes('excel') || type.includes('csv'))
      return <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600" />;
    return <FileIcon className="h-4 w-4 shrink-0" />;
  })();

  return (
    <a
      href={fileUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex max-w-[250px] items-center gap-2.5 rounded-lg border border-current/[0.12] bg-current/[0.06] px-3 py-2 transition-colors hover:bg-current/[0.1] ${className}`}
      title={fileName || 'File'}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{fileName || 'File'}</p>
        {fileSize ? (
          <p className="text-[10px] opacity-60">{formatFileSize(fileSize)}</p>
        ) : null}
      </div>
      {fileUrl ? <Download className="h-4 w-4 shrink-0 opacity-60" /> : null}
    </a>
  );
}
