/**
 * Pusher: Real-time subscription logic + event handlers
 * Extracted from bot.js lines 442-978
 */
const PusherClient = require('pusher-js');
const { Markup } = require('telegraf');
const axios = require('axios');

const {
  API_BASE, MOCK_MODE, PUSHER_KEY, PUSHER_CLUSTER,
  sessions, pusherConnections, orderSubscriptions, merchantToTelegram,
  markOwnAction, isOwnAction, isDuplicateNotification,
} = require('./state');

const { getOrderDetails, getOrders, getMerchantBalance, getSession } = require('./api');

// Bot instance — set via setBotInstance() from bot.js on startup
let bot = null;

function setBotInstance(botInstance) {
  bot = botInstance;
}

// Display helper — use ui.js if available, otherwise inline fallback
let _getDisplayType;
try {
  const ui = require('./ui');
  _getDisplayType = ui.getDisplayType;
} catch (e) {
  // ui.js not yet extracted — inline fallback
}

function getDisplayType(order, merchantId) {
  if (_getDisplayType) return _getDisplayType(order, merchantId);
  // Fallback: same logic as bot.js getDisplayType
  if (order.buyer_merchant_id && order.buyer_merchant_id === merchantId) {
    return 'buy';
  }
  if (order.merchant_id === merchantId) {
    if (!order.buyer_merchant_id || order.buyer_merchant_id !== merchantId) {
      return 'sell';
    }
  }
  return (order.type || '').toLowerCase();
}

// ============================================================================
// PUSHER: Real-time Notifications
// ============================================================================

function subscribeToPusher(telegramId, merchantId) {
  // Disconnect existing connection if any
  if (pusherConnections.has(telegramId)) {
    const existing = pusherConnections.get(telegramId);
    try { existing.pusher.disconnect(); } catch (e) {}
  }

  try {
    const pusher = new PusherClient(PUSHER_KEY, {
      cluster: PUSHER_CLUSTER,
      channelAuthorization: {
        customHandler: async ({ channelName, socketId }, callback) => {
          try {
            console.log(`[Pusher Auth] Authenticating ${channelName} (socketId=${socketId})`);
            const formData = new URLSearchParams();
            formData.append('socket_id', socketId);
            formData.append('channel_name', channelName);

            const res = await axios.post(`${API_BASE}/pusher/auth`, formData.toString(), {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-actor-type': 'merchant',
                'x-actor-id': merchantId,
              }
            });
            console.log(`[Pusher Auth] Auth success for ${channelName}`);
            callback(null, res.data);
          } catch (err) {
            console.error(`[Pusher Auth] Auth FAILED for ${channelName}:`, err.response?.status, err.response?.data || err.message);
            callback(err, null);
          }
        }
      }
    });

    pusher.connection.bind('connected', () => {
      console.log(`[Pusher] Connected for telegramId=${telegramId} merchantId=${merchantId} socketId=${pusher.connection.socket_id}`);
      // Subscribe to chat channels for all active orders
      subscribeToActiveOrders(telegramId, merchantId);
    });

    pusher.connection.bind('error', (err) => {
      console.error(`[Pusher] Connection error for ${telegramId}:`, err);
    });

    pusher.connection.bind('state_change', (states) => {
      console.log(`[Pusher] State change for ${telegramId}: ${states.previous} -> ${states.current}`);
    });

    // Subscribe to merchant's private channel
    const merchantChannel = pusher.subscribe(`private-merchant-${merchantId}`);

    merchantChannel.bind('pusher:subscription_succeeded', () => {
      console.log(`[Pusher] Subscribed to private-merchant-${merchantId}`);
    });

    merchantChannel.bind('pusher:subscription_error', (err) => {
      console.error(`[Pusher] Subscription FAILED for private-merchant-${merchantId}:`, err);
    });

    merchantChannel.bind('order:status-updated', (data) => {
      console.log(`[Pusher] Received order:status-updated on merchant channel:`, JSON.stringify(data));
      handleOrderStatusUpdate(telegramId, merchantId, data);
    });

    merchantChannel.bind('order:cancelled', (data) => {
      console.log(`[Pusher] Received order:cancelled on merchant channel:`, JSON.stringify(data));
      handleOrderCancelled(telegramId, data);
    });

    // Subscribe to global merchants channel for new order broadcasts
    const globalChannel = pusher.subscribe('private-merchants-global');

    globalChannel.bind('pusher:subscription_succeeded', () => {
      console.log(`[Pusher] Subscribed to private-merchants-global`);
    });

    globalChannel.bind('pusher:subscription_error', (err) => {
      console.error(`[Pusher] Subscription FAILED for private-merchants-global:`, err);
    });

    globalChannel.bind('order:created', (data) => {
      console.log(`[Pusher] Received order:created on global channel:`, JSON.stringify(data));
      handleNewOrderBroadcast(telegramId, merchantId, data);
    });

    // Also listen for status updates on global channel (some events may come here)
    globalChannel.bind('order:status-updated', (data) => {
      console.log(`[Pusher] Received order:status-updated on GLOBAL channel:`, JSON.stringify(data));
      handleOrderStatusUpdate(telegramId, merchantId, data);
    });

    pusherConnections.set(telegramId, { pusher, merchantChannel, globalChannel });
    console.log(`[Pusher] Subscribed telegramId=${telegramId} to merchant & global channels`);

  } catch (err) {
    console.error(`[Pusher] Failed to subscribe telegramId=${telegramId}:`, err.message);
  }
}

