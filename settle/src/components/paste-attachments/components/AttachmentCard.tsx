'use client';

import { memo } from 'react';
import { X } from 'lucide-react';
import { ATTACHMENT_TYPE_LABEL } from '../constants';
import type { AttachmentType, ChatAttachment } from '../types';
import { AudioPreview } from './previews/AudioPreview';
import { DocumentPreview } from './previews/DocumentPreview';
import { ImagePreview } from './previews/ImagePreview';
import { VideoPreview } from './previews/VideoPreview';

/** Per-type card width; height is uniform (`h-28`) so the row aligns cleanly. */
const CARD_WIDTH: Readonly<Record<AttachmentType, string>> = {
  image: 'w-28',
  video: 'w-40',
  audio: 'w-56',
  document: 'w-44',
};

function renderBody(attachment: ChatAttachment) {
  switch (attachment.type) {
    case 'image':
      return <ImagePreview attachment={attachment} />;
    case 'video':
      return <VideoPreview attachment={attachment} />;
    case 'audio':
      return <AudioPreview attachment={attachment} />;
    case 'document':
      return <DocumentPreview attachment={attachment} />;
    default:
      return null;
  }
}

interface AttachmentCardProps {
  attachment: ChatAttachment;
  disabled?: boolean;
  onRemove: (id: string) => void;
  /** Lets the parent list track the remove button for focus management. */
  registerRemoveButton: (id: string, element: HTMLButtonElement | null) => void;
}

function AttachmentCardComponent({
  attachment,
  disabled,
  onRemove,
  registerRemoveButton,
}: AttachmentCardProps) {
  const { id, name, type } = attachment;

  return (
    <li
      role="listitem"
      aria-label={`${ATTACHMENT_TYPE_LABEL[type]}: ${name}`}
      className={`group relative h-28 ${CARD_WIDTH[type]} shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]`}
    >
      {renderBody(attachment)}

      {!disabled && (
        <button
          type="button"
          ref={(element) => registerRemoveButton(id, element)}
          onClick={() => onRemove(id)}
          aria-label={`Remove ${name}`}
          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white outline-none transition-colors hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </li>
  );
}

/** Memoised so unrelated attachments don't re-render when the list changes. */
export const AttachmentCard = memo(AttachmentCardComponent);
