import type { MessagePermissions } from './types';

export interface PermissionInput {
  /** Was this message sent by the current actor? */
  isMe: boolean;
  /** Is this a plain-text message? (copy + future edit only apply to text) */
  isText: boolean;
  /** System / event message — no interactions. */
  isSystem: boolean;
  /** Already soft-deleted — no interactions. */
  isDeleted?: boolean;
  /** Can the current actor send in this order right now? (chat availability) */
  canSendNow: boolean;
  /** Order is in dispute / chat frozen — delete is locked (evidence). */
  orderDisputed?: boolean;
}

/**
 * Compute per-message permissions. One place, used by every surface. v1 only
 * needs `canReply` (gated by whether the actor can currently send) and
 * `canCopy` (text only). Edit/delete/select are scaffolded for later phases —
 * delete already honors the "locked once disputed" decision.
 */
export function getMessagePermissions(input: PermissionInput): MessagePermissions {
  if (input.isSystem || input.isDeleted) {
    return { canReply: false, canCopy: false, canEdit: false, canDelete: false, canSelect: false };
  }
  return {
    canReply: input.canSendNow,
    canCopy: input.isText,
    // Later phases:
    canEdit: input.isMe && input.isText && input.canSendNow,
    canDelete: input.isMe && input.canSendNow && !input.orderDisputed,
    canSelect: true,
  };
}