function unsubscribeFromPusher(telegramId) {
  // Clean up order channel subscriptions
  orderSubscriptions.delete(telegramId);
  if (pusherConnections.has(telegramId)) {
    const conn = pusherConnections.get(telegramId);
    try { conn.pusher.disconnect(); } catch (e) {}
    pusherConnections.delete(telegramId);
    console.log(`[Pusher] Disconnected telegramId=${telegramId}`);
  }
}

// ---- Pusher Event Handlers ----

async function handleOrderStatusUpdate(telegramId, merchantId, data) {
  console.log(`[Pusher Event] order:status-updated for ${telegramId}:`, JSON.stringify(data));

  const { orderId, status, previousStatus } = data;

  if (isDuplicateNotification(telegramId, orderId, status)) return;

  // Skip notifications for actions we just performed ourselves
  if (isOwnAction(merchantId, orderId, status)) {
    console.log(`[Pusher] Skipping own-action notification for ${merchantId}:${orderId}:${status}`);
    return;
  }

  let msg = '';
  let buttons = [];

  try {
    const order = await getOrderDetails(orderId);

    const isInvolved = order.merchant_id === merchantId ||
                       order.buyer_merchant_id === merchantId;
    if (!isInvolved) {
      console.log(`[Pusher] Skipping notification for ${merchantId} - not involved in order ${orderId}`);
      return;
    }

    // Subscribe to order chat channel when we become involved
    if (!['completed', 'cancelled', 'expired'].includes(status)) {
      subscribeToOrderChat(telegramId, merchantId, orderId);
    } else {
      // Clean up subscription when order ends
      unsubscribeFromOrderChat(telegramId, orderId);
    }

    const isBuyer = order.buyer_merchant_id === merchantId;
    const isSeller = !isBuyer;
    const displayType = getDisplayType(order, merchantId);

    switch (status) {
      case 'accepted': {
        // Only notify the ORDER CREATOR, not the acceptor (they already know)
        const username = order.user?.username || '';
        const isMerchantCreated = username.startsWith('open_order_') || username.startsWith('m2m_');

        if (!isMerchantCreated) {
          // User-created order — merchant is the acceptor, they already know
          console.log(`[Pusher] Skipping accepted notification for ${merchantId} - they accepted a user order`);
          return;
        }

        // M2M / merchant-created: only notify the creator, not the acceptor
        // type=sell (BUY order): creator = buyer_merchant_id, acceptor = merchant_id
        // type=buy (SELL order): creator = merchant_id, acceptor = buyer_merchant_id
        const isCreator = (order.type === 'sell' && order.buyer_merchant_id === merchantId) ||
                          (order.type === 'buy' && order.merchant_id === merchantId);

        if (!isCreator) {
          console.log(`[Pusher] Skipping accepted notification for ${merchantId} - they are the acceptor`);
          return;
        }

        msg = `*Your Order Was Accepted!*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `Type: ${displayType.toUpperCase()} ${order.crypto_amount} USDC\n`;
        msg += `Rate: ${order.rate} AED/USDC\n`;
        msg += `Total: ${order.fiat_amount} AED\n`;

        if (isBuyer && order.merchant) {
          msg += `\nSeller: ${order.merchant.business_name || order.merchant.username || 'Unknown'}\n`;
        } else if (isSeller && order.buyer_merchant) {
          msg += `\nBuyer: ${order.buyer_merchant.business_name || order.buyer_merchant.username || 'Unknown'}\n`;
        }

        if (order.escrow_tx_hash) {
          // Escrow already locked - show payment buttons
          msg += `\n🔒 Escrow already locked.\n`;
          if (isBuyer) {
            const pd = order.payment_details || {};
            const offer = order.offer || {};
            const bankName = pd.bank_name || offer.bank_name;
            const accountName = pd.bank_account_name || offer.bank_account_name;
            const iban = pd.bank_iban || offer.bank_iban;
            msg += `\n*Send ${order.fiat_amount} AED to:*\n`;
            if (bankName) msg += `Bank: ${bankName}\n`;
            if (accountName) msg += `Name: ${accountName}\n`;
            if (iban) msg += `IBAN: \`${iban}\`\n`;
            buttons.push([Markup.button.callback('Mark Payment Sent', `payment_sent:${orderId}`)]);
          }
        } else {
          if (isSeller) {
            buttons.push([Markup.button.callback('Lock Escrow', `lock_escrow:${orderId}`)]);
          }
        }
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
        break;
      }

      case 'escrowed': {
        msg = `*Escrow Locked!*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `${order.crypto_amount} USDC is now in escrow.\n\n`;
        if (isBuyer) {
          const pd = order.payment_details || {};
          const offer = order.offer || {};
          const bankName = pd.bank_name || offer.bank_name;
          const accountName = pd.bank_account_name || offer.bank_account_name;
          const iban = pd.bank_iban || offer.bank_iban;

          msg += `*Send ${order.fiat_amount} AED to:*\n`;
          if (bankName) msg += `Bank: ${bankName}\n`;
          if (accountName) msg += `Name: ${accountName}\n`;
          if (iban) msg += `IBAN: \`${iban}\`\n`;
          if (!bankName && !accountName && !iban) {
            msg += `(Payment details not available - check order details)\n`;
          }
          buttons.push([Markup.button.callback('Mark Payment Sent', `payment_sent:${orderId}`)]);
        } else {
          msg += `Waiting for buyer to send ${order.fiat_amount} AED...`;
        }
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
        break;
      }

      case 'payment_pending': {
        msg = `*Payment Pending*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `${order.crypto_amount} USDC in escrow.\n\n`;
        if (isBuyer) {
          msg += `Ready to send ${order.fiat_amount} AED.`;
          buttons.push([Markup.button.callback('Mark Payment Sent', `payment_sent:${orderId}`)]);
        } else {
          msg += `Waiting for buyer to send ${order.fiat_amount} AED...`;
        }
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
        break;
      }

      case 'payment_sent': {
        msg = `*Payment Sent!*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        if (isSeller) {
          msg += `Buyer claims to have sent ${order.fiat_amount} AED.\n\n`;
          msg += `Please verify payment and confirm.`;
          buttons.push([Markup.button.callback('Confirm Payment', `confirm_payment:${orderId}`)]);
        } else {
          msg += `You marked ${order.fiat_amount} AED as sent.\n\n`;
          msg += `Waiting for seller to confirm receipt...`;
        }
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
        break;
      }

      case 'payment_confirmed': {
        msg = `*Payment Confirmed!*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `${order.fiat_amount} AED confirmed.\n\n`;
        if (isSeller) {
          msg += `Next: Release escrow to complete the trade.`;
          buttons.push([Markup.button.callback('Release Escrow', `release_escrow:${orderId}`)]);
        } else {
          msg += `Waiting for seller to release escrow...`;
        }
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
        break;
      }

      case 'releasing': {
        msg = `*Releasing Escrow...*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `${order.crypto_amount} USDC being released...`;
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
        break;
      }

      case 'completed': {
        msg = `*Trade Completed!*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `${order.crypto_amount} USDC transferred.\n`;
        msg += `${order.fiat_amount} AED exchanged.\n`;

        // Fetch and show new balance
        try {
          const bal = await getMerchantBalance(merchantId);
          if (bal && bal.current_balance !== undefined) {
            msg += `\n*New Balance:* ${Number(bal.current_balance).toLocaleString()} USDC\n`;
          }
        } catch (e) {
          console.error(`[Completed] Failed to fetch balance for ${merchantId}:`, e.message);
        }

        buttons.push([Markup.button.callback('Check Balance', 'balance')]);
        buttons.push([Markup.button.callback('Menu', 'main_menu')]);
        break;
      }

      case 'disputed': {
        msg = `*Dispute Raised!*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `A dispute has been raised on this trade.\n`;
        msg += `Support will review and resolve.`;
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
        break;
      }

      case 'cancelled': {
        msg = `*Order Cancelled*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `${order.crypto_amount || ''} USDC order has been cancelled.`;
        buttons.push([Markup.button.callback('Menu', 'main_menu')]);
        break;
      }

      case 'expired': {
        msg = `*Order Expired*\n\n`;
        msg += `Order: \`${order.order_number || orderId.slice(0, 8)}\`\n`;
        msg += `Order has expired (timeout).`;
        buttons.push([Markup.button.callback('Menu', 'main_menu')]);
        break;
      }

      default:
        msg = `*Order Update*\n\nOrder: \`${orderId.slice(0, 8)}\`\nStatus: *${status}*`;
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
    }
  } catch (err) {
    console.error(`[Telegram] Error fetching order details for ${orderId}:`, err.message);
    msg = `*Order Update*\n\nOrder: \`${orderId.slice(0, 8)}\`\nStatus: *${status}*`;
    buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
  }

  if (msg) {
    // Always include at least Menu button
    if (buttons.length === 0) {
      buttons.push([Markup.button.callback('My Orders', 'my_orders'), Markup.button.callback('Menu', 'main_menu')]);
    }
    sendTelegramNotification(telegramId, msg, Markup.inlineKeyboard(buttons));
  }
}

