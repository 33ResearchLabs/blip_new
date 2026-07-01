import { dedupeKey } from './attachment';

export interface ClipboardPayload {
  files: File[];
  /** Plain text (`text/plain`). Preserves line breaks and whitespace verbatim. */
  text: string;
  /** Rich text (`text/html`) exactly as copied, or `""` when the source had none. */
  html: string;
}

/**
 * Synchronously extract files and plain text from a paste event's `DataTransfer`.
 *
 * Files are gathered from BOTH `items` (`DataTransferItem.getAsFile`) and `files`
 * (the `FileList`), because browsers disagree on which they populate; the results
 * are de-duplicated. Text is read via the synchronous `getData('text/plain')` —
 * `DataTransferItem.getAsString` is async and the `DataTransfer` is neutered once
 * the paste handler returns, so the synchronous path is the only reliable one.
 */
export function extractClipboard(dataTransfer: DataTransfer): ClipboardPayload {
  const files: File[] = [];
  const seen = new Set<string>();

  const push = (file: File | null): void => {
    if (!file) return;
    const key = dedupeKey(file);
    if (seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  // Path 1 — DataTransferItem list (modern, preferred).
  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file') push(item.getAsFile());
    }
  }
  // Path 2 — Clipboard FileList. ONLY as a fallback when the item list yielded
  // nothing (older browsers). Browsers that populate BOTH expose the SAME pasted
  // image as two distinct File objects whose lastModified differs — reading both
  // dodges de-dup and surfaces the image twice.
  if (files.length === 0 && dataTransfer.files) {
    for (const file of Array.from(dataTransfer.files)) push(file);
  }

  // Read both flavours synchronously. `text/plain` keeps the exact line breaks /
  // whitespace of the copied content; `text/html` carries the original rich
  // formatting for consumers that want it. Neither is normalised or trimmed.
  let text = '';
  let html = '';
  try {
    text = dataTransfer.getData('text/plain') ?? '';
    html = dataTransfer.getData('text/html') ?? '';
  } catch {
    text = '';
    html = '';
  }

  return { files, text, html };
}

/** Whether the async Clipboard read API (Path 3 — ClipboardItem) is usable here. */
export function canReadAsyncClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'clipboard' in navigator &&
    typeof navigator.clipboard.read === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

/**
 * Best-effort async fallback for browsers (notably Safari) that expose a pasted
 * screenshot only through the async Clipboard API and not via the paste event's
 * `DataTransfer`. Returns `[]` on any failure — callers treat that as
 * "nothing found" and degrade gracefully.
 */
export async function readClipboardFilesAsync(): Promise<File[]> {
  if (!canReadAsyncClipboard()) return [];
  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];
    for (const item of items) {
      for (const mimeType of item.types) {
        // Skip textual payloads — those flow through the synchronous path.
        if (mimeType === 'text/plain' || mimeType === 'text/html') continue;
        const blob = await item.getType(mimeType);
        const extension = mimeType.split('/')[1] ?? 'bin';
        files.push(new File([blob], `pasted-${Date.now()}.${extension}`, { type: mimeType }));
      }
    }
    return files;
  } catch {
    return [];
  }
}
