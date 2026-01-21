/**
 * Pusher Channel Helpers
 *
 * Channel naming conventions and helper functions
 */

// Channel prefixes
const CHANNEL_PREFIX = {
  USER: 'private-user-',
  MERCHANT: 'private-merchant-',
  ORDER: 'private-order-',
  PRESENCE_ORDER: 'presence-order-',
} as const;

/**
 * Get the private channel for a user
 */
export function getUserChannel(userId: string): string {
  return `${CHANNEL_PREFIX.USER}${userId}`;
}

/**
 * Get the private channel for a merchant
 */
export function getMerchantChannel(merchantId: string): string {
  return `${CHANNEL_PREFIX.MERCHANT}${merchantId}`;
}

/**
 * Get the private channel for an order (messages + status updates)
 */
export function getOrderChannel(orderId: string): string {
  return `${CHANNEL_PREFIX.ORDER}${orderId}`;
}

/**
 * Get the presence channel for an order (shows who's online)
 */
export function getOrderPresenceChannel(orderId: string): string {
  return `${CHANNEL_PREFIX.PRESENCE_ORDER}${orderId}`;
}

/**
 * Parse channel name to extract type and ID
 */
export function parseChannelName(channelName: string): {
  type: 'user' | 'merchant' | 'order' | 'presence-order' | 'unknown';
  id: string | null;
} {
  if (channelName.startsWith(CHANNEL_PREFIX.USER)) {
    return { type: 'user', id: channelName.replace(CHANNEL_PREFIX.USER, '') };
  }
  if (channelName.startsWith(CHANNEL_PREFIX.MERCHANT)) {
    return { type: 'merchant', id: channelName.replace(CHANNEL_PREFIX.MERCHANT, '') };
  }
  if (channelName.startsWith(CHANNEL_PREFIX.PRESENCE_ORDER)) {
    return { type: 'presence-order', id: channelName.replace(CHANNEL_PREFIX.PRESENCE_ORDER, '') };
  }
  if (channelName.startsWith(CHANNEL_PREFIX.ORDER)) {
    return { type: 'order', id: channelName.replace(CHANNEL_PREFIX.ORDER, '') };
  }
  return { type: 'unknown', id: null };
}

/**
 * Check if a channel name is a private channel
 */
export function isPrivateChannel(channelName: string): boolean {
  return channelName.startsWith('private-');
}

/**
 * Check if a channel name is a presence channel
 */
export function isPresenceChannel(channelName: string): boolean {
  return channelName.startsWith('presence-');
}
