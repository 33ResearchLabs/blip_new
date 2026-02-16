/**
 * Blip Money Telegram Bot
 * Button-based interface for P2P USDC trading
 *
 * Features:
 * - Step-by-step registration/login
 * - Full order lifecycle (create, accept, escrow, payment, release)
 * - Real-time Pusher notifications with action buttons
 * - In-order chat with counterparty
 * - Smart order acceptance
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const PusherClient = require('pusher-js');
const fs = require('fs');
const path = require('path');

// Initialize
const bot = new Telegraf(process.env.BOT_TOKEN);

const API_BASE = process.env.API_BASE || (process.env.SETTLE_URL ? `${process.env.SETTLE_URL}/api` : 'http://localhost:3000/api');
const MOCK_MODE = process.env.MOCK_MODE === 'true';

// Pusher config
const PUSHER_KEY = process.env.PUSHER_KEY || 'c3b9bd6d14b59c3d14d4';
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER || 'ap2';

// Session storage (use Redis in production)
const sessions = new Map();          // telegramId -> { merchantId, username, email, ... }
const pendingSignups = new Map();    // telegramId -> { step, data }
const pendingActions = new Map();    // telegramId -> { action, step, orderId?, ... }
const pusherConnections = new Map(); // telegramId -> { pusher, channels }
const orderSubscriptions = new Map(); // telegramId -> Map<orderId, pusherChannel>

// Reverse lookup: merchantId -> telegramId (for Pusher event routing)
const merchantToTelegram = new Map();

// Persistent session file
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const [telegramId, session] of Object.entries(data)) {
        const tid = Number(telegramId);
        sessions.set(tid, session);
        merchantToTelegram.set(session.merchantId, tid);
      }
      console.log(`Loaded ${Object.keys(data).length} saved sessions`);
    }
  } catch (e) {
    console.error('Failed to load sessions:', e.message);
  }
}

function saveSessions() {
  try {
    const data = {};
    for (const [telegramId, session] of sessions) {
      data[telegramId] = session;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save sessions:', e.message);
  }
}

// Load saved sessions on startup
loadSessions();

/**
 * Validate all saved sessions against the database on startup.
 * Removes stale sessions where the merchant no longer exists.
 * Attempts to re-login merchants using saved email.
 */
async function validateSessions() {
  const stale = [];
  for (const [telegramId, session] of sessions) {
    try {
      const res = await axios.get(`${API_BASE}/auth/merchant`, {
        params: { action: 'check_session', merchant_id: session.merchantId }
      });
      if (!res.data?.data?.valid) {
        console.log(`[Session] Stale session for telegramId=${telegramId} (merchant ${session.merchantId} not in DB)`);
        // Try to re-login if we have email
        if (session.email) {
          try {
            const merchant = await loginMerchant(session.email, session.password || 'telegram_user');
            if (merchant && merchant.id) {
              console.log(`[Session] Re-login succeeded for ${session.email} -> new merchantId=${merchant.id}`);
              merchantToTelegram.delete(session.merchantId);
              session.merchantId = merchant.id;
              session.username = merchant.username || session.username;
              merchantToTelegram.set(merchant.id, telegramId);
              continue; // Session recovered
            }
          } catch (loginErr) {
            console.log(`[Session] Re-login failed for ${session.email}: ${loginErr.message}`);
          }
        }
        stale.push(telegramId);
      } else {
        console.log(`[Session] Valid session: telegramId=${telegramId} merchantId=${session.merchantId}`);
      }
    } catch (err) {
      console.error(`[Session] Validation error for telegramId=${telegramId}:`, err.message);
      // Don't remove on network error - could be temporary
    }
  }

  if (stale.length > 0) {
    for (const telegramId of stale) {
      const session = sessions.get(telegramId);
      if (session) merchantToTelegram.delete(session.merchantId);
      sessions.delete(telegramId);
      console.log(`[Session] Removed stale session for telegramId=${telegramId}`);
    }
    saveSessions();
    console.log(`[Session] Removed ${stale.length} stale sessions. Users will need to /start again.`);
  } else {
    console.log(`[Session] All ${sessions.size} sessions valid`);
  }
}

// ============================================================================
// HELPER: API Calls
// ============================================================================

async function registerMerchant(email, password, businessName) {
  const res = await axios.post(`${API_BASE}/auth/merchant`, {
    action: 'register',
    email,
    password,
    business_name: businessName,
  });
  return res.data.data.merchant;
}

async function loginMerchant(email, password) {
  const res = await axios.post(`${API_BASE}/auth/merchant`, {
    action: 'login',
    email,
    password,
  });
  return res.data.data.merchant;
}

async function getMerchantBalance(merchantId) {
  try {
    const res = await axios.get(`${API_BASE}/merchant/transactions`, {
      params: { merchant_id: merchantId, summary: true }
    });
    return res.data.data;
  } catch (err) {
    const res = await axios.get(`${API_BASE}/mock/balance`, {
      params: { userId: merchantId, type: 'merchant' }
    });
    return {
      current_balance: res.data.balance || 0,
      total_credits: 0,
      total_debits: 0,
      total_transactions: 0,
    };
  }
}

async function createOrder(merchantId, type, amount, paymentMethod = 'bank') {
  const res = await axios.post(`${API_BASE}/merchant/orders`, {
    merchant_id: merchantId,
    type,
    crypto_amount: amount,
    payment_method: paymentMethod,
    spread_preference: 'fastest',
  });

  const order = res.data.data;

  // Verify order actually exists in database
  try {
    const verify = await axios.get(`${API_BASE}/orders/${order.id}`);
    if (!verify.data.data) {
      throw new Error(`Order verification failed: order ${order.id} not found in database after creation`);
    }
    console.log(`[Order] Verified order ${order.id} exists in database`);
  } catch (verifyErr) {
    console.error(`[Order] Verification failed for order ${order.id}:`, verifyErr.message);
    throw new Error(`Order creation reported success but verification failed. Order ID: ${order.id}. Error: ${verifyErr.message}`);
  }

  return order;
}

async function getOrders(merchantId) {
  try {
    const res = await axios.get(`${API_BASE}/merchant/orders`, {
      params: { merchant_id: merchantId }
    });
    return res.data.data || [];
  } catch (err) {
    if (err.response?.status === 400 && err.response?.data?.details?.includes('not found')) {
      console.error(`[API] Merchant ${merchantId} not found in database - session may be stale`);
    }
    throw err;
  }
}

