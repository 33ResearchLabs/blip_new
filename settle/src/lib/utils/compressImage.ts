/**
 * Client-side image compression via Canvas API.
 *
 * - Resizes images larger than maxDimension (preserving aspect ratio)
 * - Re-encodes as JPEG at the specified quality
 * - Returns a new File object ready for upload
 *
 * No external dependencies — uses the browser's native Canvas.
 * Falls back to the original file if Canvas is unavailable or compression fails.
 */

interface CompressOptions {
  /** Max width or height in pixels. Default: 1600 */
  maxDimension?: number;
  /** JPEG quality 0-1. Default: 0.8 */
  quality?: number;
  /** Max file size in bytes. Default: 1MB */
  maxSizeBytes?: number;
}

export async function compressImage(
  file: File,
  options: CompressOptions = {},
): Promise<File> {
  const {
    maxDimension = 1600,
    quality = 0.8,
    maxSizeBytes = 1 * 1024 * 1024, // 1MB
  } = options;

  // Skip compression for small files or non-images
  if (file.size <= maxSizeBytes) return file;
  if (!file.type.startsWith('image/')) return file;

  // Skip GIFs (lossy compression would break animation)
  if (file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;

    // Calculate new dimensions (preserve aspect ratio)
    let newWidth = width;
    let newHeight = height;
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      newWidth = Math.round(width * ratio);
      newHeight = Math.round(height * ratio);
    }

    // Draw to canvas
    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file; // Canvas unavailable

    ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
    bitmap.close();

    // Encode as JPEG
    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality,
    });

    // Only use compressed version if it's actually smaller
    if (blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    // Canvas/compression failed — return original
    return file;
  }
}
