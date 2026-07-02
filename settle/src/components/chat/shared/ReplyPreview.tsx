import { FileText, Image as ImageIcon, Film, Music } from 'lucide-react';

const ICON_CLASS = 'h-3 w-3 shrink-0';

/** Render an icon for a reply preview based on the original message kind. */
function KindIcon({ kind }: { kind: string }) {
  if (kind === 'image') return <ImageIcon className={ICON_CLASS} aria-hidden />;
  if (kind === 'video') return <Film className={ICON_CLASS} aria-hidden />;
  if (kind === 'audio') return <Music className={ICON_CLASS} aria-hidden />;
  if (kind === 'file') return <FileText className={ICON_CLASS} aria-hidden />;
  return null;
}

interface ReplyPreviewProps {
  reference: { kind: string; preview: string };
  className?: string;
}

/** Compact icon + one-line preview, shared by ReplyReference and ReplyComposer. */
export function ReplyPreview({ reference, className }: ReplyPreviewProps) {
  return (
    <span className={`flex items-center gap-1 truncate text-xs ${className ?? ''}`}>
      <KindIcon kind={reference.kind} />
      <span className="truncate">{reference.preview || 'Message'}</span>
    </span>
  );
}