async function getAvailableOrders(merchantId) {
  try {
    const res = await axios.get(`${API_BASE}/merchant/orders`, {
      params: { merchant_id: merchantId, include_all_pending: 'true' }
    });
    return res.data.data || [];
  } catch (err) {
    if (err.response?.status === 400 && err.response?.data?.details?.includes('not found')) {
      console.error(`[API] Merchant ${merchantId} not found in database - session may be stale`);
    }
    throw err;
  }
}

async function getOrderDetails(orderId) {
  const res = await axios.get(`${API_BASE}/orders/${orderId}`);
  return res.data.data;
}

async function acceptOrder(orderId, merchantId) {
  const res = await axios.patch(`${API_BASE}/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  return res.data.data;
}

async function lockEscrow(orderId, merchantId) {
  const txHash = `demo-tg-${Date.now()}`;
  const res = await axios.post(`${API_BASE}/orders/${orderId}/escrow`, {
    tx_hash: txHash,
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  return res.data.data;
}

async function releaseEscrow(orderId, merchantId) {
  const txHash = `demo-tg-release-${Date.now()}`;
  const res = await axios.patch(`${API_BASE}/orders/${orderId}/escrow`, {
    tx_hash: txHash,
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  return res.data.data;
}

async function updateOrderStatus(orderId, status, merchantId) {
  const res = await axios.patch(`${API_BASE}/orders/${orderId}`, {
    status,
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  return res.data.data;
}

async function cancelOrder(orderId, merchantId) {
  const res = await axios.delete(
    `${API_BASE}/orders/${orderId}?actor_type=merchant&actor_id=${merchantId}&reason=Cancelled via Telegram`
  );
  return res.data;
}

async function getTransactionHistory(merchantId, limit = 10) {
  try {
    const res = await axios.get(`${API_BASE}/merchant/transactions`, {
      params: { merchant_id: merchantId, limit }
    });
    return res.data.data;
  } catch (err) {
    const res = await axios.get(`${API_BASE}/merchant/orders`, {
      params: { merchant_id: merchantId }
    });
    const orders = res.data.data || [];
    return orders.slice(0, limit).map(o => ({
      type: o.type,
      amount: o.crypto_amount,
      status: o.status,
      description: `${o.type.toUpperCase()} ${o.crypto_amount} USDC - ${o.status}`,
      created_at: o.created_at,
    }));
  }
}

async function sendChatMessage(orderId, merchantId, content) {
  const res = await axios.post(`${API_BASE}/orders/${orderId}/messages`, {
    sender_type: 'merchant',
    sender_id: merchantId,
    content,
    message_type: 'text',
  });
  return res.data.data;
}

async function getChatMessages(orderId) {
  const res = await axios.get(`${API_BASE}/orders/${orderId}/messages`);
  return res.data.data || [];
}

// ============================================================================
// HELPER: Session Management
// ============================================================================

function getSession(telegramId) {
  return sessions.get(telegramId) || null;
}

async function setSession(telegramId, session) {
  sessions.set(telegramId, session);
  merchantToTelegram.set(session.merchantId, telegramId);
  saveSessions();

  // Update telegram_chat_id in database for push notifications
  try {
    await axios.patch(`${API_BASE}/merchant/${session.merchantId}/telegram`, {
      telegram_chat_id: String(telegramId)
    });
    console.log(`[Telegram] Updated chat_id for merchant ${session.merchantId}`);
  } catch (err) {
    console.error(`[Telegram] Failed to update chat_id:`, err.message);
    // Don't fail session creation if this fails
  }
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

// Dedup cache: prevents duplicate notifications when the same event arrives on multiple channels
const recentNotifications = new Map();

function isDuplicateNotification(telegramId, orderId, status) {
  const key = `${telegramId}:${orderId}:${status}`;
  const now = Date.now();
  const lastSeen = recentNotifications.get(key);
  if (lastSeen && now - lastSeen < 5000) {
    console.log(`[Pusher] Skipping duplicate notification: ${key}`);
    return true;
  }
  recentNotifications.set(key, now);
  if (recentNotifications.size > 200) {
    for (const [k, t] of recentNotifications) {
      if (now - t > 10000) recentNotifications.delete(k);
    }
  }
  return false;
}

async function handleOrderStatusUpdate(telegramId, merchantId, data) {
  console.log(`[Pusher Event] order:status-updated for ${telegramId}:`, JSON.stringify(data));

  const { orderId, status, previousStatus } = data;

  if (isDuplicateNotification(telegramId, orderId, status)) return;

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
        msg = `*Order Accepted!*\n\n`;
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
        msg += `${order.fiat_amount} AED exchanged.`;
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

      default:
        msg = `Order \`${orderId.slice(0, 8)}\` status: ${previousStatus} -> *${status}*`;
        buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
    }
  } catch (err) {
    msg = `Order \`${orderId.slice(0, 8)}\` status changed: ${previousStatus} -> *${status}*`;
    buttons.push([Markup.button.callback('View Order', `order_actions:${orderId}`)]);
  }

  if (msg) {
    const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;
    sendTelegramNotification(telegramId, msg, keyboard);
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

  // Don't notify about own orders
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

// ============================================================================
// HELPERS: Display & Formatting
// ============================================================================

// Get the correct display type from the merchant's perspective
function getDisplayType(order, merchantId) {
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

function statusEmoji(status) {
  const map = {
    pending: '\u23F3',
    accepted: '\uD83E\uDD1D',
    escrowed: '\uD83D\uDD12',
    payment_pending: '\uD83D\uDCB3',
    payment_sent: '\uD83D\uDCB8',
    payment_confirmed: '\u2705',
    releasing: '\u23F3',
    completed: '\uD83C\uDF89',
    cancelled: '\u274C',
    disputed: '\u26A0\uFE0F',
    expired: '\u23F0',
  };
  return map[status] || '\uD83D\uDCCB';
}

function getActionButtons(order, merchantId) {
  const isBuyer = order.buyer_merchant_id === merchantId;
  const isSeller = !isBuyer;
  const buttons = [];

  switch (order.status) {
    case 'pending':
      buttons.push([Markup.button.callback('Cancel Order', `cancel_order:${order.id}`)]);
      break;
    case 'accepted':
      if (order.escrow_tx_hash) {
        // Escrow already locked (pre-escrowed order) - show payment buttons
        if (isBuyer) buttons.push([Markup.button.callback('Mark Payment Sent', `payment_sent:${order.id}`)]);
        if (isSeller) buttons.push([Markup.button.callback('Cancel Order', `cancel_order:${order.id}`)]);
      } else {
        if (isSeller) buttons.push([Markup.button.callback('Lock Escrow', `lock_escrow:${order.id}`)]);
        buttons.push([Markup.button.callback('Cancel Order', `cancel_order:${order.id}`)]);
      }
      break;
    case 'escrowed':
      if (isBuyer) buttons.push([Markup.button.callback('Mark Payment Sent', `payment_sent:${order.id}`)]);
      if (isSeller) buttons.push([Markup.button.callback('Cancel Order', `cancel_order:${order.id}`)]);
      break;
    case 'payment_pending':
      if (isBuyer) buttons.push([Markup.button.callback('Mark Payment Sent', `payment_sent:${order.id}`)]);
      break;
    case 'payment_sent':
      if (isSeller) buttons.push([Markup.button.callback('Confirm Payment', `confirm_payment:${order.id}`)]);
      break;
    case 'payment_confirmed':
      if (isSeller) buttons.push([Markup.button.callback('Release Escrow', `release_escrow:${order.id}`)]);
      break;
  }

  // Chat + Details for active orders
  if (!['completed', 'cancelled', 'expired'].includes(order.status)) {
    buttons.push([
      Markup.button.callback('Chat', `chat:${order.id}`),
      Markup.button.callback('Details', `order_details:${order.id}`)
    ]);
  }

  buttons.push([Markup.button.callback('My Orders', 'my_orders'), Markup.button.callback('Menu', 'main_menu')]);

  return Markup.inlineKeyboard(buttons);
}

function formatOrderDetails(order, merchantId) {
  const type = getDisplayType(order, merchantId).toUpperCase();
  const emoji = statusEmoji(order.status);
  const isBuyer = order.buyer_merchant_id === merchantId;

  let text = `${emoji} *${type} Order Details*\n\n`;
  text += `Order: \`${order.order_number || order.id.slice(0, 8)}\`\n`;
  text += `Status: *${order.status}*\n`;
  text += `Amount: ${order.crypto_amount} USDC\n`;
  text += `Rate: ${order.rate} AED/USDC\n`;
  text += `Total: ${order.fiat_amount} AED\n`;
  text += `Payment: ${order.payment_method || 'bank'}\n`;

  // Counterparty info
  if (isBuyer && order.merchant) {
    text += `\nSeller: ${order.merchant.business_name || order.merchant.username || 'Unknown'}\n`;
  } else if (!isBuyer && order.buyer_merchant) {
    text += `\nBuyer: ${order.buyer_merchant.business_name || order.buyer_merchant.username || 'Unknown'}\n`;
  }

  // Bank details for buyer when escrowed
  if (isBuyer && ['escrowed', 'payment_sent'].includes(order.status)) {
    const pd = order.payment_details || {};
    const offer = order.offer || {};
    const bankName = pd.bank_name || offer.bank_name;
    const accountName = pd.bank_account_name || offer.bank_account_name;
    const iban = pd.bank_iban || offer.bank_iban;

    if (bankName || accountName || iban) {
      text += `\n*Payment Details:*\n`;
      if (bankName) text += `Bank: ${bankName}\n`;
      if (accountName) text += `Name: ${accountName}\n`;
      if (iban) text += `IBAN: \`${iban}\`\n`;
    }
  }

  if (order.escrow_tx_hash) text += `\nEscrow TX: \`${order.escrow_tx_hash.slice(0, 12)}...\`\n`;
  if (order.release_tx_hash) text += `Release TX: \`${order.release_tx_hash.slice(0, 12)}...\`\n`;

  if (order.created_at) {
    text += `\nCreated: ${new Date(order.created_at).toLocaleString()}\n`;
  }

  return text;
}

// ============================================================================
// UI: Main Menu
// ============================================================================

async function sendMainMenu(ctx, session) {
  const text = `*Blip Money*\nWelcome, *${session.username}*!\n\nWhat would you like to do?`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Balance', 'balance'),
     Markup.button.callback('Active Orders', 'my_orders')],
    [Markup.button.callback('Available Orders', 'available_orders'),
     Markup.button.callback('Transactions', 'history')],
    [Markup.button.callback('Buy USDC', 'buy_usdc'),
     Markup.button.callback('Sell USDC', 'sell_usdc')],
  ]);

  try {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
  }
}

