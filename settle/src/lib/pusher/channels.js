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
    ALL_MERCHANTS: 'private-merchants-global', // Global channel for all merchants
};
/**
 * Get the private channel for a user
 */
export function getUserChannel(userId) {
    return `${CHANNEL_PREFIX.USER}${userId}`;
}
/**
 * Get the private channel for a merchant
 */
export function getMerchantChannel(merchantId) {
    return `${CHANNEL_PREFIX.MERCHANT}${merchantId}`;
}
/**
 * Get the global channel for ALL merchants (for broadcasting new orders)
 */
export function getAllMerchantsChannel() {
    return CHANNEL_PREFIX.ALL_MERCHANTS;
}
/**
 * Get the private channel for an order (messages + status updates)
 */
export function getOrderChannel(orderId) {
    return `${CHANNEL_PREFIX.ORDER}${orderId}`;
}
/**
 * Get the presence channel for an order (shows who's online)
 */
export function getOrderPresenceChannel(orderId) {
    return `${CHANNEL_PREFIX.PRESENCE_ORDER}${orderId}`;
}
/**
 * Parse channel name to extract type and ID
 */
export function parseChannelName(channelName) {
    // Check for global merchants channel FIRST (before individual merchant channel)
    if (channelName === CHANNEL_PREFIX.ALL_MERCHANTS) {
        return { type: 'merchants-global', id: null };
    }
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
export function isPrivateChannel(channelName) {
    return channelName.startsWith('private-');
}
/**
 * Check if a channel name is a presence channel
 */
export function isPresenceChannel(channelName) {
    return channelName.startsWith('presence-');
}
