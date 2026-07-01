'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ChatAttachment } from '../types';
import { AttachmentCard } from './AttachmentCard';

interface AttachmentPreviewListProps {
  attachments: ChatAttachment[];
  disabled?: boolean;
  onRemove: (id: string) => void;
}

/**
 * Horizontally-scrollable list of attachment cards with keyboard focus
 * management: after a removal, focus moves to a neighbouring remove button (or
 * the list container) so keyboard users are never dropped to `<body>`.
 */
export function AttachmentPreviewList({ attachments, disabled, onRemove }: AttachmentPreviewListProps) {
  const containerRef = useRef<HTMLUListElement>(null);
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<string | null>(null);

  const registerRemoveButton = useCallback((id: string, element: HTMLButtonElement | null) => {
    if (element) buttonsRef.current.set(id, element);
    else buttonsRef.current.delete(id);
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      const index = attachments.findIndex((a) => a.id === id);
      const neighbour = attachments[index + 1] ?? attachments[index - 1];
      pendingFocusRef.current = neighbour ? neighbour.id : null;
      onRemove(id);
    },
    [attachments, onRemove],
  );

  // After a removal-driven re-render, move focus to the intended target.
  useEffect(() => {
    const targetId = pendingFocusRef.current;
    if (targetId === null) return;
    pendingFocusRef.current = null;
    const button = buttonsRef.current.get(targetId);
    if (button) button.focus();
    else containerRef.current?.focus();
  }, [attachments]);

  if (attachments.length === 0) return null;

  return (
    <ul
      ref={containerRef}
      role="list"
      tabIndex={-1}
      aria-label={`Pasted attachments (${attachments.length})`}
      className="flex gap-2 overflow-x-auto overflow-y-hidden py-2 outline-none [scrollbar-width:thin]"
    >
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.id}
          attachment={attachment}
          disabled={disabled}
          onRemove={handleRemove}
          registerRemoveButton={registerRemoveButton}
        />
      ))}
    </ul>
  );
}
