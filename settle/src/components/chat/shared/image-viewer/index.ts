// Shared Telegram-style chat image viewer. One implementation consumed by
// User, Merchant, and Compliance chat surfaces.

export { ChatImageViewer } from './ChatImageViewer';
export {
  ImageViewerProvider,
  useImageViewer,
  useImageViewerOptional,
} from './ImageViewerProvider';
export type { ViewerImage } from './ChatImageViewer';
