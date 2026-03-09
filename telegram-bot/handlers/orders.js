/**
 * Order handlers: balance, my orders, available orders, history,
 * buy/sell, accept, escrow, payment, release, cancel, chat
 */
const { Markup } = require('telegraf');
const axios = require('axios');
const solanaWallet = require('../solana-wallet');
const state = require('../state');
const api = require('../api');
const pusher = require('../pusher');
const ui = require('../ui');

const { sessions, pendingActions, MOCK_MODE, markOwnAction, API_BASE, merchantToTelegram, saveSessions } = state;
const {
  getSession, getOrders, getAvailableOrders, getOrderDetails,
  getMerchantBalance, getTransactionHistory,
  createOrder, acceptOrder, updateOrderStatus, cancelOrder,
  lockEscrow, releaseEscrow,
  sendChatMessage, getChatMessages,
} = api;
const { subscribeToOrderChat, unsubscribeFromOrderChat } = pusher;
const { getDisplayType, statusEmoji, getActionButtons, formatOrderDetails, sendMainMenu, editOrReply, ack, safeSendMessage } = ui;

// In-flight accept dedup: prevents double-tap race conditions
const pendingAccepts = new Set();

// Module-level so it can be exported for /orders command in bot.js
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

function register(bot) {

  bot.action('balance', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.from.id);
    if (!session) return;

    try {
      const balance = await getMerchantBalance(session.merchantId);
      let text = `*Your Balance*\n\n`;
      if (balance.on_chain_balance != null) {
        text += `On-chain: *${Number(balance.on_chain_balance).toLocaleString()} USDC*\n`;
      }
      text += `App Balance: *${Number(balance.db_balance || balance.current_balance).toLocaleString()} USDC*\n`;
      text += `Total In: +${Number(balance.total_credits).toLocaleString()} USDC\n`;
      text += `Total Out: -${Number(balance.total_debits).toLocaleString()} USDC\n`;
      text += `Transactions: ${balance.total_transactions}`;
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
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      orders = orders.filter(o => !o.is_my_order
        && (o.status === 'pending' || (o.status === 'escrowed' && !o.buyer_merchant_id))
        && new Date(o.created_at).getTime() > oneDayAgo);

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

    // Wallet checks
    if (!MOCK_MODE) {
      if (!solanaWallet.hasWallet(session.merchantId)) {
        return editOrReply(ctx, `*No Wallet*\n\nYou need a wallet to trade. Create one first.`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Create Wallet', 'wallet_create')],
            [Markup.button.callback('Menu', 'main_menu')]
          ])
        });
      }
      if (!solanaWallet.getKeypair(session.merchantId)) {
        return editOrReply(ctx, `*Wallet Locked*\n\nUnlock your wallet before creating orders.`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Unlock Wallet', 'wallet_unlock')],
            [Markup.button.callback('Menu', 'main_menu')]
          ])
        });
      }
    }

    try {
      // Sign intent on-chain (createTrade with side=buy, no escrow funding)
      let escrowFields = {};
      if (!MOCK_MODE) {
        await editOrReply(ctx, '*Signing trade intent on-chain...*', { parse_mode: 'Markdown' });
        const result = await solanaWallet.createTradeOnChain(session.merchantId, amount);
        escrowFields = {
          escrow_tx_hash: result.txHash,
          escrow_trade_id: result.tradeId,
          escrow_trade_pda: result.tradePda,
          escrow_pda: result.escrowPda,
          escrow_creator_wallet: result.creatorWallet,
          escrow_funded: false, // BUY = trade intent only, no funds locked
        };
      }

      const order = await createOrder(session.merchantId, 'buy', amount, 'bank', escrowFields);
      subscribeToOrderChat(ctx.from.id, session.merchantId, order.id);
      const text =
        `*Buy Order Created!*\n\n` +
        `Order: \`${order.order_number || order.id.slice(0, 8)}\`\n` +
        `Amount: ${order.crypto_amount} USDC\n` +
        `Rate: ${order.rate} AED/USDC\n` +
        `Total: ${order.fiat_amount} AED\n` +
        `Status: *${order.status}*\n` +
        (escrowFields.escrow_tx_hash ? `TX: \`${escrowFields.escrow_tx_hash.slice(0, 12)}...\`\n` : '') +
        `\nWaiting for a seller to accept...`;

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
      // For SELL orders, seller must lock escrow BEFORE the order goes live.
      // Pre-check balance before attempting anything.
      const balanceInfo = await getMerchantBalance(session.merchantId);
      const currentBalance = balanceInfo.current_balance || 0;
      const solBal = !MOCK_MODE && solanaWallet.getPublicKey(session.merchantId)
        ? await solanaWallet.getSolBalance(solanaWallet.getPublicKey(session.merchantId)).catch(() => 0)
        : null;
      if (currentBalance < amount) {
        const solLine = solBal !== null ? `\nSOL: ${solBal.toFixed(4)}` : '';
        return editOrReply(ctx, `*Insufficient balance*\n\nYou need ${amount} USDT but only have ${currentBalance.toFixed(2)} USDT.${solLine}\nDeposit more funds to create a sell order.`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Check Balance', 'balance')],
            [Markup.button.callback('Menu', 'main_menu')]
          ])
        });
      }
      if (solBal !== null && solBal < 0.01) {
        return editOrReply(ctx, `*Insufficient SOL for fees*\n\nYou have ${solBal.toFixed(4)} SOL, need at least 0.01.\nUSDT: ${currentBalance.toFixed(2)}`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Check Balance', 'balance')],
            [Markup.button.callback('Menu', 'main_menu')]
          ])
        });
      }

      // Require unlocked wallet in non-mock mode.
      let escrowFields = {};
      if (!MOCK_MODE) {
        if (!solanaWallet.getKeypair(session.merchantId)) {
          return editOrReply(ctx, 'Wallet must be unlocked to create sell orders.\nUse /unlock first.', {
            ...Markup.inlineKeyboard([
              [Markup.button.callback('Unlock Wallet', 'wallet_unlock')],
              [Markup.button.callback('Menu', 'main_menu')]
            ])
          });
        }
        await editOrReply(ctx, '*Locking escrow on-chain...*', { parse_mode: 'Markdown' });
        const result = await solanaWallet.fundEscrow(session.merchantId, amount);
        escrowFields = {
          escrow_tx_hash: result.txHash,
          escrow_trade_id: result.tradeId,
          escrow_trade_pda: result.tradePda,
          escrow_pda: result.escrowPda,
          escrow_creator_wallet: result.creatorWallet,
          escrow_funded: true, // SELL = actual escrow funded
        };
      }

      const order = await createOrder(session.merchantId, 'sell', amount, 'bank', escrowFields);
      subscribeToOrderChat(ctx.from.id, session.merchantId, order.id);
      const text =
        `*Sell Order Created!*\n\n` +
        `Order: \`${order.order_number || order.id.slice(0, 8)}\`\n` +
        `Amount: ${order.crypto_amount} USDC\n` +
        `Rate: ${order.rate} AED/USDC\n` +
        `Total: ${order.fiat_amount} AED\n` +
        `Status: *${order.status}*\n\n` +
        (escrowFields.escrow_tx_hash ? 'Escrow locked. Waiting for a buyer...' : 'Waiting for a buyer to accept...');

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

      // Auto-fix: if I'm the buyer and order has escrow but I never called acceptTrade on-chain
      if (!MOCK_MODE && order.buyer_merchant_id === session.merchantId
          && order.escrow_tx_hash && order.escrow_creator_wallet && order.escrow_trade_id
          && !['completed', 'cancelled', 'expired'].includes(order.status)) {
        if (!solanaWallet.getKeypair(session.merchantId)) {
          // Wallet locked — warn user that on-chain join is needed
          const text = `*⚠️ Wallet Locked*\n\nYou need to unlock your wallet to join this escrow on-chain.\nWithout this, the seller won't be able to release funds to you.`;
          await editOrReply(ctx, text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('Unlock Wallet', 'wallet_unlock')],
              [Markup.button.callback('View Order', `order_actions:${orderId}`)],
              [Markup.button.callback('Menu', 'main_menu')]
            ])
          });
          return;
        }
        try {
          await solanaWallet.acceptTradeOnChain(
            session.merchantId,
            order.escrow_creator_wallet,
            Number(order.escrow_trade_id)
          );
          console.log(`[OrderView] Auto-called acceptTrade for order ${orderId}`);
        } catch (e) {
          if (e.message.includes('Insufficient SOL')) {
            // SOL balance too low — warn user
            const pubkey = solanaWallet.getPublicKey(session.merchantId);
            const text = `*⚠️ Low SOL Balance*\n\n${e.message}\n\nYou need SOL to join this escrow on-chain. Without it, the seller can't release funds to you.\n\nFund SOL to: \`${pubkey}\``;
            await editOrReply(ctx, text, {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('Retry', `order_actions:${orderId}`)],
                [Markup.button.callback('Menu', 'main_menu')]
              ])
            });
            return;
          }
          // Already accepted or other non-critical error — continue
          console.log(`[OrderView] acceptTrade skipped: ${e.message}`);
        }
      }

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

    // Dedup: block if already processing this accept
    const dedupKey = `${session.merchantId}:${orderId}`;
    if (pendingAccepts.has(dedupKey)) {
      return editOrReply(ctx, 'Already accepting this order, please wait...', {
        ...Markup.inlineKeyboard([[Markup.button.callback('My Orders', 'my_orders')]])
      });
    }
    pendingAccepts.add(dedupKey);

    try {
    // Wallet must be unlocked to accept orders (needed for on-chain escrow operations)
    if (!MOCK_MODE && !solanaWallet.getKeypair(session.merchantId)) {
      await editOrReply(ctx, `*Wallet locked!*\n\nUnlock your wallet first before accepting orders.\nUse /wallet → Unlock to enter your PIN.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Unlock Wallet', 'wallet_unlock')],
          [Markup.button.callback('Menu', 'main_menu')]
        ])
      });
      return;
    }

    // SOL balance check — buyer needs SOL for on-chain acceptTrade
    if (!MOCK_MODE) {
      const pubkey = solanaWallet.getPublicKey(session.merchantId);
      if (pubkey) {
        try {
          const solBal = await solanaWallet.getSolBalance(pubkey);
          if (solBal < 0.01) {
            await editOrReply(ctx, `*Insufficient SOL*\n\nYou need at least 0.01 SOL for on-chain fees to accept orders.\nYou have: ${solBal.toFixed(4)} SOL\n\nFund your wallet:\n\`${pubkey}\``, {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('Retry', `accept_order:${orderId}`)],
                [Markup.button.callback('Check Balance', 'wallet_balance')],
                [Markup.button.callback('Menu', 'main_menu')]
              ])
            });
            return;
          }
        } catch (e) {
          console.log(`[Accept] SOL balance check failed: ${e.message}`);
        }
      }
    }

    // Step 1: Accept the order (the critical action)
    let acceptedOrder;
    try {
      acceptedOrder = await acceptOrder(orderId, session.merchantId);
      markOwnAction(session.merchantId, orderId, 'accepted');
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

    // Step 2: Call acceptTrade on-chain if order has escrow data (buyer joins trade PDA)
    if (!MOCK_MODE && acceptedOrder.escrow_creator_wallet && acceptedOrder.escrow_trade_id) {
      try {
        await solanaWallet.acceptTradeOnChain(
          session.merchantId,
          acceptedOrder.escrow_creator_wallet,
          Number(acceptedOrder.escrow_trade_id)
        );
        console.log(`[Accept] acceptTrade on-chain success for order ${orderId}`);
      } catch (e) {
        // If already accepted or other non-fatal error, log and continue
        console.log(`[Accept] acceptTrade on-chain skipped: ${e.message}`);
      }
    }

    // Step 3: Subscribe to chat (non-critical)
    try {
      subscribeToOrderChat(ctx.from.id, session.merchantId, orderId);
    } catch (err) {
      console.error(`[Accept] Chat subscription failed for ${orderId}:`, err.message);
    }

    // Step 4: Show success with order details
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
      await editOrReply(ctx, `*Order Accepted!* \u2713\n\nTap below to see order details.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('View Order', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
      });
    }
    } finally {
      pendingAccepts.delete(dedupKey);
    }
  });

  // Keep old quick_accept button handler for backwards compat
  bot.action(/^quick_accept:(.+)$/, async (ctx) => {
    await ack(ctx, 'Accepting order...');
    const orderId = ctx.match[1];
    const session = getSession(ctx.from.id);
    if (!session) {
      return ctx.reply('You need to log in first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup'), Markup.button.callback('Login', 'login')]]));
    }

    // Dedup: block if already processing this accept
    const dedupKey = `${session.merchantId}:${orderId}`;
    if (pendingAccepts.has(dedupKey)) {
      return editOrReply(ctx, 'Already accepting this order, please wait...', {
        ...Markup.inlineKeyboard([[Markup.button.callback('My Orders', 'my_orders')]])
      });
    }
    pendingAccepts.add(dedupKey);

    try {
    let acceptedOrder;
    try {
      acceptedOrder = await acceptOrder(orderId, session.merchantId);
      markOwnAction(session.merchantId, orderId, 'accepted');
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || 'Unknown error';
      return editOrReply(ctx, `Failed to accept: ${errMsg}`, {
        ...Markup.inlineKeyboard([[Markup.button.callback('Available Orders', 'available_orders'), Markup.button.callback('Menu', 'main_menu')]])
      });
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
      await editOrReply(ctx, `*Order Accepted!* \u2713\n\nTap below to see order details.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('View Order', `order_actions:${orderId}`), Markup.button.callback('Menu', 'main_menu')]])
      });
    }
    } finally {
      pendingAccepts.delete(dedupKey);
    }
  });

  // Lock Escrow
  bot.action(/^lock_escrow:(.+)$/, async (ctx) => {
    await ack(ctx, 'Locking escrow...');
    const orderId = ctx.match[1];
    const session = getSession(ctx.from.id);
    if (!session) return;

    // Wallet lock guard
    if (!MOCK_MODE && !solanaWallet.getKeypair(session.merchantId)) {
      await editOrReply(ctx, `*Wallet Locked!*\n\nYou need to unlock your wallet before locking escrow.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Unlock Wallet', 'wallet_unlock')],
          [Markup.button.callback('Cancel Order', `cancel_order:${orderId}`)],
          [Markup.button.callback('Menu', 'main_menu')]
        ])
      });
      return;
    }

    // Step 1: Lock escrow (the critical action)
    try {
      await lockEscrow(orderId, session.merchantId);
      markOwnAction(session.merchantId, orderId, 'escrowed');
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      await editOrReply(ctx, `Failed to lock escrow: ${errMsg}`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Retry', `lock_escrow:${orderId}`)],
          [Markup.button.callback('Cancel Order', `cancel_order:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]
        ])
      });
      return;
    }

    // Step 2: Fetch updated order for display (non-critical)
    try {
      const order = await getOrderDetails(orderId);
      const text = `*Escrow Locked!*\n\n${order.crypto_amount} USDC is now in escrow.\nWaiting for buyer to send ${order.fiat_amount} AED.`;
      await editOrReply(ctx, text, { parse_mode: 'Markdown', ...getActionButtons(order, session.merchantId) });
    } catch (err) {
      await editOrReply(ctx, `*Escrow Locked!* \u2713\n\nTap below to see order details.`, {
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
      markOwnAction(session.merchantId, orderId, 'payment_sent');
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
      await editOrReply(ctx, `*Payment Marked as Sent!* \u2713\n\nTap below to see order details.`, {
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

    // Wallet lock guard
    if (!MOCK_MODE && !solanaWallet.getKeypair(session.merchantId)) {
      await editOrReply(ctx, `*Wallet Locked!*\n\nYou need to unlock your wallet before confirming payment & releasing escrow.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Unlock Wallet', 'wallet_unlock')],
          [Markup.button.callback('Cancel Order', `cancel_order:${orderId}`)],
          [Markup.button.callback('Menu', 'main_menu')]
        ])
      });
      return;
    }

    try {
      // Atomic operation: confirm payment + release escrow + complete order
      await releaseEscrow(orderId, session.merchantId);
      markOwnAction(session.merchantId, orderId, 'completed');
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      await editOrReply(ctx, `Failed to confirm payment: ${errMsg}`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Retry', `confirm_payment:${orderId}`)],
          [Markup.button.callback('Cancel Order', `cancel_order:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]
        ])
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
      await editOrReply(ctx, `*Trade Completed!* \u2713\n\nEscrow released successfully.`, {
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

    // Wallet lock guard
    if (!MOCK_MODE && !solanaWallet.getKeypair(session.merchantId)) {
      await editOrReply(ctx, `*Wallet Locked!*\n\nYou need to unlock your wallet before releasing escrow.`, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Unlock Wallet', 'wallet_unlock')],
          [Markup.button.callback('Cancel Order', `cancel_order:${orderId}`)],
          [Markup.button.callback('Menu', 'main_menu')]
        ])
      });
      return;
    }

    try {
      await releaseEscrow(orderId, session.merchantId);
      markOwnAction(session.merchantId, orderId, 'completed');
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message || '';
      // Detect counterparty not set on-chain
      if (errMsg.includes('ConstraintRaw') || errMsg.includes('counterparty_ata')) {
        await editOrReply(ctx, `*Cannot release yet*\n\nThe buyer hasn't joined the escrow on-chain.\nThe buyer needs to unlock their wallet and view this order first.`, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Retry', `release_escrow:${orderId}`)],
            [Markup.button.callback('Cancel Order', `cancel_order:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]
          ])
        });
        return;
      }
      await editOrReply(ctx, `Failed to release escrow: ${errMsg}`, {
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Retry', `release_escrow:${orderId}`)],
          [Markup.button.callback('Cancel Order', `cancel_order:${orderId}`), Markup.button.callback('Back', `order_actions:${orderId}`)]
        ])
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
      await editOrReply(ctx, `*Trade Completed!* \u2713\n\nEscrow released successfully. Tap below to check your balance.`, {
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
}

// Handle order-related pending actions from text input
async function handleOrderPendingAction(ctx, session, pending) {
  const telegramId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Buy/Sell amount input
  if ((pending.action === 'buy' || pending.action === 'sell') && pending.step === 'amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('Enter a valid amount (e.g. 100)', Markup.inlineKeyboard([
        [Markup.button.callback('Cancel', 'main_menu')]
      ]));
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

  // Not handled by this module
  return false;
}

module.exports = { register, handleOrderPendingAction, showMyOrders };
