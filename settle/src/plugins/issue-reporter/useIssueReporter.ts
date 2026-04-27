'use client';

/**
 * useIssueReporter — state + submission for the manual issue-report modal.
 *
 * Owns:
 *   - open/close state (so any component can trigger the modal)
 *   - screenshot capture (delegates to ./screenshot)
 *   - form submission with one network retry
 *   - auto-collected metadata (route, viewport, userAgent, timestamp)
 *
 * Reads its endpoint, auth, and host-specific extras from the plugin's
 * config context (see ./config.tsx). Nothing here imports from the
 * host app.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  captureRegionScreenshot,
  captureReportScreenshot,
  type CaptureRegion,
} from './screenshot';
import { useIssueReporterConfig } from './config';
import type {
  IssueCategory,
  IssueSubmission,
  SubmitInput,
  SubmitResult,
} from './types';

export const ISSUE_CATEGORIES: Array<{ value: IssueCategory; label: string }> = [
  { value: 'ui_bug', label: 'UI Bug' },
  { value: 'backend', label: 'Backend Issue' },
  { value: 'payment', label: 'Payment Issue' },
  { value: 'performance', label: 'Performance' },
  { value: 'other', label: 'Other' },
];

function collectAutoMetadata(): Record<string, unknown> {
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
  enabled,
}: { enabled?: boolean } = {}) {
  const config = useIssueReporterConfig();
  // `enabled` here is a per-call override (used by the modal to gate
  // its own keyboard shortcut binding). When omitted, fall through to
  // the host-provided `authed` flag.
  const isEnabled = enabled ?? config.authed;

  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capturingShot, setCapturingShot] = useState(false);
  const [initialShot, setInitialShot] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (submitting) return;
    setIsOpen(false);
    setInitialShot(null);
    setCaptureError(null);
    config.onCancelled?.();
  }, [submitting, config]);

  /**
   * Low-level capture (used for Retake / Region inside the modal).
   * Hides the reporter modal first so it doesn't land in the shot,
   * then restores. When `region` is supplied, the full-page capture
   * is cropped to that rectangle (document-space CSS pixels).
   */
  const captureScreenshot = useCallback(
    async (region?: CaptureRegion): Promise<string | null> => {
      setCapturingShot(true);
      setCaptureError(null);
      const modalRoot = document.querySelector<HTMLElement>(
        '[data-issue-reporter-root]',
      );
      const prevVisibility = modalRoot?.style.visibility;
      if (modalRoot) modalRoot.style.visibility = 'hidden';
      // Two animation frames so the visibility change paints before
      // html-to-image walks the DOM.
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      );
      try {
        const result = region
          ? await captureRegionScreenshot(region)
          : await captureReportScreenshot();
        if (result.ok && result.dataUrl) return result.dataUrl;
        setCaptureError(
          result.detail ||
            result.reason ||
            'Screenshot capture failed — you can still submit without one',
        );
        return null;
      } catch (e) {
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
   * Open the modal AND start a pre-capture in the background. The
   * modal mounts immediately so the user can fill in title/description
   * while the shot lands. We hide the modal via visibility:hidden for
   * the duration of the capture so it never leaks into the snapshot.
   */
  const open = useCallback(async (): Promise<void> => {
    if (isOpen) return;
    setInitialShot(null);
    setCaptureError(null);
    setCapturingShot(true);
    setIsOpen(true);

    // One frame so the modal mounts before we hide it.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const modalRoot = document.querySelector<HTMLElement>(
      '[data-issue-reporter-root]',
    );
    const prevVisibility = modalRoot?.style.visibility;
    if (modalRoot) modalRoot.style.visibility = 'hidden';
    await new Promise<void>((r) => requestAnimationFrame(() => r()));

    try {
      const result = await captureReportScreenshot();
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
      setCaptureError((e as Error).message || 'Screenshot capture failed');
    } finally {
      if (modalRoot) modalRoot.style.visibility = prevVisibility || '';
      setCapturingShot(false);
    }
  }, [isOpen]);

  // Keyboard shortcut: Ctrl+Shift+I (or Cmd+Shift+I on Mac). Disabled
  // entirely when config.shortcutEnabled is false.
  useEffect(() => {
    if (!isEnabled) return;
    if (config.shortcutEnabled === false) return;
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
  }, [open, isEnabled, config.shortcutEnabled]);

  /**
   * Submit the issue. One retry on network failure. Returns a result
   * — the caller decides how to surface success/error (toast, banner).
   *
   * Transport: when the host supplies `config.submit` we delegate to
   * it (lets the host call any internal SDK / queue). Otherwise we
   * fetch() the configured `endpoint`. When neither is set we surface
   * a config error rather than silently dropping the submission.
   */
  const submit = useCallback(
    async (input: SubmitInput): Promise<SubmitResult> => {
      setSubmitting(true);
      const useMultiShot =
        Array.isArray(input.screenshots) && input.screenshots.length > 0;

      const metadata = {
        ...collectAutoMetadata(),
        ...(config.extraMetadata?.() || {}),
      };

      const payload: IssueSubmission = {
        title: input.title,
        category: input.category,
        description: input.description,
        attachments: input.attachments.map((a) => ({
          name: a.name,
          dataUrl: a.dataUrl,
        })),
        metadata,
      };
      if (useMultiShot) {
        payload.screenshots = input.screenshots!.map((s) => ({
          dataUrl: s.dataUrl,
          type: s.type,
          ...(s.mime ? { mime: s.mime } : {}),
          ...(typeof s.size_bytes === 'number'
            ? { size_bytes: s.size_bytes }
            : {}),
        }));
      } else if (input.screenshotDataUrl) {
        payload.screenshot = input.screenshotDataUrl;
      }

      try {
        let result: SubmitResult;

        if (config.submit) {
          // Host-supplied transport.
          result = await config.submit(payload);
        } else if (config.endpoint) {
          // Default fetch transport.
          result = await defaultFetchTransport(
            config.endpoint,
            payload,
            config.getAuthToken?.() || null,
          );
        } else {
          result = {
            ok: false,
            error:
              'IssueReporter is misconfigured: provide either config.endpoint or config.submit.',
          };
        }

        if (result.ok) config.onSubmitted?.(result.issueId);
        return result;
      } catch (e) {
        return { ok: false, error: (e as Error).message || 'Network error' };
      } finally {
        setSubmitting(false);
      }
    },
    [config],
  );

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

/**
 * Default fetch transport — POSTs JSON to the configured endpoint and
 * normalizes the response into a SubmitResult. Includes one retry on
 * a network-level failure (NOT on application errors, which are a
 * legitimate "the server told us no").
 */
async function defaultFetchTransport(
  endpoint: string,
  payload: IssueSubmission,
  token: string | null,
): Promise<SubmitResult> {
  const body = JSON.stringify(payload);
  const doFetch = () =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      credentials: 'same-origin',
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    res = await doFetch();
  }
  // 204 — feature flag off on the server. Treat as success so the user
  // doesn't see a scary error for a deliberate no-op.
  if (res.status === 204) return { ok: true, issueId: undefined };

  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    data?: { id?: string };
  };
  if (res.ok && data?.success) {
    return { ok: true, issueId: data.data?.id };
  }
  return { ok: false, error: data?.error || `Failed (HTTP ${res.status})` };
}
