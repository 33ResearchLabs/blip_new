'use client';

/**
 * useIssueReporter — state + submission for the manual issue-report modal.
 *
 * Owns:
 *   - open/close state (so any component can trigger the modal)
 *   - screenshot capture (delegates to errorTracking/screenshot.ts which
 *     already handles sensitive-field masking and rate limits)
 *   - form submission with retry-on-network-failure
 *   - auto-collected metadata (route, viewport, userAgent, timestamp)
 *
 * Consumed by:
 *   - <IssueReporter /> — the floating-button + modal UI
 *   - Any place that wants to programmatically open the reporter (e.g.
 *     a post-API-error toast offering "Report this").
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  captureRegionScreenshot,
  captureReportScreenshot,
  type CaptureRegion,
} from '@/lib/issueReporter/screenshot';

export type IssueCategory =
  | 'ui_bug'
  | 'backend'
  | 'payment'
  | 'performance'
  | 'other';

export const ISSUE_CATEGORIES: Array<{ value: IssueCategory; label: string }> = [
  { value: 'ui_bug', label: 'UI Bug' },
  { value: 'backend', label: 'Backend Issue' },
  { value: 'payment', label: 'Payment Issue' },
  { value: 'performance', label: 'Performance' },
  { value: 'other', label: 'Other' },
];

export interface AttachmentInput {
  name: string;
  dataUrl: string;
  mime: string;
  size: number;
}

// One entry in the multi-screenshot list. `dataUrl` is the version we
// upload — for annotated shots that's the annotated PNG, otherwise it's
// the raw source. `type` discriminates in-app captures from manual file
// uploads so the server (and admin UI) can render them differently.
export interface ScreenshotInput {
  dataUrl: string;
  type: 'screenshot' | 'upload';
  mime?: string;
  size_bytes?: number;
}

export interface SubmitInput {
  title: string;
  category: IssueCategory;
  description: string;
  // Legacy single-shot field. Kept so older callers (and any external
  // integrations) don't break. When `screenshots` is also supplied it
  // wins; this field is ignored.
  screenshotDataUrl: string | null;
  // v2 multi-shot list. Optional — when omitted the hook falls back to
  // sending `screenshotDataUrl` under the legacy `screenshot` field.
  screenshots?: ScreenshotInput[];
  attachments: AttachmentInput[];
}

export interface SubmitResult {
  ok: boolean;
  issueId?: string;
  error?: string;
}

function collectMetadata(): Record<string, unknown> {
  if (typeof window === 'undefined') return {};
  return {
    route: window.location.pathname,
    url: window.location.href,
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    timestamp: Date.now(),
    theme:
      (document.documentElement.getAttribute('data-theme') || 'dark').toLowerCase(),
    language: navigator.language,
  };
}

export function useIssueReporter({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capturingShot, setCapturingShot] = useState(false);
  const [initialShot, setInitialShot] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (submitting) return; // don't close mid-submit
    setIsOpen(false);
    setInitialShot(null);
    setCaptureError(null);
  }, [submitting]);

  /**
   * Low-level capture (used for Retake inside the modal). Hides the
   * reporter modal first so it doesn't land in the shot, then restores.
   *
   * When `region` is supplied, the full-page capture is cropped to
   * that rectangle (document-space CSS pixels). Caller is responsible
   * for dismissing any region-picker UI *before* calling this so the
   * selector overlay doesn't appear in the capture.
   */
  const captureScreenshot = useCallback(
    async (region?: CaptureRegion): Promise<string | null> => {
      console.log('[IssueReporter/hook] captureScreenshot called', { region });
      setCapturingShot(true);
      setCaptureError(null);
      const modalRoot = document.querySelector<HTMLElement>(
        '[data-issue-reporter-root]',
      );
      const prevVisibility = modalRoot?.style.visibility;
      if (modalRoot) modalRoot.style.visibility = 'hidden';
      // Two animation frames so the visibility change actually paints
      // before html2canvas reads the DOM.
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      try {
        const result = region
          ? await captureRegionScreenshot(region)
          : await captureReportScreenshot();
        console.log('[IssueReporter/hook] capture result', {
          ok: result.ok,
          reason: result.reason,
          detail: result.detail,
          size: result.dataUrl?.length,
        });
        if (result.ok && result.dataUrl) return result.dataUrl;
        setCaptureError(
          result.detail ||
            result.reason ||
            'Screenshot capture failed — you can still submit without one',
        );
        return null;
      } catch (e) {
        console.error('[IssueReporter/hook] capture threw', e);
        setCaptureError((e as Error).message || 'Screenshot capture failed');
        return null;
      } finally {
        if (modalRoot) modalRoot.style.visibility = prevVisibility || '';
        setCapturingShot(false);
      }
    },
    [],
  );

  /**
   * Open the reporter. Mount the modal IMMEDIATELY so the user can
   * start typing title/description while the screenshot renders in
   * the background. The screenshot area already has a "Capturing…"
   * spinner state that surfaces the async work.
   *
   * We hide the modal via `visibility: hidden` for the duration of the
   * capture so it never leaks into the snapshot — the same technique
   * Retake uses. `captureReportScreenshot` also strips any element
   * with `data-issue-reporter-root` / `data-issue-reporter-trigger`
   * from html-to-image's filter as a belt-and-braces safety net.
   */
  const open = useCallback(async (): Promise<void> => {
    if (isOpen) return;
    setInitialShot(null);
    setCaptureError(null);
    setCapturingShot(true);
    setIsOpen(true);

    // One frame so the modal actually mounts before we hide it — if we
    // hid it before mount, querySelector below would miss the node.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const modalRoot = document.querySelector<HTMLElement>(
      '[data-issue-reporter-root]',
    );
    const prevVisibility = modalRoot?.style.visibility;
    if (modalRoot) modalRoot.style.visibility = 'hidden';
    // One more frame so the visibility change paints before capture.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    try {
      const result = await captureReportScreenshot();
      console.log('[IssueReporter/hook] open-time capture', {
        ok: result.ok,
        reason: result.reason,
        size: result.dataUrl?.length,
      });
      if (result.ok && result.dataUrl) {
        setInitialShot(result.dataUrl);
      } else {
        setCaptureError(
          result.detail ||
            result.reason ||
            'Screenshot capture failed — you can still submit without one',
        );
      }
    } catch (e) {
      console.error('[IssueReporter/hook] open-time capture threw', e);
      setCaptureError((e as Error).message || 'Screenshot capture failed');
    } finally {
      if (modalRoot) modalRoot.style.visibility = prevVisibility || '';
      setCapturingShot(false);
    }
  }, [isOpen]);

  // Keyboard shortcut: Ctrl+Shift+I (or Cmd+Shift+I on Mac)
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'i') {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        void open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, enabled]);

  /**
   * Submit the issue. Performs one retry on network failure. Returns a
   * result object — the caller decides how to surface success/failure
   * (toast, inline banner, etc.).
   */
  const submit = useCallback(async (input: SubmitInput): Promise<SubmitResult> => {
    setSubmitting(true);
    // Prefer the v2 screenshots[] field. Only emit the legacy single
    // `screenshot` when the caller hasn't migrated. The server accepts
    // both shapes — see /api/issues/create.
    const useMultiShot = Array.isArray(input.screenshots) && input.screenshots.length > 0;
    const payload: Record<string, unknown> = {
      title: input.title,
      category: input.category,
      description: input.description,
      attachments: input.attachments.map((a) => ({
        name: a.name,
        dataUrl: a.dataUrl,
      })),
      metadata: collectMetadata(),
    };
    if (useMultiShot) {
      payload.screenshots = input.screenshots!.map((s) => ({
        dataUrl: s.dataUrl,
        type: s.type,
        ...(s.mime ? { mime: s.mime } : {}),
        ...(typeof s.size_bytes === 'number' ? { size_bytes: s.size_bytes } : {}),
      }));
    } else if (input.screenshotDataUrl) {
      payload.screenshot = input.screenshotDataUrl;
    }
    const body = JSON.stringify(payload);

    const doFetch = async () => {
      // Include auth token if the app has stored one — harmless when absent.
      const token =
        typeof window !== 'undefined'
          ? localStorage.getItem('blip_access_token') ||
            localStorage.getItem('blip_merchant_token') ||
            ''
          : '';
      return fetch('/api/issues/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        credentials: 'same-origin',
      });
    };

    try {
      let res: Response;
      try {
        res = await doFetch();
      } catch {
        // One retry on network error.
        res = await doFetch();
      }
      if (res.status === 204) {
        // Feature flag off — treat as success so user isn't shown a scary error
        return { ok: true, issueId: undefined };
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        return { ok: true, issueId: data.data?.id };
      }
      return {
        ok: false,
        error: data?.error || `Failed (HTTP ${res.status})`,
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'Network error' };
    } finally {
      setSubmitting(false);
    }
  }, []);

  return useMemo(
    () => ({
      isOpen,
      submitting,
      capturingShot,
      captureError,
      initialShot,
      open,
      close,
      captureScreenshot,
      submit,
    }),
    [
      isOpen,
      submitting,
      capturingShot,
      captureError,
      initialShot,
      open,
      close,
      captureScreenshot,
      submit,
    ],
  );
}
