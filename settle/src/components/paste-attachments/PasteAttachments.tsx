'use client';

import { AttachmentPreviewList } from './components/AttachmentPreviewList';
import { ValidationErrors } from './components/ValidationErrors';
import { usePasteAttachments } from './hooks/usePasteAttachments';
import type { PasteAttachmentsProps } from './types';

/**
 * Generic, reusable wrapper that captures Ctrl/Cmd+V from any focusable child
 * input and renders the attachment preview list + validation errors around it.
 *
 * Fully controlled and UI-agnostic: the parent owns `attachments` and receives
 * updates via `onAttachmentsChange`. Nothing here is coupled to the chat module
 * or to any upload backend — the parent decides what to do with the attachments.
 *
 * @example
 * <PasteAttachments
 *   attachments={attachments}
 *   onAttachmentsChange={setAttachments}
 *   onTextPaste={handleTextPaste}
 *   maxFileSize={20 * 1024 * 1024}
 *   maxFiles={10}
 *   acceptedTypes={["image/*", "video/*", "audio/*", "application/pdf"]}
 * >
 *   <ChatInput />
 * </PasteAttachments>
 */
export function PasteAttachments({
  children,
  previewPosition = 'above',
  disabled = false,
  className,
  ...options
}: PasteAttachmentsProps) {
  const { onPaste, removeAttachment, errors, clearErrors } = usePasteAttachments(options);

  const previews = (
    <AttachmentPreviewList
      attachments={options.attachments}
      disabled={disabled}
      onRemove={removeAttachment}
    />
  );

  return (
    // Paste events bubble from the focused child input up to this wrapper.
    <div className={className} onPaste={disabled ? undefined : onPaste}>
      <ValidationErrors errors={errors} onDismiss={clearErrors} />
      {previewPosition === 'above' && previews}
      {children}
      {previewPosition === 'below' && previews}
    </div>
  );
}

export default PasteAttachments;