// Helper to safely edit or reply
async function editOrReply(ctx, text, opts = {}) {
  try {
    await ctx.editMessageText(text, opts);
  } catch {
    await ctx.reply(text, opts);
  }
}

// Safe answerCbQuery - never throws (Telegram rejects if query is >30s old)
async function ack(ctx, text) {
  try { await ctx.answerCbQuery(text); } catch {}
}

// ============================================================================
// UI: Safe Message Sending
// ============================================================================

async function safeSendMessage(ctx, text) {
  const chunks = text.length > 4000 ? (text.match(/.{1,4000}/gs) || [text]) : [text];
  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch (err) {
      console.log('[Bot] Markdown parse failed, sending as plain text');
      await ctx.reply(chunk);
    }
  }
}

// ============================================================================
// ACTIONS: Main Menu Navigation
// ============================================================================

bot.action('main_menu', async (ctx) => {
  await ack(ctx);
  const session = getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first.');
  pendingActions.delete(ctx.from.id);
  await sendMainMenu(ctx, session);
});

bot.action('balance', async (ctx) => {
  await ack(ctx);
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const balance = await getMerchantBalance(session.merchantId);
    const text =
      `*Your Balance*\n\n` +
      `Current: *${balance.current_balance} USDC*\n` +
      `Total In: +${balance.total_credits} USDC\n` +
      `Total Out: -${balance.total_debits} USDC\n` +
      `Transactions: ${balance.total_transactions}`;
    await editOrReply(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Refresh', 'balance'), Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  } catch {
    await editOrReply(ctx, 'Error fetching balance.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', 'balance'), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// Shared handler for active orders with filter tabs
async function showMyOrders(ctx, filter = 'all') {
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const orders = await getOrders(session.merchantId);
    const allActive = orders.filter(o => !['completed', 'cancelled', 'expired'].includes(o.status));
    const openOrders = allActive.filter(o => ['pending', 'accepted'].includes(o.status));
    const escrowOrders = allActive.filter(o => ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(o.status));

    const filtered = filter === 'open' ? openOrders : filter === 'escrow' ? escrowOrders : allActive;
    const filterLabel = filter === 'open' ? 'Open' : filter === 'escrow' ? 'In Escrow' : 'All Active';

    // Filter tab buttons - highlight active tab
    const allTag = filter === 'all' ? '[ All ' + allActive.length + ' ]' : 'All ' + allActive.length;
    const openTag = filter === 'open' ? '[ Open ' + openOrders.length + ' ]' : 'Open ' + openOrders.length;
    const escrowTag = filter === 'escrow' ? '[ Escrow ' + escrowOrders.length + ' ]' : 'Escrow ' + escrowOrders.length;

    const tabButtons = [
      Markup.button.callback(allTag, 'my_orders'),
      Markup.button.callback(openTag, 'my_orders_open'),
      Markup.button.callback(escrowTag, 'my_orders_escrow'),
    ];

    if (filtered.length === 0) {
      return editOrReply(ctx,
        `*${filterLabel} Orders*\n\nNo ${filterLabel.toLowerCase()} orders.`,
        { parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            tabButtons,
            [Markup.button.callback('Available Orders', 'available_orders')],
            [Markup.button.callback('Menu', 'main_menu')]
          ])
        }
      );
    }

    let text = `*${filterLabel} Orders* (${filtered.length})\n\n`;
    const buttons = [tabButtons];

    filtered.slice(0, 8).forEach((o, i) => {
      const type = getDisplayType(o, session.merchantId).toUpperCase();
      const emoji = statusEmoji(o.status);
      text += `${i + 1}. ${emoji} ${type} ${o.crypto_amount} USDC - *${o.status}*\n`;
      text += `   \`${o.order_number || o.id.slice(0, 8)}\`\n\n`;
      buttons.push([Markup.button.callback(
        `${emoji} ${type} ${o.crypto_amount} USDC (${o.status})`,
        `order_actions:${o.id}`
      )]);
    });

    const currentAction = filter === 'open' ? 'my_orders_open' : filter === 'escrow' ? 'my_orders_escrow' : 'my_orders';
    buttons.push([Markup.button.callback('Refresh', currentAction), Markup.button.callback('Menu', 'main_menu')]);
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('[my_orders] Error:', err.message);
    // Detect stale session (merchant not found in DB)
    if (err.response?.status === 400 && JSON.stringify(err.response?.data).includes('not found')) {
      merchantToTelegram.delete(session.merchantId);
      sessions.delete(ctx.from.id);
      saveSessions();
      return editOrReply(ctx,
        'Your account was not found. The database may have been reset.\n\nPlease tap /start to create a new account or login again.',
        { ...Markup.inlineKeyboard([[Markup.button.callback('Start Over', 'signup'), Markup.button.callback('Login', 'login')]]) }
      );
    }
    await editOrReply(ctx, 'Error fetching orders.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', 'my_orders'), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
}

bot.action('my_orders', async (ctx) => {
  await ack(ctx);
  await showMyOrders(ctx, 'all');
});

bot.action('my_orders_open', async (ctx) => {
  await ack(ctx);
  await showMyOrders(ctx, 'open');
});

bot.action('my_orders_escrow', async (ctx) => {
  await ack(ctx);
  await showMyOrders(ctx, 'escrow');
});

bot.action('available_orders', async (ctx) => {
  await ack(ctx);
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    let orders = await getAvailableOrders(session.merchantId);
    orders = orders.filter(o => !o.is_my_order && o.status === 'pending');

    if (orders.length === 0) {
      return editOrReply(ctx,
        '*Available Orders*\n\nNo orders available right now.',
        { parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Refresh', 'available_orders')],
            [Markup.button.callback('Menu', 'main_menu')]
          ])
        }
      );
    }

    let text = `*Available Orders* (${orders.length})\n\n`;
    const buttons = [];

    orders.slice(0, 8).forEach((o, i) => {
      const type = getDisplayType(o, session.merchantId).toUpperCase();
      text += `${i + 1}. ${type} ${o.crypto_amount} USDC @ ${o.rate} AED\n`;
      text += `   Total: ${o.fiat_amount} AED | \`${o.order_number || o.id.slice(0, 8)}\`\n\n`;
      buttons.push([Markup.button.callback(
        `Accept: ${type} ${o.crypto_amount} USDC (${o.fiat_amount} AED)`,
        `accept_order:${o.id}`
      )]);
    });

    buttons.push([Markup.button.callback('Refresh', 'available_orders'), Markup.button.callback('Menu', 'main_menu')]);
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (err) {
    console.error('[available_orders] Error:', err.message);
    await editOrReply(ctx, 'Error fetching available orders.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', 'available_orders'), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

bot.action('history', async (ctx) => {
  await ack(ctx);
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const transactions = await getTransactionHistory(session.merchantId, 10);
    if (!transactions || transactions.length === 0) {
      return editOrReply(ctx, '*Transactions*\n\nNo transactions yet.', {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('Menu', 'main_menu')]])
      });
    }

    let text = `*Recent Transactions*\n\n`;
    transactions.forEach(t => {
      text += `${t.description || `${(t.type || '').toUpperCase()} ${t.amount} USDC`}\n`;
      if (t.created_at) text += `  ${new Date(t.created_at).toLocaleDateString()}\n`;
      text += `\n`;
    });

    await editOrReply(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Refresh', 'history'), Markup.button.callback('Menu', 'main_menu')]])
    });
  } catch {
    await editOrReply(ctx, 'Error fetching transactions.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', 'history'), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// ============================================================================
// ACTIONS: Buy / Sell USDC
// ============================================================================

bot.action('buy_usdc', async (ctx) => {
  await ack(ctx);
  const session = getSession(ctx.from.id);
  if (!session) return;

  pendingActions.set(ctx.from.id, { action: 'buy', step: 'amount' });
  await editOrReply(ctx,
    `*Buy USDC*\n\nEnter the amount of USDC you want to buy:\n\n_(Type a number, e.g. 100)_`,
    { parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
    }
  );
});

bot.action('sell_usdc', async (ctx) => {
  await ack(ctx);
  const session = getSession(ctx.from.id);
  if (!session) return;

  pendingActions.set(ctx.from.id, { action: 'sell', step: 'amount' });
  await editOrReply(ctx,
    `*Sell USDC*\n\nEnter the amount of USDC you want to sell:\n\n_(Type a number, e.g. 100)_`,
    { parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
    }
  );
});

bot.action(/^confirm_buy:(.+)$/, async (ctx) => {
  await ack(ctx, 'Creating buy order...');
  const amount = parseFloat(ctx.match[1]);
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const order = await createOrder(session.merchantId, 'buy', amount);
    subscribeToOrderChat(ctx.from.id, session.merchantId, order.id);
    const text =
      `*Buy Order Created!*\n\n` +
      `Order: \`${order.order_number || order.id.slice(0, 8)}\`\n` +
      `Amount: ${order.crypto_amount} USDC\n` +
      `Rate: ${order.rate} AED/USDC\n` +
      `Total: ${order.fiat_amount} AED\n` +
      `Status: *${order.status}*\n\n` +
      `Waiting for a seller to accept...`;

    await editOrReply(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('My Orders', 'my_orders')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to create buy order: ${errMsg}`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Try Again', 'buy_usdc')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  }
});

bot.action(/^confirm_sell:(.+)$/, async (ctx) => {
  await ack(ctx, 'Creating sell order...');
  const amount = parseFloat(ctx.match[1]);
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const order = await createOrder(session.merchantId, 'sell', amount);
    subscribeToOrderChat(ctx.from.id, session.merchantId, order.id);
    const text =
      `*Sell Order Created!*\n\n` +
      `Order: \`${order.order_number || order.id.slice(0, 8)}\`\n` +
      `Amount: ${order.crypto_amount} USDC\n` +
      `Rate: ${order.rate} AED/USDC\n` +
      `Total: ${order.fiat_amount} AED\n` +
      `Status: *${order.status}*\n\n` +
      `Waiting for a buyer to accept...`;

    await editOrReply(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('My Orders', 'my_orders')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to create sell order: ${errMsg}`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Try Again', 'sell_usdc')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  }
});

// ============================================================================
// ACTIONS: Per-Order Operations
// ============================================================================

bot.action(/^order_actions:(.+)$/, async (ctx) => {
  await ack(ctx);
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const order = await getOrderDetails(orderId);
    const text = formatOrderDetails(order, session.merchantId);
    const keyboard = getActionButtons(order, session.merchantId);
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  } catch (err) {
    await editOrReply(ctx, `Error loading order: ${err.response?.data?.error || err.message}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('My Orders', 'my_orders'), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

bot.action(/^order_details:(.+)$/, async (ctx) => {
  await ack(ctx);
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const order = await getOrderDetails(orderId);
    const text = formatOrderDetails(order, session.merchantId);
    const keyboard = getActionButtons(order, session.merchantId);
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  } catch (err) {
    await editOrReply(ctx, `Error: ${err.message}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('My Orders', 'my_orders')]])
    });
  }
});

// Accept order (from available list or notification)
bot.action(/^accept_order:(.+)$/, async (ctx) => {
  await ack(ctx, 'Accepting order...');
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  // Step 1: Accept the order (the critical action)
  let acceptedOrder;
  try {
    acceptedOrder = await acceptOrder(orderId, session.merchantId);
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to accept: ${errMsg}`, {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Available Orders', 'available_orders')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
    return;
  }

  // Step 2: Subscribe to chat (non-critical)
  try {
    subscribeToOrderChat(ctx.from.id, session.merchantId, orderId);
  } catch (err) {
    console.error(`[Accept] Chat subscription failed for ${orderId}:`, err.message);
  }

  // Step 3: Show success with order details
  try {
    const type = getDisplayType(acceptedOrder, session.merchantId).toUpperCase();
    const text =
      `*Order Accepted!*\n\n` +
      `Order: \`${acceptedOrder.order_number || orderId.slice(0, 8)}\`\n` +
      `Type: ${type} ${acceptedOrder.crypto_amount} USDC\n` +
      `Rate: ${acceptedOrder.rate} AED/USDC\n` +
      `Total: ${acceptedOrder.fiat_amount} AED\n\n` +
      `You have 120 minutes to complete this trade.`;

    const keyboard = getActionButtons(acceptedOrder, session.merchantId);
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  } catch (err) {
    await editOrReply(ctx, `*Order Accepted!* ✓\n\nTap below to see order details.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('View Order', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// Keep old quick_accept button handler for backwards compat
bot.action(/^quick_accept:(.+)$/, async (ctx) => {
  await ack(ctx, 'Accepting order...');
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) {
    return ctx.reply('You need to log in first. Use /start');
  }

  let acceptedOrder;
  try {
    acceptedOrder = await acceptOrder(orderId, session.merchantId);
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message || 'Unknown error';
    return ctx.reply(`Failed to accept order: ${errMsg}`);
  }

  try {
    subscribeToOrderChat(ctx.from.id, session.merchantId, orderId);
  } catch (err) {
    console.error(`[QuickAccept] Chat subscription failed for ${orderId}:`, err.message);
  }

  try {
    const type = getDisplayType(acceptedOrder, session.merchantId).toUpperCase();
    const text =
      `*Order Accepted!*\n\n` +
      `Order: \`${acceptedOrder.order_number || orderId.slice(0, 8)}\`\n` +
      `Type: ${type} ${acceptedOrder.crypto_amount} USDC\n` +
      `Rate: ${acceptedOrder.rate} AED/USDC\n` +
      `Total: ${acceptedOrder.fiat_amount} AED\n\n` +
      `You have 120 minutes to complete this trade.`;

    const keyboard = getActionButtons(acceptedOrder, session.merchantId);
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...keyboard });
  } catch (err) {
    await editOrReply(ctx, `*Order Accepted!* ✓\n\nTap below to see order details.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('View Order', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// Lock Escrow
bot.action(/^lock_escrow:(.+)$/, async (ctx) => {
  await ack(ctx, 'Locking escrow...');
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  // Step 1: Lock escrow (the critical action)
  try {
    await lockEscrow(orderId, session.merchantId);
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to lock escrow: ${errMsg}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', `lock_escrow:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]])
    });
    return;
  }

  // Step 2: Fetch updated order for display (non-critical)
  try {
    const order = await getOrderDetails(orderId);
    const text = `*Escrow Locked!*\n\n${order.crypto_amount} USDC is now in escrow.\nWaiting for buyer to send ${order.fiat_amount} AED.`;
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...getActionButtons(order, session.merchantId) });
  } catch (err) {
    await editOrReply(ctx, `*Escrow Locked!* ✓\n\nTap below to see order details.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('View Order', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// Mark Payment Sent
bot.action(/^payment_sent:(.+)$/, async (ctx) => {
  await ack(ctx, 'Marking payment sent...');
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    await updateOrderStatus(orderId, 'payment_sent', session.merchantId);
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to mark payment: ${errMsg}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', `payment_sent:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]])
    });
    return;
  }

  try {
    const order = await getOrderDetails(orderId);
    const text = `*Payment Marked as Sent!*\n\n${order.fiat_amount} AED marked as sent.\nWaiting for seller to confirm receipt.`;
    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...getActionButtons(order, session.merchantId) });
  } catch (err) {
    await editOrReply(ctx, `*Payment Marked as Sent!* ✓\n\nTap below to see order details.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('View Order', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// Confirm Payment Received & Release Escrow (Atomic)
bot.action(/^confirm_payment:(.+)$/, async (ctx) => {
  await ack(ctx, 'Confirming & releasing...');
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    // Atomic operation: confirm payment + release escrow + complete order
    await releaseEscrow(orderId, session.merchantId);
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to confirm payment: ${errMsg}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', `confirm_payment:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]])
    });
    return;
  }

  try {
    const order = await getOrderDetails(orderId);
    const text =
      `*Trade Completed!*\n\n` +
      `${order.crypto_amount} USDC released to buyer.\n` +
      `${order.fiat_amount} AED confirmed.\n\n` +
      `Check your balance to see the update.`;
    await editOrReply(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Check Balance', 'balance')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  } catch (err) {
    await editOrReply(ctx, `*Trade Completed!* ✓\n\nEscrow released successfully.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Check Balance', 'balance')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  }
});

// Release Escrow
bot.action(/^release_escrow:(.+)$/, async (ctx) => {
  await ack(ctx, 'Releasing escrow...');
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    await releaseEscrow(orderId, session.merchantId);
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to release escrow: ${errMsg}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('Retry', `release_escrow:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]])
    });
    return;
  }

  try {
    const order = await getOrderDetails(orderId);
    const text =
      `*Trade Completed!*\n\n` +
      `${order.crypto_amount} USDC has been transferred.\n` +
      `${order.fiat_amount} AED exchanged.\n\n` +
      `Check your balance to see the update.`;
    await editOrReply(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Check Balance', 'balance')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  } catch (err) {
    await editOrReply(ctx, `*Trade Completed!* ✓\n\nEscrow released successfully. Tap below to check your balance.`, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Check Balance', 'balance')],
        [Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  }
});

// Cancel Order - confirmation step
bot.action(/^cancel_order:(.+)$/, async (ctx) => {
  await ack(ctx);
  const orderId = ctx.match[1];
  await editOrReply(ctx,
    `*Are you sure you want to cancel this order?*\n\nThis cannot be undone.`,
    { parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Yes, Cancel', `confirm_cancel:${orderId}`)],
        [Markup.button.callback('No, Go Back', `order_actions:${orderId}`)]
      ])
    }
  );
});

