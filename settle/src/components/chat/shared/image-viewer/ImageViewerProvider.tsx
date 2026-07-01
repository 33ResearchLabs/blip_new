'use client';

/**
 * ImageViewerProvider — one full-screen image viewer per chat surface.
 *
 * A surface wraps its message list in this provider and passes the ordered list
 * of images in the conversation. Any image bubble inside then calls
 * `useImageViewer().open(url)` (or an index) on click to launch the shared
 * Telegram-style ChatImageViewer, which uses the full list for its filmstrip and
 * prev/next navigation.
 *
 * Consumers should prefer `useImageViewerOptional()` and fall back to their own
 * behavior when no provider is present, so image bubbles stay safe if rendered
 * outside a wrapped surface.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ChatImageViewer, type ViewerImage } from './ChatImageViewer';

export type { ViewerImage } from './ChatImageViewer';

interface ImageViewerApi {
  /** Open the viewer at an image URL (found in `images`) or an explicit index. */
  open: (target: string | number) => void;
}

const ImageViewerContext = createContext<ImageViewerApi | null>(null);

export function useImageViewer(): ImageViewerApi {
  const ctx = useContext(ImageViewerContext);
  if (!ctx) {
    throw new Error('useImageViewer must be used within an ImageViewerProvider');
  }
  return ctx;
}

/** Non-throwing variant for consumers that may render outside a provider. */
export function useImageViewerOptional(): ImageViewerApi | null {
  return useContext(ImageViewerContext);
}

interface ImageViewerProviderProps {
  images: ViewerImage[];
  onForward?: (image: ViewerImage, index: number) => void;
  children: ReactNode;
}

export function ImageViewerProvider({
  images,
  onForward,
  children,
}: ImageViewerProviderProps) {
  const [index, setIndex] = useState<number | null>(null);
  // Fallback list for an image not found in `images` (e.g. an optimistic blob
  // that briefly reports "sent" before the real message lands). Single-image,
  // no filmstrip — the common path always resolves against `images`.
  const [override, setOverride] = useState<ViewerImage[] | null>(null);

  const open = useCallback(
    (target: string | number) => {
      if (typeof target === 'number') {
        if (target >= 0 && target < images.length) {
          setOverride(null);
          setIndex(target);
        }
        return;
      }
      const i = images.findIndex((im) => im.url === target);
      if (i >= 0) {
        setOverride(null);
        setIndex(i);
      } else {
        setOverride([{ url: target }]);
        setIndex(0);
      }
    },
    [images],
  );

  const close = useCallback(() => {
    setIndex(null);
    setOverride(null);
  }, []);

  const api = useMemo<ImageViewerApi>(() => ({ open }), [open]);

  const list = override ?? images;
  const isOpen = index !== null && index >= 0 && index < list.length;

  return (
    <ImageViewerContext.Provider value={api}>
      {children}
      {isOpen && (
        <ChatImageViewer
          images={list}
          index={index as number}
          onIndexChange={setIndex}
          onClose={close}
          onForward={onForward}
        />
      )}
    </ImageViewerContext.Provider>
  );
}

export default ImageViewerProvider;
