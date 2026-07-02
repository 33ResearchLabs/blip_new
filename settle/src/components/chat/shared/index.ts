// Shared chat messaging-interaction module.
//
// One implementation of the reply behavior, consumed by User, Merchant, and
// Compliance chat. Everything here is additive: surfaces compose these around
// their existing message rendering (zero regression by construction).

export { ReplyReference } from './ReplyReference';
export { FileMessageBubble, type FileMessageBubbleProps } from './FileMessageBubble';
export { ReplyComposer } from './ReplyComposer';
export { ReplyPreview } from './ReplyPreview';
export { SwipeToReply } from './SwipeToReply';
export { useSwipeToReply, type SwipeHandlers } from './useSwipeToReply';
export { useJumpToMessage } from './useJumpToMessage';
export { getMessagePermissions, type PermissionInput } from './messagePermissions';
export type { ReplyReference as ReplyReferenceData, ReplyDraft, MessagePermissions, ChatActorType } from './types';
export {
  ChatImageViewer,
  ImageViewerProvider,
  useImageViewer,
  useImageViewerOptional,
  type ViewerImage,
} from './image-viewer';