bot.action(/^confirm_cancel:(.+)$/, async (ctx) => {
  await ack(ctx, 'Cancelling order...');
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    await cancelOrder(orderId, session.merchantId);
    await editOrReply(ctx,
      `*Order Cancelled*\n\nOrder \`${orderId.slice(0, 8)}\` has been cancelled.`,
      { parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('My Orders', 'my_orders'), Markup.button.callback('Menu', 'main_menu')]
        ])
      }
    );
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    await editOrReply(ctx, `Failed to cancel: ${errMsg}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('Back', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// ============================================================================
// ACTIONS: Chat with Counterparty
// ============================================================================

bot.action(/^chat:(.+)$/, async (ctx) => {
  await ack(ctx);
  const orderId = ctx.match[1];
  const session = getSession(ctx.from.id);
  if (!session) return;

  try {
    const messages = await getChatMessages(orderId);
    const recent = messages.slice(-5);

    let text = `*Chat* - Order \`${orderId.slice(0, 8)}\`\n\n`;

    if (recent.length === 0) {
      text += `_No messages yet._\n\n`;
    } else {
      recent.forEach(m => {
        const isMe = m.sender_id === session.merchantId;
        const sender = isMe ? 'You' : (m.sender_name || m.sender_type);
        const time = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        text += `*${sender}* ${time}\n${m.content}\n\n`;
      });
    }

    text += `_Type your message below to send:_`;

    // Set pending chat action
    pendingActions.set(ctx.from.id, { action: 'chat', orderId });

    await editOrReply(ctx, text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Refresh Chat', `chat:${orderId}`)],
        [Markup.button.callback('Back to Order', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]
      ])
    });
  } catch (err) {
    console.error('[chat] Error:', err.message);
    await editOrReply(ctx, `Error loading chat: ${err.response?.data?.error || err.message}`, {
      ...Markup.inlineKeyboard([[Markup.button.callback('Back', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
    });
  }
});

// ============================================================================
// REGISTRATION: Step-by-Step Flow
// ============================================================================

bot.command('start', async (ctx) => {
  const telegramId = ctx.from.id;

  // Already logged in? Validate the session is still valid in the DB
  const session = getSession(telegramId);
  if (session) {
    try {
      const res = await axios.get(`${API_BASE}/auth/merchant`, {
        params: { action: 'check_session', merchant_id: session.merchantId }
      });
      if (res.data?.data?.valid) {
        return sendMainMenu(ctx, session);
      }
      // Session is stale - merchant no longer in DB
      console.log(`[Bot] Stale session detected for telegramId=${telegramId}, clearing...`);
      merchantToTelegram.delete(session.merchantId);
      sessions.delete(telegramId);
      saveSessions();
      ctx.reply('Your previous session has expired. Please create a new account or login again.');
    } catch (err) {
      // Network error - try to use existing session anyway
      console.error(`[Bot] Session check failed for ${telegramId}:`, err.message);
      return sendMainMenu(ctx, session);
    }
  }

  // Start registration flow
  ctx.reply(
    `*Welcome to Blip Money!*\n\n` +
    `I'm your trading assistant for P2P USDC trading.\n\n` +
    `Let's set up your account. Do you already have one?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('Create Account', 'signup'),
          Markup.button.callback('Login', 'login'),
        ]
      ])
    }
  );
});

// ---- SIGNUP FLOW ----

bot.action('signup', async (ctx) => {
  await ack(ctx);
  pendingSignups.set(ctx.from.id, { step: 'username', data: {} });

  ctx.reply(
    `*Create Your Account*\n\n` +
    `Step 1/3: Choose a *username*\n\n` +
    `Rules:\n` +
    `- 3-20 characters\n` +
    `- Letters, numbers, underscores only\n\n` +
    `Type your username:`,
    { parse_mode: 'Markdown' }
  );
});

bot.action('login', async (ctx) => {
  await ack(ctx);
  pendingSignups.set(ctx.from.id, { step: 'login_email', data: {} });

  ctx.reply(
    `*Login to Your Account*\n\n` +
    `Enter your *email address*:`,
    { parse_mode: 'Markdown' }
  );
});

// Handle signup/login text input
async function handleSignupFlow(ctx) {
  const telegramId = ctx.from.id;
  const signup = pendingSignups.get(telegramId);
  if (!signup) return false;

  const text = ctx.message.text.trim();

  switch (signup.step) {
    // ---- SIGNUP ----
    case 'username': {
      if (text.length < 3 || text.length > 20 || !/^[a-zA-Z0-9_]+$/.test(text)) {
        ctx.reply('Invalid username. Use 3-20 characters (letters, numbers, underscores). Try again:');
        return true;
      }
      signup.data.username = text;
      signup.step = 'email';
      ctx.reply(
        `Username: *${text}*\n\n` +
        `Step 2/3: Enter your *email address*:`,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    case 'email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        ctx.reply('Invalid email format. Try again:');
        return true;
      }
      signup.data.email = text.toLowerCase();
      signup.step = 'password';
      ctx.reply(
        `Email: *${text}*\n\n` +
        `Step 3/3: Choose a *password*\n` +
        `(minimum 6 characters):`,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    case 'password': {
      if (text.length < 6) {
        ctx.reply('Password too short. Minimum 6 characters. Try again:');
        return true;
      }
      signup.data.password = text;

      // Delete the password message for security
      try { await ctx.deleteMessage(); } catch (e) {}

      // Create the account
      try {
        const merchant = await registerMerchant(
          signup.data.email,
          signup.data.password,
          signup.data.username
        );

        // Save session
        setSession(telegramId, {
          merchantId: merchant.id,
          username: merchant.username || signup.data.username,
          email: signup.data.email,
          walletAddress: merchant.wallet_address,
        });

        pendingSignups.delete(telegramId);

        // Subscribe to Pusher for real-time updates
        subscribeToPusher(telegramId, merchant.id);

        // Fetch actual balance
        const balanceData = await getMerchantBalance(merchant.id);
        const actualBalance = balanceData.current_balance || 0;

        await ctx.reply(
          `*Account Created Successfully!*\n\n` +
          `Username: *${signup.data.username}*\n` +
          `Email: ${signup.data.email}\n` +
          `Balance: ${actualBalance} USDC\n\n` +
          `Real-time notifications: ON`,
          { parse_mode: 'Markdown' }
        );

        // Show main menu
        await sendMainMenu(ctx, getSession(telegramId));
      } catch (error) {
        const errMsg = error.response?.data?.error || 'Registration failed';
        ctx.reply(`${errMsg}\n\nTry /start again.`);
        pendingSignups.delete(telegramId);
      }
      return true;
    }

    // ---- LOGIN ----
    case 'login_email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        ctx.reply('Invalid email format. Try again:');
        return true;
      }
      signup.data.email = text.toLowerCase();
      signup.step = 'login_password';
      ctx.reply(
        `Email: *${text}*\n\n` +
        `Enter your *password*:`,
        { parse_mode: 'Markdown' }
      );
      return true;
    }

    case 'login_password': {
      signup.data.password = text;

      // Delete the password message for security
      try { await ctx.deleteMessage(); } catch (e) {}

      try {
        const merchant = await loginMerchant(signup.data.email, signup.data.password);

        setSession(telegramId, {
          merchantId: merchant.id,
          username: merchant.username,
          email: signup.data.email,
          walletAddress: merchant.wallet_address,
        });

        pendingSignups.delete(telegramId);

        // Subscribe to Pusher for real-time updates
        subscribeToPusher(telegramId, merchant.id);

        // Fetch actual balance
        const balanceData = await getMerchantBalance(merchant.id);
        const actualBalance = balanceData.current_balance || 0;

        await ctx.reply(
          `*Welcome back, ${merchant.username}!*\n\n` +
          `Balance: ${actualBalance} USDC\n\n` +
          `Real-time notifications: ON`,
          { parse_mode: 'Markdown' }
        );

        // Show main menu
        await sendMainMenu(ctx, getSession(telegramId));
      } catch (error) {
        const errMsg = error.response?.data?.error || 'Login failed';
        ctx.reply(`${errMsg}\n\nTry /start again.`);
        pendingSignups.delete(telegramId);
      }
      return true;
    }

    default:
      pendingSignups.delete(telegramId);
      return false;
  }
}

// ============================================================================
// BOT: Slash Commands
// ============================================================================

bot.command('menu', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first to create or login to your account.');
  await sendMainMenu(ctx, session);
});

bot.command('balance', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first to create or login to your account.');

  try {
    const balance = await getMerchantBalance(session.merchantId);
    ctx.reply(
      `*Your Balance*\n\n` +
      `Current: *${balance.current_balance} USDC*\n` +
      `Total In: +${balance.total_credits} USDC\n` +
      `Total Out: -${balance.total_debits} USDC`,
      { parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('Menu', 'main_menu')]])
      }
    );
  } catch (error) {
    ctx.reply('Error fetching balance. Try again.');
  }
});

bot.command('help', (ctx) => {
  ctx.reply(
    `*Blip Money Bot*\n\n` +
    `Use the buttons to navigate! Tap /menu to open the main menu.\n\n` +
    `*Quick Commands:*\n` +
    `/menu - Main menu\n` +
    `/balance - Check balance\n` +
    `/orders - View your orders\n` +
    `/available - Available orders\n` +
    `/help - This help\n` +
    `/logout - Sign out`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('orders', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first.');
  // Reuse the button handler via a fake callback context
  await showMyOrders(ctx, 'all');
});

bot.command('available', async (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first.');

  try {
    let orders = await getAvailableOrders(session.merchantId);
    orders = orders.filter(o => !o.is_my_order && o.status === 'pending');

    if (orders.length === 0) return ctx.reply('No available orders to accept right now.', Markup.inlineKeyboard([
      [Markup.button.callback('Refresh', 'available_orders'), Markup.button.callback('Menu', 'main_menu')]
    ]));

    let msg = `*Available Orders* (${orders.length})\n\n`;
    const buttons = [];
    orders.slice(0, 8).forEach((o, i) => {
      const type = getDisplayType(o, session.merchantId).toUpperCase();
      msg += `${i + 1}. ${type} ${o.crypto_amount} USDC @ ${o.rate} AED\n`;
      msg += `   Total: ${o.fiat_amount} AED | \`${o.order_number || o.id.slice(0, 8)}\`\n\n`;
      buttons.push([Markup.button.callback(
        `Accept: ${type} ${o.crypto_amount} USDC`,
        `accept_order:${o.id}`
      )]);
    });
    buttons.push([Markup.button.callback('Menu', 'main_menu')]);
    ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } catch (error) {
    ctx.reply('Error fetching available orders.');
  }
});

