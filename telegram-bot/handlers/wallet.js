/**
 * Wallet handlers: wallet menu, create, import, unlock, lock, export + text input handlers
 */
const { Markup } = require('telegraf');
const axios = require('axios');
const solanaWallet = require('../solana-wallet');
const state = require('../state');
const api = require('../api');
const ui = require('../ui');

const { sessions, pendingActions, MOCK_MODE, API_BASE, saveSessions } = state;
const { getSession, getOrders, getOrderDetails } = api;
const { sendMainMenu, editOrReply, ack } = ui;

function register(bot) {
  // ============================================================================
  // ACTIONS: Wallet Management
  // ============================================================================

  bot.action('wallet_menu', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.from.id);
    if (!session) return;

    const hasW = solanaWallet.hasWallet(session.merchantId);
    const isUnlocked = !!solanaWallet.getKeypair(session.merchantId);
    const pubkey = solanaWallet.getPublicKey(session.merchantId);

    let text, buttons;
    if (!hasW) {
      text = `*Wallet Setup*\n\nNo wallet configured yet.\nCreate a new one or import an existing private key.`;
      buttons = [
        [Markup.button.callback('Create Wallet', 'wallet_create')],
        [Markup.button.callback('Import Key', 'wallet_import')],
        [Markup.button.callback('Back', 'main_menu')],
      ];
    } else if (!isUnlocked) {
      text = `*Wallet (Locked)*\n\nAddress: \`${pubkey}\`\n\nUnlock your wallet to trade on-chain.`;
      buttons = [
        [Markup.button.callback('Unlock', 'wallet_unlock')],
        [Markup.button.callback('Back', 'main_menu')],
      ];
    } else {
      let balText = '';
      try {
        const usdt = await solanaWallet.getUsdtBalance(pubkey);
        const sol = await solanaWallet.getSolBalance(pubkey);
        balText = `\nUSDT: *${usdt.toFixed(2)}*\nSOL: *${sol.toFixed(4)}*`;
      } catch { balText = '\n(Balance unavailable)'; }

      text = `*Wallet (Unlocked)*\n\nAddress: \`${pubkey}\`${balText}`;
      buttons = [
        [Markup.button.callback('Refresh Balance', 'wallet_menu')],
        [Markup.button.callback('Export Key', 'wallet_export'),
         Markup.button.callback('Lock', 'wallet_lock')],
        [Markup.button.callback('Back', 'main_menu')],
      ];
    }

    await editOrReply(ctx, text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  });

  bot.action('wallet_create', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.from.id);
    if (!session) return;

    if (solanaWallet.hasWallet(session.merchantId)) {
      return editOrReply(ctx, 'Wallet already exists. Use Import to replace it.', {
        ...Markup.inlineKeyboard([[Markup.button.callback('Back', 'wallet_menu')]]),
      });
    }

    pendingActions.set(ctx.from.id, { action: 'wallet_create_password', step: 1 });
    await editOrReply(ctx, '*Create Wallet*\n\nEnter a password to encrypt your wallet.\nYou will need this password to unlock the wallet for trading.\n\n(Password will be deleted from chat for security)', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'wallet_menu')]]),
    });
  });

  bot.action('wallet_import', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.from.id);
    if (!session) return;

    pendingActions.set(ctx.from.id, { action: 'wallet_import_key', step: 1 });
    await editOrReply(ctx, '*Import Wallet*\n\nPaste your base58 private key.\n\n(Key will be deleted from chat for security)', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'wallet_menu')]]),
    });
  });

  bot.action('wallet_unlock', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.from.id);
    if (!session) return;

    pendingActions.set(ctx.from.id, { action: 'wallet_unlock_password' });
    await editOrReply(ctx, '*Unlock Wallet*\n\nEnter your wallet password:', {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'wallet_menu')]]),
    });
  });

  bot.action('wallet_lock', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.from.id);
    if (!session) return;

    solanaWallet.lockWallet(session.merchantId);
    await editOrReply(ctx, 'Wallet locked.', {
      ...Markup.inlineKeyboard([[Markup.button.callback('Back', 'wallet_menu')]]),
    });
  });

  bot.action('wallet_export', async (ctx) => {
    await ack(ctx);
    const session = getSession(ctx.from.id);
    if (!session) return;

    try {
      const key = solanaWallet.exportPrivateKey(session.merchantId);
      // Send as a self-destructing message (user should save it)
      const msg = await ctx.reply(`*Your Private Key (SAVE THIS!)*\n\n\`${key}\`\n\nThis message will be deleted in 30 seconds.`, { parse_mode: 'Markdown' });
      setTimeout(async () => {
        try { await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id); } catch {}
      }, 30000);
    } catch (e) {
      await ctx.reply(`Error: ${e.message}`, Markup.inlineKeyboard([
        [Markup.button.callback('Wallet', 'wallet_menu'), Markup.button.callback('Menu', 'main_menu')]
      ]));
    }
  });

  // Wallet slash command
  bot.command('wallet', async (ctx) => {
    const session = getSession(ctx.from.id);
    if (!session) return ctx.reply('Please /start first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup')]]));
    // Trigger the wallet menu action
    ctx.callbackQuery = { data: 'wallet_menu' };
    await ctx.reply('Opening wallet...', {
      ...Markup.inlineKeyboard([[Markup.button.callback('Wallet', 'wallet_menu')]]),
    });
  });

  bot.command('unlock', async (ctx) => {
    const session = getSession(ctx.from.id);
    if (!session) return ctx.reply('Please /start first.', Markup.inlineKeyboard([[Markup.button.callback('Start', 'signup'), Markup.button.callback('Login', 'login')]]));
    if (!solanaWallet.hasWallet(session.merchantId)) return ctx.reply('No wallet set up.', Markup.inlineKeyboard([
      [Markup.button.callback('Create Wallet', 'wallet_create'), Markup.button.callback('Import Key', 'wallet_import')]
    ]));
    pendingActions.set(ctx.from.id, { action: 'wallet_unlock_password' });
    await ctx.reply('Enter your wallet password:', Markup.inlineKeyboard([
      [Markup.button.callback('Cancel', 'wallet_menu')]
    ]));
  });
}

