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
const solanaWallet = require('./solana-wallet');

// ─── Modules ─────────────────────────────────────────────────────────────────
const state = require('./state');
const api = require('./api');
const ui = require('./ui');
const pusher = require('./pusher');
const authHandlers = require('./handlers/auth');
const walletHandlers = require('./handlers/wallet');
const orderHandlers = require('./handlers/orders');

// ─── Boot ────────────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.BOT_TOKEN);

// Give pusher module access to bot instance for sending notifications
pusher.setBotInstance(bot);

// ─── Register all handler modules ───────────────────────────────────────────
ui.register(bot);
authHandlers.register(bot);
walletHandlers.register(bot);
orderHandlers.register(bot);

// ─── Slash Commands ──────────────────────────────────────────────────────────

bot.command('menu', async (ctx) => {
  const session = api.getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup'), Markup.button.callback('Login', 'login')]]));
  await ui.sendMainMenu(ctx, session);
});

bot.command('balance', async (ctx) => {
  const session = api.getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup'), Markup.button.callback('Login', 'login')]]));

  try {
    const balance = await api.getMerchantBalance(session.merchantId);
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
    ctx.reply('Error fetching balance.', Markup.inlineKeyboard([
      [Markup.button.callback('Retry', 'balance'), Markup.button.callback('Menu', 'main_menu')]
    ]));
  }
});

bot.command('help', (ctx) => {
  ctx.reply(
    `*Blip Money Bot*\n\n` +
    `Use the buttons to navigate!\n\n` +
    `*Commands:*\n` +
    `/menu - Main menu\n` +
    `/balance - Check balance\n` +
    `/orders - View your orders\n` +
    `/available - Available orders\n` +
    `/wallet - Wallet management\n` +
    `/logout - Sign out`,
    { parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('Menu', 'main_menu'), Markup.button.callback('Balance', 'balance')],
        [Markup.button.callback('My Orders', 'my_orders'), Markup.button.callback('Available', 'available_orders')],
      ])
    }
  );
});

bot.command('orders', async (ctx) => {
  const session = api.getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup'), Markup.button.callback('Login', 'login')]]));
  await orderHandlers.showMyOrders(ctx, 'all');
});

bot.command('available', async (ctx) => {
  const session = api.getSession(ctx.from.id);
  if (!session) return ctx.reply('Please /start first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup'), Markup.button.callback('Login', 'login')]]));

  try {
    let orders = await api.getAvailableOrders(session.merchantId);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    orders = orders.filter(o => !o.is_my_order
      && (o.status === 'pending' || (o.status === 'escrowed' && !o.buyer_merchant_id))
      && new Date(o.created_at).getTime() > oneDayAgo);

    if (orders.length === 0) return ctx.reply('No available orders to accept right now.', Markup.inlineKeyboard([
      [Markup.button.callback('Refresh', 'available_orders'), Markup.button.callback('Menu', 'main_menu')]
    ]));

    let msg = `*Available Orders* (${orders.length})\n\n`;
    const buttons = [];
    orders.slice(0, 8).forEach((o, i) => {
      const type = ui.getDisplayType(o, session.merchantId).toUpperCase();
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
    ctx.reply('Error fetching available orders.', Markup.inlineKeyboard([
      [Markup.button.callback('Retry', 'available_orders'), Markup.button.callback('Menu', 'main_menu')]
    ]));
  }
});

bot.command('logout', (ctx) => {
  const telegramId = ctx.from.id;
  const session = api.getSession(telegramId);
  pusher.unsubscribeFromPusher(telegramId);
  if (session) state.merchantToTelegram.delete(session.merchantId);
  state.sessions.delete(telegramId);
  state.pendingActions.delete(telegramId);
  state.saveSessions();
  ctx.reply('Logged out. Notifications stopped.', Markup.inlineKeyboard([
    [Markup.button.callback('Login', 'login'), Markup.button.callback('Create Account', 'signup')]
  ]));
});

// ─── Text Handler ────────────────────────────────────────────────────────────

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const telegramId = ctx.from.id;

  // 1. Signup/login flow
  const isSignup = await authHandlers.handleSignupFlow(ctx);
  if (isSignup) return;

  // 2. Check if user has session
  const session = api.getSession(telegramId);
  if (!session) {
    return ctx.reply(
      `Hey! You need an account first.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Create Account', 'signup'), Markup.button.callback('Login', 'login')]
      ])
    );
  }

  // 3. Quick-accept shortcut
  const lower = ctx.message.text.toLowerCase().trim();
  if (/^(accept it|accept order|take it|take order|accept this|take this|yes accept|accept)$/i.test(lower) && session.lastNotifiedOrderId) {
    try {
      await ctx.sendChatAction('typing');
      const order = await api.acceptOrder(session.lastNotifiedOrderId, session.merchantId);
      pusher.subscribeToOrderChat(telegramId, session.merchantId, session.lastNotifiedOrderId);
      const type = ui.getDisplayType(order, session.merchantId).toUpperCase();
      const keyboard = ui.getActionButtons(order, session.merchantId);
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
      return ctx.reply(`Failed to accept: ${errMsg}`, Markup.inlineKeyboard([
        [Markup.button.callback('Available Orders', 'available_orders')],
        [Markup.button.callback('Menu', 'main_menu')]
      ]));
    }
  }

  // 4. Handle pending actions
  const pending = state.pendingActions.get(telegramId);
  if (pending) {
    // Route to the right handler based on action type
    if (pending.action === 'wallet_create_password' || pending.action === 'wallet_import_key' || pending.action === 'wallet_unlock_password') {
      return walletHandlers.handleWalletPendingAction(ctx, session, pending);
    }
    if (pending.action === 'buy' || pending.action === 'sell' || pending.action === 'chat') {
      return orderHandlers.handleOrderPendingAction(ctx, session, pending);
    }
    // Unknown pending action - clear
    state.pendingActions.delete(telegramId);
  }

  // 5. No pending action - show menu hint
  return ctx.reply(
    'Tap a button or type /menu to open the main menu.',
    Markup.inlineKeyboard([[Markup.button.callback('Menu', 'main_menu')]])
  );
});

// ─── Launch ──────────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error(`[Bot] Error for ${ctx.updateType}:`, err.message);
});

bot.launch();
console.log('Blip Money Bot Started!');
console.log(`API: ${state.API_BASE}`);
console.log(`Mock Mode: ${state.MOCK_MODE}`);
console.log(`Pusher: ${state.PUSHER_KEY} (${state.PUSHER_CLUSTER})`);
console.log(`Real-time notifications: ENABLED`);

// Validate sessions then reconnect Pusher for valid ones
api.validateSessions().then(() => {
  for (const [telegramId, session] of state.sessions) {
    pusher.subscribeToPusher(telegramId, session.merchantId);
  }
  console.log(`[Startup] Reconnected Pusher for ${state.sessions.size} valid sessions`);
}).catch(err => {
  console.error('[Startup] Session validation failed:', err.message);
  for (const [telegramId, session] of state.sessions) {
    pusher.subscribeToPusher(telegramId, session.merchantId);
  }
});

// Process-level safety nets
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught exception:', err.message);
});

process.once('SIGINT', () => {
  for (const [id, conn] of state.pusherConnections) {
    try { conn.pusher.disconnect(); } catch (e) {}
  }
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  for (const [id, conn] of state.pusherConnections) {
    try { conn.pusher.disconnect(); } catch (e) {}
  }
  bot.stop('SIGTERM');
});
