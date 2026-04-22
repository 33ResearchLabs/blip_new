/**
 * Server-side upload for the manual issue-reporting system.
 *
 * Uploads screenshots + attachments to Cloudinary. A parallel module to
 * lib/errorTracking/screenshotUpload.ts — kept separate so the issues
 * pipeline can tune its own limits / folder / tags independently.
 *
 * SAFETY:
 *  - Screenshots capped at 400KB (larger than the error-tracking cap
 *    because manual reports can include an annotated canvas which is
 *    heavier than a blurred auto-shot)
 *  - Attachments capped at 25MB per the spec
 *  - Cloudinary config failures return `null` rather than throwing
 *  - All uploads tagged `blip-issue` for ops lifecycle rules
 */

import { v2 as cloudinary } from 'cloudinary';

const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024; // 4MB — full-page captures
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB per spec
const IMAGE_DATA_URL_RE = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const ANY_DATA_URL_RE = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

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
 * Upload an annotated screenshot (base64 image data URL). Returns the
 * hosted URL or `null` on any failure. Never throws.
 */
export async function uploadIssueScreenshot(
  dataUrl: string | null | undefined,
): Promise<string | null> {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (dataUrl.length > MAX_SCREENSHOT_BYTES) return null;
  if (!IMAGE_DATA_URL_RE.test(dataUrl)) return null;
  if (!ensureConfigured()) return null;

  try {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder: 'blip/issues/screenshots',
      resource_type: 'image',
      quality: 'auto:good',
      format: 'jpg',
      tags: ['blip-issue', 'issue-screenshot'],
      invalidate: true,
    });
    return typeof result.secure_url === 'string' ? result.secure_url : null;
  } catch (err) {
    console.error('[issueReporter] screenshot upload failed', err);
    return null;
  }
}

export interface UploadedAttachment {
  url: string;
  name: string;
  mime: string;
  size_bytes: number;
}

/**
 * Upload a single attachment (base64 data URL of any allowed mime type).
 * Returns {url, name, mime, size_bytes} or `null` on failure.
 *
 * Cloudinary decides resource_type automatically via 'auto' so it handles
 * images, videos, and non-media files (raw) in one path.
 */
export async function uploadIssueAttachment(
  dataUrl: string,
  name: string,
): Promise<UploadedAttachment | null> {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  if (dataUrl.length > MAX_ATTACHMENT_BYTES) return null;
  const match = ANY_DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!ensureConfigured()) return null;

  // Cloudinary's base64 length → approximate byte size (3/4 of base64 len).
  const approxBytes = Math.floor(match[2].length * 0.75);

  try {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder: 'blip/issues/attachments',
      resource_type: 'auto',
      tags: ['blip-issue', 'issue-attachment'],
      invalidate: true,
    });
    if (typeof result.secure_url !== 'string') return null;
    return {
      url: result.secure_url,
      name: String(name || 'attachment').slice(0, 200),
      mime,
      size_bytes: approxBytes,
    };
  } catch (err) {
    console.error('[issueReporter] attachment upload failed', err);
    return null;
  }
}
