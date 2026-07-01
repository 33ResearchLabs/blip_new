import type { AttachmentType } from './types';

/** Default per-file size cap (20 MB). */
export const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

/** Default maximum number of simultaneous attachments. */
export const DEFAULT_MAX_FILES = 10;

/**
 * Fallback MIME → extension map for clipboard items that arrive without a usable
 * file name (e.g. screenshots). Only common cases need entries; everything else
 * falls back to the MIME subtype in {@link getExtension}.
 */
export const MIME_EXTENSION_FALLBACK: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

/** Groups extensions so the document icon can pick a sensible glyph + colour. */
export const DOCUMENT_ICON_GROUPS = {
  pdf: ['pdf'],
  word: ['doc', 'docx', 'rtf', 'odt'],
  sheet: ['xls', 'xlsx', 'csv', 'ods', 'numbers'],
  slides: ['ppt', 'pptx', 'odp', 'key'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
  text: ['txt', 'md', 'log', 'json', 'xml', 'yml', 'yaml'],
} as const;

export type DocumentIconGroup = keyof typeof DOCUMENT_ICON_GROUPS | 'generic';

/** Human labels for each attachment type, used in aria-labels / tooltips. */
export const ATTACHMENT_TYPE_LABEL: Readonly<Record<AttachmentType, string>> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
};
