// Shared chat messaging-interaction types. Used by User, Merchant, and
// Compliance chat surfaces so the reply logic is written once, not per-surface.

export type ChatActorType = 'user' | 'merchant' | 'compliance' | 'system';

/**
 * UI-side reply reference. Mirrors the server `ReplyReferenceSnapshot`
 * (built in sendMessage, stored in `chat_messages.metadata.replyTo`), so the
 * quoted block renders even if the original is paginated out or soft-deleted.
 */
export interface ReplyReference {
  /** id of the original message being referenced. */
  id: string;
  senderType: ChatActorType;
  senderName: string | null;
  /** Original message_type, e.g. 'text' | 'image' | 'video' | 'audio' | 'file'. */
  kind: string;
  /** One-line preview ('Photo', a filename, or truncated text). */
  preview: string;
}

/** What the reply composer shows while a reply is being drafted. */
export interface ReplyDraft {
  /** id of the message being replied to. */
  id: string;
  senderType: ChatActorType;
  senderName: string | null;
  kind: string;
  preview: string;
  /** Was the original message sent by the current actor? (affects copy). */
  isMe: boolean;
}

/**
 * Per-message action permissions. The single object that lets one set of
 * components serve every actor without branching in the UI. v1 uses canReply +
 * canCopy; edit/delete/select are scaffolded for later phases.
 */
export interface MessagePermissions {
  canReply: boolean;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canSelect: boolean;
}
