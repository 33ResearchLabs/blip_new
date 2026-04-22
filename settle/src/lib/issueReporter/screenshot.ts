'use client';

/**
 * Screenshot capture for the manual issue reporter.
 *
 * Why a separate module from errorTracking/screenshot.ts:
 *   The error-tracking version is tuned for crash telemetry — it drops
 *   the shot if the page is too large (to protect the ingest endpoint)
 *   and rate-limits to 3/min (to survive crash loops). Those are wrong
 *   policies for a human clicking "Report Issue" deliberately:
 *     - Humans rarely click faster than 1/10s; the rate-limit false-
 *       positives on re-captures after closing the modal.
 *     - Oversized dashboards should still produce *some* shot — compress
 *       harder, don't drop.
 *     - Failures should surface *why* so the user can retry sensibly.
 *
 * SAFETY:
 *   - Never throws. Returns { ok: false, reason } instead of null alone.
 *   - Honors a looser rate limit (10/min) to defeat the obvious button-
 *     spam case without punishing normal use.
 *   - Sensitive inputs (password/OTP/CVV/etc.) are blurred identically to
 *     the auto-error capture.
 *   - Won't run on the server (guards `typeof window`).
 */

const CAPTURE_WINDOW_MS = 60_000;
const MAX_CAPTURES_PER_WINDOW = 10;
const captureTimestamps: number[] = [];

// Same sensitive-field matcher as the auto-error capture. Kept local
// (rather than imported) so this module has no cross-dependency on the
// error-tracking pipeline.
const SENSITIVE_SELECTOR = [
  'input[type="password"]',
  'input[name*="password" i]',
  'input[name*="token" i]',
  'input[name*="secret" i]',
  'input[name*="otp" i]',
  'input[name*="pin" i]',
  'input[name*="cvv" i]',
  'input[name*="cvc" i]',
  'input[name*="card" i]',
  'input[autocomplete="cc-number"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="one-time-code"]',
  '[data-sensitive="true"]',
].join(',');

// Target max size for the final data URL. Full-page captures at full
// DPR are much larger than a viewport snapshot — raised budget so we
// don't discard a legitimately tall page. The server-side cap was
// bumped in upload.ts to match.
const TARGET_MAX_BYTES = 3_500 * 1024; // 3.5MB
const MIN_QUALITY = 0.25;

export interface CaptureResult {
  ok: boolean;
  dataUrl?: string;
  reason?:
    | 'rate_limited'
    | 'html2canvas_missing'
    | 'tainted_canvas'
    | 'too_large'
    | 'unknown';
  detail?: string;
}

function rateLimited(): boolean {
  const now = Date.now();
  while (
    captureTimestamps.length > 0 &&
    now - captureTimestamps[0] > CAPTURE_WINDOW_MS
  ) {
    captureTimestamps.shift();
  }
  if (captureTimestamps.length >= MAX_CAPTURES_PER_WINDOW) return true;
  captureTimestamps.push(now);
  return false;
}

const DEBUG = true;
const log = (...args: unknown[]) => {
  if (DEBUG) console.log('[IssueReporter/screenshot]', ...args);
};

