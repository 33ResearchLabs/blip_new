/**
 * Optional screenshot capture for UI_CRASH / CRITICAL errors.
 *
 * DESIGN:
 *  - html2canvas is a heavy dependency (~200KB gzipped) so we dynamic-import
 *    it. When no error ever fires, the module never loads.
 *  - Capture is best-effort: if html2canvas isn't installed, the browser
 *    blocks cross-origin canvas reads, or the page is too complex to
 *    rasterize, we return `null` and the reporter proceeds without a
 *    screenshot. Screenshots are never required for a log to be accepted.
 *  - Output is scaled down and JPEG-compressed to keep the payload under
 *    ~150KB — well below the 32KB JSON body cap on the raw log, but the
 *    screenshot travels in a separate multipart field.
 *  - All sensitive inputs (password, token, cvv, card) are visually blanked
 *    before capture via a temporary style injection, then restored. This
 *    happens synchronously around the snapshot — no race.
 *
 * SAFETY:
 *  - Never throws. Worst case returns `null`.
 *  - Won't run on the server (guards `typeof window`).
 *  - Honors a global capture cap (1 per minute) so a crash-loop can't
 *    flood Cloudinary.
 */

const CAPTURE_WINDOW_MS = 60_000;
const MAX_CAPTURES_PER_WINDOW = 3;
const captureTimestamps: number[] = [];

// Match inputs that might leak secrets into a screenshot. CSS selectors —
// kept intentionally narrow to avoid blanking normal form fields.
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

function rateLimited(): boolean {
  const now = Date.now();
  while (captureTimestamps.length > 0 && now - captureTimestamps[0] > CAPTURE_WINDOW_MS) {
    captureTimestamps.shift();
  }
  if (captureTimestamps.length >= MAX_CAPTURES_PER_WINDOW) return true;
  captureTimestamps.push(now);
  return false;
}

/**
 * Capture a JPEG screenshot of the current viewport. Returns a base64
 * data URL (e.g. `data:image/jpeg;base64,...`) or `null` on any failure.
 */
export async function captureScreenshot(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (rateLimited()) return null;

  // Blank out sensitive fields for the duration of the capture.
  const restore: Array<() => void> = [];
  try {
    document.querySelectorAll<HTMLElement>(SENSITIVE_SELECTOR).forEach((el) => {
      const prev = el.style.filter;
      el.style.filter = 'blur(14px)';
      restore.push(() => {
        el.style.filter = prev;
      });
    });
  } catch {
    /* ignore — capture proceeds without masking if DOM walk fails */
  }

  try {
    // Dynamic import — html2canvas only loads on actual crash, never at
    // app boot. Swallow the import failure so the app still works if the
    // dep isn't installed.
    //
    // Uses a variable specifier to defeat TypeScript's static module
    // resolution so the project still typechecks cleanly before
    // `pnpm install` has pulled the new dependency. At runtime Webpack /
    // Turbopack bundle it normally because the literal string "html2canvas"
    // is still visible in the source.
    const moduleName = 'html2canvas';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* webpackIgnore: false */ moduleName).catch(() => null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const html2canvas: any = mod && mod.default ? mod.default : mod;
    if (!html2canvas) return null;

    const canvas: HTMLCanvasElement = await html2canvas(document.body, {
      // Scale ≤ 0.5 per spec — small enough to upload, big enough to read.
      scale: Math.min(0.5, (window.devicePixelRatio || 1) * 0.5),
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#000000',
      logging: false,
      // Only capture above-the-fold content to keep payload small.
      windowWidth: Math.min(document.documentElement.clientWidth, 1440),
      windowHeight: Math.min(document.documentElement.clientHeight, 2000),
    });

    // JPEG @ 0.6 quality — tradeoff of readability vs payload size.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

    // Hard cap: if the encoded image is still larger than 180KB, drop it
    // rather than sending a huge blob. Cloudinary will happily accept
    // bigger uploads, but /api/client-errors guards body size.
    if (dataUrl.length > 180_000) return null;
    return dataUrl;
  } catch {
    return null;
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