async function handleOrderCancelled(telegramId, data) {
  console.log(`[Pusher Event] order:cancelled for ${telegramId}:`, JSON.stringify(data));
  const { orderId } = data;
  unsubscribeFromOrderChat(telegramId, orderId);
  const msg = `Order \`${orderId.slice(0, 8)}\` has been cancelled.`;
  sendTelegramNotification(telegramId, msg, Markup.inlineKeyboard([
    [Markup.button.callback('My Orders', 'my_orders'), Markup.button.callback('Menu', 'main_menu')]
  ]));
}

async function handleNewOrderBroadcast(telegramId, merchantId, data) {
  console.log(`[Pusher Event] order:created broadcast for ${telegramId}:`, JSON.stringify(data));
  const { orderId, data: orderData } = data;

  // Don't notify the creator about their own order
  if (data.creatorMerchantId === merchantId) return;
  // Fallback: check nested order data
  if (orderData && orderData.merchant_id === merchantId) return;
  if (orderData && orderData.buyer_merchant_id === merchantId) return;

  const displayType = orderData ? getDisplayType(orderData, merchantId) : '?';

  let msg = `*New Order Available!*\n\n`;
  if (orderData) {
    msg += `Order: \`${orderData.order_number || orderId?.slice(0, 8) || '?'}\`\n`;
    msg += `Type: ${displayType.toUpperCase()} ${orderData.crypto_amount || '?'} USDC\n`;
    msg += `Rate: ${orderData.rate || '?'} AED/USDC\n`;
    if (orderData.fiat_amount) msg += `Total: ${orderData.fiat_amount} AED\n`;
  } else {
    msg += `A new order is available.`;
  }

  // Store last notified order so quick-accept works
  const session = getSession(telegramId);
  if (session && orderId) {
    session.lastNotifiedOrderId = orderId;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Accept Order', `accept_order:${orderId}`)],
    [Markup.button.callback('View Available', 'available_orders')],
  ]);

  sendTelegramNotification(telegramId, msg, keyboard);
}

