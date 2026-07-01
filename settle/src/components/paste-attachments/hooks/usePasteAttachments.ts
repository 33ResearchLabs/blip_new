'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardEvent, DragEvent } from 'react';
import { createAttachment } from '../lib/attachment';
import {
  extractClipboard,
  readClipboardFilesAsync,
  type ClipboardPayload,
} from '../lib/clipboard';
import { validateFiles } from '../lib/validation';
import { DEFAULT_MAX_FILES, DEFAULT_MAX_FILE_SIZE } from '../constants';
import type {
  PasteAttachmentsOptions,
  UsePasteAttachmentsResult,
  ValidationError,
} from '../types';

/**
 * Controlled clipboard-attachment engine.
 *
 * The parent owns the `attachments` array; this hook validates incoming files,
 * de-duplicates them, builds {@link ChatAttachment}s and hands the next array
 * back via `onAttachmentsChange`. It also owns the object-URL lifecycle: every
 * URL it allocates is revoked when the corresponding attachment leaves the list
 * — whether removed through this hook OR directly by the parent — and on unmount.
 */
export function usePasteAttachments(options: PasteAttachmentsOptions): UsePasteAttachmentsResult {
  const {
    attachments,
    onAttachmentsChange,
    onTextPaste,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxFiles = DEFAULT_MAX_FILES,
    acceptedTypes,
    onError,
  } = options;

  const [errors, setErrors] = useState<ValidationError[]>([]);

  // Latest props kept in refs so `onPaste` / `addFiles` stay referentially
  // stable across renders (prevents needless listener re-binding downstream).
  // useRef seeds the correct first-render value; the effect below keeps them in
  // sync after each commit (writing refs during render is disallowed).
  const attachmentsRef = useRef(attachments);
  const onChangeRef = useRef(onAttachmentsChange);
  const onTextRef = useRef(onTextPaste);
  const onErrorRef = useRef(onError);
  const configRef = useRef({ maxFileSize, maxFiles, acceptedTypes });

  useEffect(() => {
    attachmentsRef.current = attachments;
    onChangeRef.current = onAttachmentsChange;
    onTextRef.current = onTextPaste;
    onErrorRef.current = onError;
    configRef.current = { maxFileSize, maxFiles, acceptedTypes };
  });

  // Every object URL we have created, so we can revoke ones that fall out of the
  // controlled list — even when the parent removes them without our helpers.
  const createdUrlsRef = useRef<Set<string>>(new Set());

  const emitErrors = useCallback((next: ValidationError[]) => {
    if (next.length === 0) return;
    setErrors(next);
    onErrorRef.current?.(next);
  }, []);

  const addFiles = useCallback(
    (incoming: File[]) => {
      if (incoming.length === 0) return;
      const { maxFileSize, maxFiles, acceptedTypes } = configRef.current;
      const { accepted, errors: validationErrors } = validateFiles(
        incoming,
        attachmentsRef.current,
        { maxFileSize, maxFiles, acceptedTypes },
      );

      if (accepted.length > 0) {
        const created = accepted.map(createAttachment);
        for (const attachment of created) {
          if (attachment.previewUrl) createdUrlsRef.current.add(attachment.previewUrl);
        }
        onChangeRef.current([...attachmentsRef.current, ...created]);
      }
      emitErrors(validationErrors);
    },
    [emitErrors],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const dataTransfer = event.clipboardData;
      if (!dataTransfer) return;

      let payload: ClipboardPayload = { files: [], text: '', html: '' };
      try {
        payload = extractClipboard(dataTransfer);
      } catch {
        return;
      }
      const { files, text, html } = payload;

      if (files.length > 0) {
        // We take ownership of the files as attachments — stop the browser from
        // also inserting them (e.g. into a contenteditable).
        event.preventDefault();
        addFiles(files);
        // A file-carrying paste may also carry text; surface it, but leave the
        // parent to decide whether to insert it (native insertion is now blocked).
        if (text || html) onTextRef.current?.(text, html);
        return;
      }

      if (text || html) {
        // Text-only paste: let the browser insert the plain text natively —
        // preserving line breaks and whitespace exactly — AND hand the parent
        // the raw text + original HTML formatting.
        onTextRef.current?.(text, html);
        return;
      }

      // Nothing in the synchronous payload — try the async Clipboard API, which
      // is where Safari sometimes exposes a pasted screenshot.
      void readClipboardFilesAsync().then((asyncFiles) => {
        if (asyncFiles.length > 0) addFiles(asyncFiles);
      });
    },
    [addFiles],
  );

  // ─── Drag-and-drop ─────────────────────────────────────────────────────────
  // `isDragActive` lets the consumer show a "drop here" overlay. `dragDepth`
  // counts enter/leave across nested children so the overlay doesn't flicker as
  // the pointer moves between descendants of the drop zone.
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepth = useRef(0);

  const isFileDrag = (event: DragEvent<HTMLElement>): boolean =>
    !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragActive(true);
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    // Required — without preventDefault the element is not a valid drop target.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setIsDragActive(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) return;
      dragDepth.current = 0;
      setIsDragActive(false);
      let files: File[] = [];
      try {
        files = extractClipboard(dataTransfer).files;
      } catch {
        return;
      }
      if (files.length === 0) return;
      // Stop the browser from opening / navigating to the dropped file.
      event.preventDefault();
      addFiles(files);
    },
    [addFiles],
  );

  const removeAttachment = useCallback((id: string) => {
    const current = attachmentsRef.current;
    const target = current.find((a) => a.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
      createdUrlsRef.current.delete(target.previewUrl);
    }
    onChangeRef.current(current.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    for (const attachment of attachmentsRef.current) {
      if (attachment.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
        createdUrlsRef.current.delete(attachment.previewUrl);
      }
    }
    onChangeRef.current([]);
  }, []);

  const clearErrors = useCallback(() => setErrors([]), []);

  // Reconcile object URLs with the controlled list: revoke any URL we created
  // that is no longer present (covers parent-driven removals we didn't route).
  useEffect(() => {
    const live = new Set<string>();
    for (const attachment of attachments) {
      if (attachment.previewUrl) live.add(attachment.previewUrl);
    }
    for (const url of createdUrlsRef.current) {
      if (!live.has(url)) {
        URL.revokeObjectURL(url);
        createdUrlsRef.current.delete(url);
      }
    }
  }, [attachments]);

  // Final cleanup: revoke everything still outstanding on unmount.
  useEffect(() => {
    const created = createdUrlsRef.current;
    return () => {
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
  }, []);

  return {
    onPaste,
    onDrop,
    onDragOver,
    onDragEnter,
    onDragLeave,
    isDragActive,
    addFiles,
    removeAttachment,
    clearAttachments,
    errors,
    clearErrors,
  };
}
