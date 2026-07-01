import { DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_SIZE } from '../constants';
import { dedupeKey } from './attachment';
import type { ChatAttachment, ValidationError } from '../types';

/**
 * True when a MIME type matches an accepted glob such as `"image/*"`,
 * `"application/pdf"`, or `"*"`/`"*\/*"`. An empty accept-list allows everything.
 */
export function matchesAcceptedType(mimeType: string, accepted: string[]): boolean {
  if (accepted.length === 0) return true;
  return accepted.some((pattern) => {
    if (pattern === '*' || pattern === '*/*') return true;
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, pattern.length - 1); // "image/*" -> "image/"
      return mimeType.startsWith(prefix);
    }
    return mimeType === pattern;
  });
}

export interface ValidationConfig {
  maxFileSize?: number;
  maxFiles?: number;
  acceptedTypes?: string[];
}

export interface ValidationResult {
  accepted: File[];
  errors: ValidationError[];
}

function formatLimit(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Validate a batch of incoming files against empty / duplicate / type / size /
 * count rules. Pure and allocation-light, so it is safe to call on every paste.
 * The count limit accounts for already-attached items and for earlier accepts
 * within the same batch.
 */
export function validateFiles(
  incoming: File[],
  existing: ChatAttachment[],
  config: ValidationConfig,
): ValidationResult {
  const maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const maxFiles = config.maxFiles ?? DEFAULT_MAX_FILES;
  const { acceptedTypes } = config;

  const accepted: File[] = [];
  const errors: ValidationError[] = [];
  const seen = new Set(existing.map((a) => dedupeKey(a.file)));
  let count = existing.length;

  for (const file of incoming) {
    const key = dedupeKey(file);
    const label = file.name || 'Item';

    if (file.size === 0) {
      errors.push({ code: 'empty', message: `"${label}" is empty and was skipped.`, fileName: file.name });
      continue;
    }
    if (seen.has(key)) {
      errors.push({ code: 'duplicate', message: `"${label}" is already attached.`, fileName: file.name });
      continue;
    }
    if (acceptedTypes && !matchesAcceptedType(file.type, acceptedTypes)) {
      errors.push({
        code: 'unsupported-type',
        message: `"${label}" (${file.type || 'unknown type'}) is not a supported file type.`,
        fileName: file.name,
      });
      continue;
    }
    if (file.size > maxFileSize) {
      errors.push({
        code: 'too-large',
        message: `"${label}" exceeds the ${formatLimit(maxFileSize)} limit.`,
        fileName: file.name,
      });
      continue;
    }
    if (count >= maxFiles) {
      errors.push({
        code: 'too-many',
        message: `You can attach at most ${maxFiles} files.`,
        fileName: file.name,
      });
      continue;
    }

    accepted.push(file);
    seen.add(key);
    count += 1;
  }

  return { accepted, errors };
}