function sendTelegramNotification(telegramId, message, keyboard = null) {
  const opts = { parse_mode: 'Markdown' };
  if (keyboard) opts.reply_markup = keyboard.reply_markup;

  bot.telegram.sendMessage(telegramId, message, opts)
    .catch(() => {
      // Fallback to plain text on Markdown parse error
      const fallbackOpts = keyboard ? { reply_markup: keyboard.reply_markup } : {};
      bot.telegram.sendMessage(telegramId, message, fallbackOpts)
        .catch(err => console.error(`[Notify] Failed to send to ${telegramId}:`, err.message));
    });
}

// ============================================================================
// PUSHER: Per-Order Chat Subscriptions
// ============================================================================

function subscribeToOrderChat(telegramId, merchantId, orderId) {
  const conn = pusherConnections.get(telegramId);
  if (!conn) return;

  if (!orderSubscriptions.has(telegramId)) {
    orderSubscriptions.set(telegramId, new Map());
  }
  const subs = orderSubscriptions.get(telegramId);

  // Already subscribed
  if (subs.has(orderId)) return;

  const channelName = `private-order-${orderId}`;
  const channel = conn.pusher.subscribe(channelName);

  channel.bind('pusher:subscription_succeeded', () => {
    console.log(`[Pusher] Subscribed to ${channelName} for chat`);
  });

  channel.bind('chat:message-new', (data) => {
    handleIncomingChatMessage(telegramId, merchantId, orderId, data);
  });

  subs.set(orderId, channel);
}