// Handle wallet-related pending actions from text input
async function handleWalletPendingAction(ctx, session, pending) {
  const telegramId = ctx.from.id;
  const text = ctx.message.text.trim();

  // Wallet: create password
  if (pending.action === 'wallet_create_password') {
    try { await ctx.deleteMessage(); } catch {} // Delete password from chat
    pendingActions.delete(telegramId);

    try {
      const { publicKey } = solanaWallet.generateWallet(session.merchantId, text);

      // Update wallet address in backend
      try {
        await axios.patch(`${API_BASE}/auth/merchant`, {
          merchant_id: session.merchantId,
          wallet_address: publicKey,
        });
      } catch (e) {
        console.error('[Wallet] Failed to update wallet address in backend:', e.message);
      }

      // Update session
      session.walletAddress = publicKey;
      saveSessions();

      return ctx.reply(
        `*Wallet Created!*\n\n` +
        `Address: \`${publicKey}\`\n\n` +
        `Your wallet is encrypted and unlocked.\n` +
        `Fund it with SOL (for fees) and USDT to start trading.\n\n` +
        `Use /wallet to manage your wallet.`,
        { parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('Wallet', 'wallet_menu')],
            [Markup.button.callback('Menu', 'main_menu')],
          ])
        }
      );
    } catch (e) {
      return ctx.reply(`Failed to create wallet: ${e.message}`, Markup.inlineKeyboard([
        [Markup.button.callback('Try Again', 'wallet_create'), Markup.button.callback('Menu', 'main_menu')]
      ]));
    }
  }

  // Wallet: import key
  if (pending.action === 'wallet_import_key') {
    try { await ctx.deleteMessage(); } catch {} // Delete key from chat

    if (pending.step === 1) {
      // Validate it looks like a base58 key
      if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(text)) {
        return ctx.reply('Invalid private key format. Should be a base58-encoded Solana secret key.', {
          ...Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'wallet_menu')]]),
        });
      }
      pending.data = { privateKey: text };
      pending.step = 2;
      return ctx.reply('Now enter a password to encrypt this key:', Markup.inlineKeyboard([
        [Markup.button.callback('Cancel', 'wallet_menu')]
      ]));
    }

    if (pending.step === 2) {
      pendingActions.delete(telegramId);
      try {
        const { publicKey } = solanaWallet.importWallet(session.merchantId, pending.data.privateKey, text);

        try {
          await axios.patch(`${API_BASE}/auth/merchant`, {
            merchant_id: session.merchantId,
            wallet_address: publicKey,
          });
        } catch (e) {
          console.error('[Wallet] Failed to update wallet address in backend:', e.message);
        }

        session.walletAddress = publicKey;
        saveSessions();

        return ctx.reply(
          `*Wallet Imported!*\n\nAddress: \`${publicKey}\`\nWallet is unlocked and ready.`,
          { parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('Wallet', 'wallet_menu')],
              [Markup.button.callback('Menu', 'main_menu')],
            ])
          }
        );
      } catch (e) {
        return ctx.reply(`Import failed: ${e.message}`, Markup.inlineKeyboard([
          [Markup.button.callback('Try Again', 'wallet_import'), Markup.button.callback('Menu', 'main_menu')]
        ]));
      }
    }
  }

  // Wallet: unlock password
  if (pending.action === 'wallet_unlock_password') {
    try { await ctx.deleteMessage(); } catch {} // Delete password from chat
    pendingActions.delete(telegramId);

    try {
      solanaWallet.unlockWallet(session.merchantId, text);

      // Auto-fix: call acceptTrade for any active orders where I'm the buyer
      if (!MOCK_MODE) {
        (async () => {
          try {
            const orders = await getOrders(session.merchantId);
            for (const o of orders) {
              if (o.buyer_merchant_id === session.merchantId
                  && o.escrow_tx_hash && o.escrow_creator_wallet && o.escrow_trade_id
                  && !['completed', 'cancelled', 'expired'].includes(o.status)) {
                try {
                  await solanaWallet.acceptTradeOnChain(
                    session.merchantId,
                    o.escrow_creator_wallet,
                    Number(o.escrow_trade_id)
                  );
                  console.log(`[Unlock] Auto-accepted trade for order ${o.order_number}`);
                } catch (e2) {
                  console.log(`[Unlock] acceptTrade skipped for ${o.order_number}: ${e2.message}`);
                }
              }
            }
          } catch (e2) {
            console.error('[Unlock] Auto-accept scan failed:', e2.message);
          }
        })();
      }

      return ctx.reply(
        'Wallet unlocked! You can now trade on-chain.',
        Markup.inlineKeyboard([
          [Markup.button.callback('Wallet', 'wallet_menu')],
          [Markup.button.callback('Menu', 'main_menu')],
        ])
      );
    } catch (e) {
      return ctx.reply(
        `${e.message}`,
        Markup.inlineKeyboard([
          [Markup.button.callback('Try Again', 'wallet_unlock')],
          [Markup.button.callback('Menu', 'main_menu')],
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

module.exports = { register, handleWalletPendingAction };
