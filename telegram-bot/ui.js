/**
 * UI helpers: display/formatting functions + main menu
 */
const { Markup } = require('telegraf');
const state = require('./state');
const api = require('./api');
const solanaWallet = require('./solana-wallet');

const { pendingActions } = state;

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
      // escrow_tx_hash alone = trade intent (not funded). Check escrowed_at for actual escrow lock.
      if (order.escrowed_at) {
        // Escrow actually locked — show payment buttons
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
  const walletStatus = solanaWallet.hasWallet(session.merchantId)
    ? (solanaWallet.getKeypair(session.merchantId) ? 'Unlocked' : 'Locked')
    : 'Not Set Up';
  const text = `*Blip Money*\nWelcome, *${session.username}*!\nWallet: *${walletStatus}*\n\nWhat would you like to do?`;
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Balance', 'balance'),
     Markup.button.callback('Wallet', 'wallet_menu')],
    [Markup.button.callback('Active Orders', 'my_orders'),
     Markup.button.callback('Available Orders', 'available_orders')],
    [Markup.button.callback('Transactions', 'history')],
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

function register(bot) {
  bot.action('main_menu', async (ctx) => {
    await ack(ctx);
    const session = api.getSession(ctx.from.id);
    if (!session) return ctx.reply('Please /start first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup'), Markup.button.callback('Login', 'login')]]));
    pendingActions.delete(ctx.from.id);
    await sendMainMenu(ctx, session);
  });
}

module.exports = {
  getDisplayType,
  statusEmoji,
  getActionButtons,
  formatOrderDetails,
  sendMainMenu,
  editOrReply,
  ack,
  safeSendMessage,
  register,
};
