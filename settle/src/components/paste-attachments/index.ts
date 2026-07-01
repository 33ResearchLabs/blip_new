// Public entry point for the Universal Clipboard Paste Attachment module.
//
// Everything a consumer needs is re-exported here so imports stay stable even
// if the internal file layout changes.

// Wrapper component + core hook.
export { PasteAttachments, default } from './PasteAttachments';
export { usePasteAttachments } from './hooks/usePasteAttachments';

// UI building blocks (for consumers that want to compose their own layout).
export { AttachmentPreviewList } from './components/AttachmentPreviewList';
export { AttachmentCard } from './components/AttachmentCard';
export { ValidationErrors } from './components/ValidationErrors';
export { FileTypeIcon } from './components/previews/FileTypeIcon';

// Utilities — useful for parents that add files from drag-drop / pickers or
// need to model/validate attachments outside the paste flow.
export {
  createAttachment,
  classifyAttachment,
  needsPreviewUrl,
  getExtension,
  dedupeKey,
  formatBytes,
} from './lib/attachment';
export { validateFiles, matchesAcceptedType } from './lib/validation';
export type { ValidationConfig, ValidationResult } from './lib/validation';
export {
  extractClipboard,
  readClipboardFilesAsync,
  canReadAsyncClipboard,
} from './lib/clipboard';
export type { ClipboardPayload } from './lib/clipboard';
export { formatDuration } from './lib/media';

// Constants + defaults.
export {
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_MAX_FILES,
  ATTACHMENT_TYPE_LABEL,
} from './constants';

// Types.
export type {
  ChatAttachment,
  AttachmentType,
  ValidationError,
  ValidationErrorCode,
  PasteAttachmentsOptions,
  PasteAttachmentsProps,
  UsePasteAttachmentsResult,
  AttachmentPreviewProps,
} from './types';