export async function captureReportScreenshot(): Promise<CaptureResult> {
  log('capture start');
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { ok: false, reason: 'unknown', detail: 'not in browser' };
  }
  if (rateLimited()) {
    log('rate limited');
    return {
      ok: false,
      reason: 'rate_limited',
      detail: 'Too many captures in the last minute — wait a moment and retry',
    };
  }

  // Blur sensitive inputs for the duration of the capture.
  const restore: Array<() => void> = [];
  try {
    document
      .querySelectorAll<HTMLElement>(SENSITIVE_SELECTOR)
      .forEach((el) => {
        const prev = el.style.filter;
        el.style.filter = 'blur(14px)';
        restore.push(() => {
          el.style.filter = prev;
        });
      });
  } catch {
    /* best-effort masking only */
  }

  // Hoisted so both html-to-image (primary) and html2canvas-pro
  // (fallback) can see these. Any transform/zoom on <html>/<body> is
  // neutralised for the duration of the capture so ancestor scale()
  // rules don't distort the snapshot (the spec requires this).
  const html = document.documentElement;
  const body = document.body;
  const savedHtmlTransform = html.style.transform;
  const savedHtmlZoom = (html.style as unknown as { zoom?: string }).zoom;
  const savedBodyTransform = body.style.transform;
  const savedBodyZoom = (body.style as unknown as { zoom?: string }).zoom;
  html.style.transform = 'none';
  (html.style as unknown as { zoom?: string }).zoom = '1';
  body.style.transform = 'none';
  (body.style as unknown as { zoom?: string }).zoom = '1';

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scrollWidth = html.scrollWidth;
  const scrollHeight = html.scrollHeight;

  try {
    // Two-stage capture strategy:
    //   1) Try `html-to-image` first. It uses SVG `foreignObject`
    //      serialization, which handles absolute-positioned elements,
    //      CSS Grid, transforms, and modern React layouts much more
    //      reliably than canvas-based rasterization. It also handles
    //      Tailwind v4's oklch() colors natively.
    //   2) Fall back to `html2canvas-pro` if html-to-image fails (it
    //      occasionally trips on cross-origin CSS or svg issues).
    //
    // html-to-image returns a JPEG data URL directly, so we skip the
    // canvas-compression loop below when it succeeds.
    let h2iDataUrl: string | null = null;
    try {
      log('trying html-to-image (toPng per spec)');
      const h2i = await import('html-to-image');
      // Per the capture spec, prefer toPng — PNG is lossless, produces
      // pixel-perfect dashboard captures that render crisply when
      // zoomed/annotated. If the PNG ends up over our size budget,
      // toJpeg is used as a second attempt below.
      const pngFn =
        h2i.toPng ||
        (h2i as unknown as { default?: { toPng?: typeof h2i.toPng } }).default?.toPng;
      if (typeof pngFn === 'function') {
        h2iDataUrl = await pngFn(body, {
          cacheBust: true,
          // pixelRatio: 2 → retina-quality output even on non-retina
          // displays. Spec explicitly asks for this.
          pixelRatio: Math.max(2, window.devicePixelRatio || 1),
          // Capture the FULL scrolled document, not just the viewport.
          // This is what gives us the entire desktop dashboard in one
          // shot when the page is taller than the visible area.
          width: scrollWidth,
          height: scrollHeight,
          // Explicit transform:none ensures any ancestor CSS transform
          // (e.g. a parent with scale()) doesn't shrink the rendered
          // output. Already cleared on <html>/<body> above, but
          // passing it here belt-and-braces per the spec.
          style: {
            transform: 'none',
            transformOrigin: 'top left',
          },
          backgroundColor: undefined,
          // Skip the floating Report Issue button + any modal-root
          // elements — they should never appear in the capture.
          filter: (node: HTMLElement) => {
            if (!node || !node.getAttribute) return true;
            if (node.hasAttribute && node.hasAttribute('data-issue-reporter-trigger')) return false;
            if (node.hasAttribute && node.hasAttribute('data-issue-reporter-root')) return false;
            return true;
          },
        });
        log('html-to-image PNG size (KB)', Math.round((h2iDataUrl?.length || 0) / 1024));
      }

      // PNG too big? Re-attempt with toJpeg (lossy but compact).
      if (
        h2iDataUrl &&
        h2iDataUrl.length > TARGET_MAX_BYTES * 1.2
      ) {
        log('PNG over budget — retrying with toJpeg');
        const jpegFn =
          h2i.toJpeg ||
          (h2i as unknown as { default?: { toJpeg?: typeof h2i.toJpeg } }).default?.toJpeg;
        if (typeof jpegFn === 'function') {
          h2iDataUrl = await jpegFn(body, {
            cacheBust: true,
            pixelRatio: Math.max(2, window.devicePixelRatio || 1),
            quality: 0.85,
            width: scrollWidth,
            height: scrollHeight,
            style: { transform: 'none', transformOrigin: 'top left' },
            backgroundColor: undefined,
            filter: (node: HTMLElement) => {
              if (!node || !node.getAttribute) return true;
              if (node.hasAttribute && node.hasAttribute('data-issue-reporter-trigger')) return false;
              if (node.hasAttribute && node.hasAttribute('data-issue-reporter-root')) return false;
              return true;
            },
          });
          log('html-to-image JPEG size (KB)', Math.round((h2iDataUrl?.length || 0) / 1024));
        }
      }
    } catch (err) {
      log('html-to-image failed, falling back to html2canvas-pro', err);
    }

    if (h2iDataUrl && h2iDataUrl.startsWith('data:image/')) {
      // Progressive compression if over budget. html-to-image doesn't
      // take a quality-retry loop like html2canvas does, so if the
      // first shot is too large we quietly fall through to html2canvas.
      if (h2iDataUrl.length <= TARGET_MAX_BYTES * 1.2) {
        log('capture ok (html-to-image)');
        // Restore page styles before returning.
        html.style.transform = savedHtmlTransform;
        (html.style as unknown as { zoom?: string }).zoom = savedHtmlZoom || '';
        body.style.transform = savedBodyTransform;
        (body.style as unknown as { zoom?: string }).zoom = savedBodyZoom || '';
        for (const fn of restore) {
          try { fn(); } catch { /* swallow */ }
        }
        return { ok: true, dataUrl: h2iDataUrl };
      }
      log('html-to-image output too large, falling through to html2canvas-pro for compression control');
    }

    // ── Fallback: html2canvas-pro ─────────────────────────────────
    log('importing html2canvas-pro');
    let mod: unknown = null;
    try {
      mod = await import('html2canvas-pro');
    } catch (err) {
      log('html2canvas-pro import threw', err);
      return {
        ok: false,
        reason: 'html2canvas_missing',
        detail: `html2canvas-pro import failed: ${(err as Error).message || 'unknown'} — run 'pnpm install'`,
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modAny = mod as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html2canvas: any = modAny && modAny.default ? modAny.default : modAny;
    log('html2canvas-pro resolved:', typeof html2canvas);
    if (!html2canvas || typeof html2canvas !== 'function') {
      return {
        ok: false,
        reason: 'html2canvas_missing',
        detail: `html2canvas-pro resolved to ${typeof html2canvas} (expected function)`,
      };
    }

    // Per the capture spec:
    //   - Target = document.body (NOT a constrained container)
    //   - scale = devicePixelRatio (native pixel density, no downscale)
    //   - width/height = current viewport
    //   - windowWidth/windowHeight pinned to the ACTUAL visible viewport
    //     (not scrollWidth/scrollHeight) so html2canvas doesn't re-layout
    //     the page at a width different from what the user sees.
    //   - scrollX:0, scrollY:-window.scrollY → capture the visible
    //     portion of the page starting from the current scroll
    // html/body/savedHtml{Transform,Zoom}/savedBody{Transform,Zoom}/
    // vw/vh/scrollWidth/scrollHeight are all hoisted above and shared
    // with the html-to-image path.

    log('calling html2canvas-pro', {
      target: 'body',
      viewport: `${vw}x${vh}`,
      page: `${scrollWidth}x${scrollHeight}`,
      dpr: window.devicePixelRatio,
      scroll: `${window.scrollX},${window.scrollY}`,
    });
    let canvas: HTMLCanvasElement;
    try {
      canvas = await html2canvas(body, {
        useCORS: true,
        // allowTaint:true is critical — merchant dashboards load images
        // from Cloudinary and other CDNs that may not serve CORS headers.
        allowTaint: true,
        scale: window.devicePixelRatio || 1,
        width: vw,
        height: vh,
        // windowWidth/Height MUST match the ACTUAL visible viewport
        // (not scrollWidth/scrollHeight). When scrollWidth > innerWidth
        // (e.g. a horizontally-overflowing grid somewhere on the page),
        // using scrollWidth here forces html2canvas to re-layout the
        // page at a width that's WIDER than the visible window, which
        // produces a snapshot that doesn't match what the user sees.
        // Pinning to innerWidth/innerHeight guarantees "WYSIWYG".
        windowWidth: vw,
        windowHeight: vh,
        scrollX: 0,
        scrollY: -window.scrollY,
        backgroundColor: null,
        logging: false,
      });
    } catch (err) {
      log('html2canvas threw', err);
      return {
        ok: false,
        reason: 'unknown',
        detail: `html2canvas error: ${(err as Error).message || 'unknown'}`,
      };
    } finally {
      // Always restore the inline style overrides, even on failure.
      html.style.transform = savedHtmlTransform;
      (html.style as unknown as { zoom?: string }).zoom = savedHtmlZoom || '';
      body.style.transform = savedBodyTransform;
      (body.style as unknown as { zoom?: string }).zoom = savedBodyZoom || '';
    }
    log('canvas dims', canvas?.width, canvas?.height);

    // Sanity-check the canvas actually has pixels. A 0-sized canvas
    // (or one the browser refused to allocate) would silently produce
    // an empty data URL that fabric can't display.
    if (!canvas || canvas.width < 10 || canvas.height < 10) {
      return {
        ok: false,
        reason: 'unknown',
        detail: `Canvas came back empty (${canvas?.width}x${canvas?.height})`,
      };
    }

    // Progressive compression: start at q=0.75 and step down until we fit
    // under the target byte budget, rather than dropping oversized shots.
    let quality = 0.75;
    let dataUrl = '';
    for (let i = 0; i < 6; i++) {
      try {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      } catch (err) {
        // Tainted canvas when allowTaint+useCORS still can't read pixels.
        return {
          ok: false,
          reason: 'tainted_canvas',
          detail: (err as Error).message || 'Canvas is cross-origin tainted',
        };
      }
      if (dataUrl.length <= TARGET_MAX_BYTES) break;
      quality = Math.max(MIN_QUALITY, quality - 0.1);
      if (quality === MIN_QUALITY) {
        dataUrl = canvas.toDataURL('image/jpeg', quality);
        break;
      }
    }

    log('final dataUrl size (KB)', Math.round(dataUrl.length / 1024), 'q=', quality);
    if (!dataUrl.startsWith('data:image/')) {
      return { ok: false, reason: 'unknown', detail: 'empty data URL' };
    }
    if (dataUrl.length > TARGET_MAX_BYTES * 1.2) {
      return {
        ok: false,
        reason: 'too_large',
        detail: `Screenshot still ${Math.round(dataUrl.length / 1024)}KB after compression`,
      };
    }
    log('capture ok');
    return { ok: true, dataUrl };
  } catch (err) {
    log('outer catch', err);
    return {
      ok: false,
      reason: 'unknown',
      detail: (err as Error).message || 'capture failed',
    };
  } finally {
    for (const fn of restore) {
      try {
        fn();
      } catch {
        /* swallow */
      }
    }
  }
}
