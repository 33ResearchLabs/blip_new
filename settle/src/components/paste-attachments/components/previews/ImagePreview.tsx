import type { AttachmentPreviewProps } from '../../types';

/** Thumbnail preview for an image attachment (fills its card, cover-cropped). */
export function ImagePreview({ attachment }: AttachmentPreviewProps) {
  return (
    // Object-URL blobs must use a plain <img>: next/image can't optimise blob: URLs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attachment.previewUrl}
      alt={attachment.name}
      loading="lazy"
      decoding="async"
      draggable={false}
      className="h-full w-full object-cover"
    />
  );
}