bot.command('logout', (ctx) => {
  const telegramId = ctx.from.id;
  const session = getSession(telegramId);
  unsubscribeFromPusher(telegramId);
  if (session) merchantToTelegram.delete(session.merchantId);
  sessions.delete(telegramId);
  pendingActions.delete(telegramId);
  saveSessions();
  ctx.reply('Logged out. Real-time notifications stopped. Send /start to login again.');
});

// ============================================================================
// BOT: Text Handler (Signup + Pending Actions)
// ============================================================================

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const telegramId = ctx.from.id;

  // 1. Signup/login flow
  const isSignup = await handleSignupFlow(ctx);
  if (isSignup) return;

  // 2. Check if user has session
  const session = getSession(telegramId);
  if (!session) {
    return ctx.reply(
      `Hey! You need an account first.\n\nSend /start to create one or login.`
    );
  }

  // 3. Quick-accept shortcut: "accept it" / "take it" using last notified order
  const lower = ctx.message.text.toLowerCase().trim();
  if (/^(accept it|accept order|take it|take order|accept this|take this|yes accept|accept)$/i.test(lower) && session.lastNotifiedOrderId) {
    try {
      await ctx.sendChatAction('typing');
      const order = await acceptOrder(session.lastNotifiedOrderId, session.merchantId);
      subscribeToOrderChat(telegramId, session.merchantId, session.lastNotifiedOrderId);
      const type = getDisplayType(order, session.merchantId).toUpperCase();
      const keyboard = getActionButtons(order, session.merchantId);
      return ctx.reply(
        `*Order Accepted!*\n\n` +
        `Order: \`${order.order_number || order.id.slice(0, 8)}\`\n` +
        `Type: ${type} ${order.crypto_amount} USDC\n` +
        `Rate: ${order.rate} AED/USDC\n` +
        `Total: ${order.fiat_amount} AED\n\n` +
        `You have 120 minutes to complete this trade.`,
        { parse_mode: 'Markdown', ...keyboard }
      );
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Unknown error';
      console.error(`[Quick Accept] Failed to accept order ${session.lastNotifiedOrderId}:`, errMsg);
      delete session.lastNotifiedOrderId;
      return safeSendMessage(ctx, `Failed to accept that order: ${errMsg}\n\nSay "view available orders" to see what's available.`);
    }
  }

  // 4. Handle pending actions (buy/sell amount input, chat messages)
  const pending = pendingActions.get(telegramId);
  if (pending) {
    return handlePendingAction(ctx, session, pending);
  }

  // 5. No pending action - show menu hint
  return ctx.reply(
    'Tap a button or type /menu to open the main menu.',
    Markup.inlineKeyboard([[Markup.button.callback('Menu', 'main_menu')]])
  );
});

