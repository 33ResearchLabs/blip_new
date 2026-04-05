/**
 * Device Fingerprint Utility (Client-side)
 *
 * Generates a SHA-256 hash of browser attributes to create a stable device_id.
 * No external libraries required — uses Web Crypto API.
 *
 * Usage:
 *   import { getDeviceId, getDeviceMetadata } from '@/lib/device/fingerprint';
 *   const deviceId = await getDeviceId();
 */

export interface DeviceMetadata {
  userAgent: string;
  platform: string;
  screenResolution: string;
  timezone: string;
  language: string;
  cpuCores: number | null;
  deviceMemory: number | null;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  browserName: string;
  osName: string;
}

/**
 * Collect device metadata from the browser.
 */
export function getDeviceMetadata(): DeviceMetadata {
  const ua = navigator.userAgent;

  return {
    userAgent: ua,
    platform: navigator.platform || 'unknown',
    screenResolution: `${screen.width}x${screen.height}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    cpuCores: navigator.hardwareConcurrency || null,
    deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory || null,
    deviceType: detectDeviceType(ua),
    browserName: detectBrowser(ua),
    osName: detectOS(ua),
  };
}

/**
 * Generate a stable device fingerprint hash (SHA-256).
 * Uses: userAgent + platform + screen + timezone + language
 */
export async function getDeviceId(): Promise<string> {
  const meta = getDeviceMetadata();

  const raw = [
    meta.userAgent,
    meta.platform,
    meta.screenResolution,
    meta.timezone,
    meta.language,
  ].join('|');

  const encoder = new TextEncoder();
  const data = encoder.encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get device_id and metadata together (for sending to backend).
 */
export async function getDeviceInfo(): Promise<{
  deviceId: string;
  metadata: DeviceMetadata;
}> {
  const metadata = getDeviceMetadata();
  const deviceId = await getDeviceId();
  return { deviceId, metadata };
}

// ── Detection helpers ─────────────────────────────────────────────────────

function detectDeviceType(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet';
  if (/Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function detectBrowser(ua: string): string {
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('OPR/') || ua.includes('Opera/')) return 'Opera';
  if (ua.includes('Chrome/') && !ua.includes('Edg/')) return 'Chrome';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  return 'Unknown';
}

function detectOS(ua: string): string {
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macOS';
  if (ua.includes('Linux') && !ua.includes('Android')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  return 'Unknown';
}
