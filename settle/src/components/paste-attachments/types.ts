import type { ClipboardEvent, DragEvent, ReactNode } from 'react';

/**
 * The four preview-able attachment categories. Plain text is intentionally NOT
 * a category — text is inserted into the input, never turned into an attachment.
 */
export type AttachmentType = 'image' | 'video' | 'audio' | 'document';

/**
 * A single clipboard-derived attachment. The shape is fixed by the public
 * contract so parents can persist / upload it without reaching into this
 * module's internals.
 */
export interface ChatAttachment {
  /** Stable unique id (from `crypto.randomUUID`). */
  id: string;
  /** The underlying `File`. Clipboard items are always converted to a `File`. */
  file: File;
  /** Coarse category derived from the MIME type. */
  type: AttachmentType;
  /** Full MIME type, e.g. `"image/png"`. May be `""` for some clipboard files. */
  mimeType: string;
  /** Display file name (synthesized for nameless clipboard items). */
  name: string;
  /** Size in bytes. */
  size: number;
  /** Lower-case extension without the dot, e.g. `"png"`. `""` when unknown. */
  extension: string;
  /** Object URL for image/video/audio previews. Absent for documents. Must be revoked. */
  previewUrl?: string;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
}

/** Codes for every rejection reason surfaced to the parent / UI. */
export type ValidationErrorCode =
  | 'too-large'
  | 'unsupported-type'
  | 'too-many'
  | 'empty'
  | 'duplicate';

export interface ValidationError {
  code: ValidationErrorCode;
  /** Human-readable, user-facing message. */
  message: string;
  /** The offending file name, when applicable. */
  fileName?: string;
}

/** Options shared by the {@link usePasteAttachments} hook and the wrapper component. */
export interface PasteAttachmentsOptions {
  /** Controlled attachment list, owned by the parent. */
  attachments: ChatAttachment[];
  /** Called with the next attachment list whenever it changes. */
  onAttachmentsChange: (attachments: ChatAttachment[]) => void;
  /**
   * Called on a text paste. `text` is the plain text (`text/plain`) with line
   * breaks and whitespace preserved verbatim; `html` is the original rich text
   * (`text/html`), or `""` when the source had none. For text-only pastes the
   * browser still inserts the plain text natively — this fires as a notification
   * and additionally hands you the raw formatting if you need it.
   */
  onTextPaste?: (text: string, html: string) => void;
  /** Max size per file in bytes. Defaults to 20 MB. */
  maxFileSize?: number;
  /** Max number of attachments allowed at once. Defaults to 10. */
  maxFiles?: number;
  /** Allowed MIME globs, e.g. `["image/*", "application/pdf"]`. Omit to allow all. */
  acceptedTypes?: string[];
  /** Called whenever one or more incoming items are rejected. */
  onError?: (errors: ValidationError[]) => void;
}

/** Imperative surface returned by {@link usePasteAttachments}. */
export interface UsePasteAttachmentsResult {
  /** Attach to the element (or a wrapper) that should capture Ctrl/Cmd+V. */
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  /** Attach to the drop zone — dropped files become attachments. */
  onDrop: (event: DragEvent<HTMLElement>) => void;
  /** Attach to the drop zone (required so it is a valid drop target). */
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  /** Attach to the drop zone — toggles `isDragActive` on. */
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  /** Attach to the drop zone — toggles `isDragActive` off when the drag exits. */
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  /** True while a file is being dragged over the drop zone (for a "drop here" overlay). */
  isDragActive: boolean;
  /** Add files from any source (paste, drag-drop, file picker). */
  addFiles: (files: File[]) => void;
  /** Remove a single attachment by id (revokes its object URL). */
  removeAttachment: (id: string) => void;
  /** Remove every attachment (revokes all object URLs). */
  clearAttachments: () => void;
  /** The most recent validation errors. */
  errors: ValidationError[];
  /** Clear the current validation errors. */
  clearErrors: () => void;
}

/** Props for the {@link PasteAttachments} wrapper component. */
export interface PasteAttachmentsProps extends PasteAttachmentsOptions {
  children: ReactNode;
  /** Where to render the preview list relative to children. Default `"above"`. */
  previewPosition?: 'above' | 'below';
  /** Disable paste capture and the remove controls. */
  disabled?: boolean;
  className?: string;
}

/** Props shared by the type-specific preview body components. */
export interface AttachmentPreviewProps {
  attachment: ChatAttachment;
}
