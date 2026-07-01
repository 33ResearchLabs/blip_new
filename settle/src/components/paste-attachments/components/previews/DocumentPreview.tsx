import { formatBytes } from '../../lib/attachment';
import type { AttachmentPreviewProps } from '../../types';
import { FileTypeIcon } from './FileTypeIcon';

/** Document preview: type icon, filename, extension and size. */
export function DocumentPreview({ attachment }: AttachmentPreviewProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
      <FileTypeIcon extension={attachment.extension} className="h-7 w-7" />
      <span className="w-full truncate px-1 text-xs text-gray-200" title={attachment.name}>
        {attachment.name}
      </span>
      <span className="text-[10px] uppercase text-gray-500">
        {attachment.extension || 'file'} · {formatBytes(attachment.size)}
      </span>
    </div>
  );
}
