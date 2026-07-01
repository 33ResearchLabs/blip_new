import { MIME_EXTENSION_FALLBACK } from '../constants';
import type { AttachmentType, ChatAttachment } from '../types';

/** Map a MIME type to one of the four coarse attachment categories. */
export function classifyAttachment(mimeType: string): AttachmentType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Only image/video/audio need an object URL for their preview. */
export function needsPreviewUrl(type: AttachmentType): boolean {
  return type === 'image' || type === 'video' || type === 'audio';
}

/** Derive the lower-case extension from a file name, else from the MIME type. */
export function getExtension(name: string, mimeType: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    return name.slice(dot + 1).toLowerCase();
  }
  const fallback = MIME_EXTENSION_FALLBACK[mimeType];
  if (fallback) return fallback;
  const subtype = mimeType.split('/')[1];
  return subtype ? subtype.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

/**
 * Stable identity for de-duplication. Two clipboard files are "the same" when
 * name, size, type and lastModified all match.
 */
export function dedupeKey(file: File): string {
  return `${file.name}::${file.size}::${file.type}::${file.lastModified}`;
}

/** Build a display name for clipboard items that arrive without one. */
function ensureName(
  file: File,
  type: AttachmentType,
  extension: string,
  createdAt: number,
): string {
  if (file.name && file.name.trim() !== '') return file.name;
  const ext = extension ? `.${extension}` : '';
  return `pasted-${type}-${createdAt}${ext}`;
}

/**
 * Convert a `File` into a {@link ChatAttachment}, allocating an object URL only
 * for previewable media. The caller owns the returned `previewUrl` and is
 * responsible for revoking it (the hook does this automatically).
 */
export function createAttachment(file: File): ChatAttachment {
  const createdAt = Date.now();
  const mimeType = file.type || '';
  const type = classifyAttachment(mimeType);
  const extension = getExtension(file.name, mimeType);
  const name = ensureName(file, type, extension, createdAt);
  const previewUrl = needsPreviewUrl(type) ? URL.createObjectURL(file) : undefined;

  return {
    id: crypto.randomUUID(),
    file,
    type,
    mimeType,
    name,
    size: file.size,
    extension,
    previewUrl,
    createdAt,
  };
}

/** Format a byte count as a short human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const rounded = value >= 10 || exponent === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[exponent]}`;
}