function unsubscribeFromOrderChat(telegramId, orderId) {
  const conn = pusherConnections.get(telegramId);
  const subs = orderSubscriptions.get(telegramId);
  if (!subs || !subs.has(orderId)) return;

  const channelName = `private-order-${orderId}`;
  try { conn?.pusher?.unsubscribe(channelName); } catch (e) {}
  subs.delete(orderId);
  console.log(`[Pusher] Unsubscribed from ${channelName}`);
}

// Subscribe to all active orders on login/startup
async function subscribeToActiveOrders(telegramId, merchantId) {
  try {
    const orders = await getOrders(merchantId);
    const active = orders.filter(o => !['completed', 'cancelled', 'expired'].includes(o.status));
    for (const order of active) {
      subscribeToOrderChat(telegramId, merchantId, order.id);
    }
    if (active.length > 0) {
      console.log(`[Pusher] Subscribed to ${active.length} active order channels for ${telegramId}`);
    }
  } catch (err) {
    console.error(`[Pusher] Failed to subscribe to active orders for ${telegramId}:`, err.message);
  }
}

// Handle incoming chat message from counterparty
function handleIncomingChatMessage(telegramId, merchantId, orderId, data) {
  const { senderId, senderType, content } = data;

  // Skip own messages and system messages
  if (senderId === merchantId) return;
  if (senderType === 'system') return;

  // Dedup chat notifications (reuse existing dedup with 'chat' pseudo-status)
  if (isDuplicateNotification(telegramId, orderId, `chat:${data.messageId || content.slice(0, 20)}`)) return;

  const senderLabel = senderType === 'merchant' ? 'Counterparty' : (senderType || 'User');
  const preview = content.length > 120 ? content.slice(0, 120) + '...' : content;

  const msg =
    `*New Message*\n\n` +
    `Order: \`${orderId.slice(0, 8)}\`\n` +
    `From: ${senderLabel}\n\n` +
    `${preview}`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Reply', `chat:${orderId}`)],
    [Markup.button.callback('View Order', `order_actions:${orderId}`)]
  ]);

  sendTelegramNotification(telegramId, msg, keyboard);
}

module.exports = {
  setBotInstance,
  subscribeToPusher,
  unsubscribeFromPusher,
  handleOrderStatusUpdate,
  handleOrderCancelled,
  handleNewOrderBroadcast,
  sendTelegramNotification,
  subscribeToOrderChat,
  unsubscribeFromOrderChat,
  subscribeToActiveOrders,
  handleIncomingChatMessage,
};
