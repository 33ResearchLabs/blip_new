/**
 * Server-side screenshot upload for the error-tracking system.
 *
 * Accepts a base64 JPEG data URL from the client, uploads it to
 * Cloudinary under the `blip/error-screenshots` folder, and returns the
 * secure URL. Used by /api/client-errors.
 *
 * SAFETY:
 *  - Only called after feature-flag + rate-limit gates in the ingest
 *    endpoint, so floods can't reach Cloudinary.
 *  - Strict size cap: anything over 200KB is rejected before upload —
 *    both to avoid wasting Cloudinary quota and because html2canvas has
 *    already compressed to well under that.
 *  - Cloudinary config failures return `null` rather than throwing so a
 *    mis-configured env can't take the ingest endpoint down.
 *  - Uploads are tagged `error-screenshot` so they can be lifecycled
 *    (e.g. auto-delete after 30 days) from the Cloudinary console
 *    without touching app code.
 */

import { v2 as cloudinary } from 'cloudinary';

const MAX_DATA_URL_BYTES = 200 * 1024; // 200KB — JPEG @ scale=0.5 is well under
const DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const cloudName =
    process.env.CLOUDINARY_CLOUD_NAME || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) return false;
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
  configured = true;
  return true;
}

/**
 * Upload a base64 screenshot data URL. Returns the hosted URL on success
 * or `null` on any failure (bad input, oversized, Cloudinary mis-config,
 * network error). Never throws.
 */
export async function uploadScreenshot(dataUrl: string | null | undefined): Promise<string | null> {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (dataUrl.length > MAX_DATA_URL_BYTES) return null;
  if (!DATA_URL_RE.test(dataUrl)) return null;
  if (!ensureConfigured()) return null;

  try {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder: 'blip/error-screenshots',
      resource_type: 'image',
      // Cloudinary will re-encode to a sane format; we ask for
      // auto-quality so the stored size is minimized further.
      quality: 'auto:low',
      format: 'jpg',
      // Tag so ops can set lifecycle / cleanup rules from the dashboard.
      tags: ['error-screenshot'],
      // Do NOT retain original EXIF / sidecar metadata.
      invalidate: true,
    });
    return typeof result.secure_url === 'string' ? result.secure_url : null;
  } catch (err) {
    // Never bubble — logging is best-effort and must not break the page.
    console.error('[errorTracking] screenshot upload failed', err);
    return null;
  }
}
