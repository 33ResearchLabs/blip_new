// Homegrown lightweight device fingerprint. Captures the components most
// useful for multi-account detection + bot identification, without pulling
// in a 30KB external SDK. Runs entirely in the browser; the resulting
// `{visitor_id, components}` payload is sent to /api/auth/* on register.
//
// Components captured:
//   * canvas_fp      — sha1 of a deterministic canvas rendering
//   * webgl_renderer — GPU string ("ANGLE (Intel...)") — strong hardware signal
//   * webgl_vendor   — graphics vendor
//   * screen         — width × height × colour depth
//   * hardware       — concurrency + memory
//   * platform       — navigator.platform / userAgentData.platform
//   * languages      — full language list
//   * plugins        — names of all plugins (empty array is itself a signal)
//   * timezone       — Intl resolved timezone (e.g. 'America/New_York')
//   * webdriver      — navigator.webdriver flag (CDP / Puppeteer give true)
//   * ua             — full user-agent string
//   * fonts          — sample-detected presence of 12 common system fonts
//
// SSR-safe: every API access is guarded so `import`ing this module from a
// 'use client' boundary doesn't crash during prerender. All entry points
// return null when called server-side.

const SAMPLE_FONTS = [
  'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Comic Sans MS',
  'Trebuchet MS', 'Georgia', 'Impact', 'Tahoma', 'Helvetica',
  'Calibri', 'Segoe UI',
];

export interface FingerprintComponents {
  canvas_fp: string;
  webgl_renderer: string | null;
  webgl_vendor: string | null;
  screen: string;
  hardware: string;
  platform: string;
  languages: string[];
  plugins: string[];
  timezone: string | null;
  webdriver: boolean;
  ua: string;
  fonts: string[];
}

export interface FingerprintPayload {
  visitor_id: string;
  components: FingerprintComponents;
}

const CACHE_KEY = '__blip_threat_fp_cache';
let cached: Promise<FingerprintPayload | null> | null = null;

/**
 * Collect a fingerprint. Memoised — multiple callers within a session share
 * the same result. Returns null in SSR or if collection fails entirely
 * (which it shouldn't on any real browser).
 */
export function collectFingerprint(): Promise<FingerprintPayload | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (cached) return cached;

  // Read sessionStorage cache first — same tab + reload should reuse.
  try {
    const stored = window.sessionStorage.getItem(CACHE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as FingerprintPayload;
      if (parsed?.visitor_id && parsed?.components) {
        cached = Promise.resolve(parsed);
        return cached;
      }
    }
  } catch {/* sessionStorage might be unavailable; ignore */}

  cached = computeFingerprint();
  return cached;
}

async function computeFingerprint(): Promise<FingerprintPayload | null> {
  try {
    const components = await gatherComponents();
    const visitor_id = await shortHash(components);
    const payload: FingerprintPayload = { visitor_id, components };
    try {
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {/* ignore */}
    return payload;
  } catch (err) {
    console.warn('[threat/clientFingerprint] collection failed', err);
    return null;
  }
}

async function gatherComponents(): Promise<FingerprintComponents> {
  return {
    canvas_fp: getCanvasFingerprint(),
    ...getWebGLFingerprint(),
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    hardware: `cc:${navigator.hardwareConcurrency ?? 0};mem:${(navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0}`,
    platform: navigator.platform || '',
    languages: Array.from(navigator.languages ?? [navigator.language ?? 'unknown']),
    plugins: Array.from(navigator.plugins ?? []).map(p => p.name),
    timezone: getTimezone(),
    webdriver: navigator.webdriver === true,
    ua: navigator.userAgent || '',
    fonts: detectFonts(),
  };
}

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-ctx';
    // Mixed text + shape forces antialiasing / font-rendering differences
    // across GPUs and font hinting engines.
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('blip-money:fp,ðé±.', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('blip-money:fp,ðé±.', 4, 17);
    const dataUrl = canvas.toDataURL();
    // Detect "flat" canvas (Selenium / VM headless): the data-URL is
    // essentially solid colour with no antialiasing variance. The signature
    // for that is a very short data-URL (<200 chars after the base64 header).
    if (dataUrl.length < 200) return `flat:${dataUrl.length}`;
    return shortSyncHash(dataUrl);
  } catch {
    return 'err';
  }
}

function getWebGLFingerprint(): { webgl_renderer: string | null; webgl_vendor: string | null } {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null
      || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    if (!gl) return { webgl_renderer: null, webgl_vendor: null };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string : null;
    const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) as string : null;
    return { webgl_renderer: renderer ?? null, webgl_vendor: vendor ?? null };
  } catch {
    return { webgl_renderer: null, webgl_vendor: null };
  }
}

function getTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Lightweight font detection. Renders a sample string with each font and
 * compares its bounding-box width against the same string rendered with a
 * fallback. Different width = font is installed.
 */
function detectFonts(): string[] {
  try {
    const test = 'mmmmmmmmlli';
    const baseFont = 'monospace';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.font = `72px ${baseFont}`;
    const baseWidth = ctx.measureText(test).width;
    const detected: string[] = [];
    for (const font of SAMPLE_FONTS) {
      ctx.font = `72px '${font}', ${baseFont}`;
      if (Math.abs(ctx.measureText(test).width - baseWidth) > 0.5) {
        detected.push(font);
      }
    }
    return detected;
  } catch {
    return [];
  }
}

/** SHA-256 of canonical-JSON components, hex-encoded, prefix-12. */
async function shortHash(components: FingerprintComponents): Promise<string> {
  const canonical = canonicalize(components as unknown as Record<string, unknown>);
  try {
    const buf = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest('SHA-256', buf as BufferSource);
    const hex = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hex.slice(0, 16);
  } catch {
    return shortSyncHash(canonical).slice(0, 16);
  }
}

/** djb2 — small synchronous fallback when SubtleCrypto unavailable. */
function shortSyncHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  // Convert to unsigned hex.
  return ((h >>> 0).toString(16)).padStart(8, '0');
}

function canonicalize(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = (obj as Record<string, unknown>)[k];
  return JSON.stringify(ordered);
}