// ============================================================================
// HANDLER: Pending Text Actions (buy/sell amount, chat messages)
// ============================================================================

async function handlePendingAction(ctx, session, pending) {
  const telegramId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Buy/Sell amount input
  if ((pending.action === 'buy' || pending.action === 'sell') && pending.step === 'amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('Please enter a valid positive number. E.g. 100',
        Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]])
      );
    }

    pendingActions.delete(telegramId);

    const actionLabel = pending.action === 'buy' ? 'Buy' : 'Sell';
    const confirmAction = pending.action === 'buy' ? 'confirm_buy' : 'confirm_sell';

    return ctx.reply(
      `*${actionLabel} ${amount} USDC?*\n\n` +
      `Payment method: Bank Transfer\n` +
      `Spread: Fastest`,
      { parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(`Confirm ${actionLabel}`, `${confirmAction}:${amount}`)],
          [Markup.button.callback('Cancel', 'main_menu')]
        ])
      }
    );
  }

  // Chat message input
  if (pending.action === 'chat' && pending.orderId) {
    pendingActions.delete(telegramId);

    try {
      await ctx.sendChatAction('typing');
      await sendChatMessage(pending.orderId, session.merchantId, text);
      return ctx.reply(
        `Message sent!`,
        Markup.inlineKeyboard([
          [Markup.button.callback('View Chat', `chat:${pending.orderId}`)],
          [Markup.button.callback('Back to Order', `order_actions:${pending.orderId}`)]
        ])
      );
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      return ctx.reply(
        `Failed to send message: ${errMsg}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Try Again', `chat:${pending.orderId}`)],
          [Markup.button.callback('Back', `order_actions:${pending.orderId}`)]
        ])
      );
    }
  }

  // Unknown pending action - clear and show menu
  pendingActions.delete(telegramId);
  return ctx.reply(
    'Tap a button or type /menu to open the main menu.',
    Markup.inlineKeyboard([[Markup.button.callback('Menu', 'main_menu')]])
  );
}

// ============================================================================
// BOT: Launch
// ============================================================================

// Global error handler - prevents unhandled errors from crashing the process
bot.catch((err, ctx) => {
  console.error(`[Bot] Error for ${ctx.updateType}:`, err.message);
});

bot.launch();
console.log('Blip Money Bot Started!');
console.log(`API: ${API_BASE}`);
console.log(`Mock Mode: ${MOCK_MODE}`);
console.log(`Pusher: ${PUSHER_KEY} (${PUSHER_CLUSTER})`);
console.log(`Real-time notifications: ENABLED`);

// Validate sessions then reconnect Pusher for valid ones
validateSessions().then(() => {
  for (const [telegramId, session] of sessions) {
    subscribeToPusher(telegramId, session.merchantId);
  }
  console.log(`[Startup] Reconnected Pusher for ${sessions.size} valid sessions`);
}).catch(err => {
  console.error('[Startup] Session validation failed:', err.message);
  // Still try to connect Pusher as fallback
  for (const [telegramId, session] of sessions) {
    subscribeToPusher(telegramId, session.merchantId);
  }
});

// Process-level safety nets - log but don't crash
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err.message);
});

process.once('SIGINT', () => {
  for (const [id, conn] of pusherConnections) {
    try { conn.pusher.disconnect(); } catch (e) {}
  }
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  for (const [id, conn] of pusherConnections) {
    try { conn.pusher.disconnect(); } catch (e) {}
  }
  bot.stop('SIGTERM');
});
