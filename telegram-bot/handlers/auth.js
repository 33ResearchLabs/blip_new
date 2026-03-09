/**
 * Auth handlers: /start, signup, login flows
 */
const { Markup } = require('telegraf');
const axios = require('axios');
const state = require('../state');
const api = require('../api');
const pusher = require('../pusher');
const ui = require('../ui');

const { sessions, pendingSignups, pendingActions, merchantToTelegram, saveSessions } = state;
const { registerMerchant, loginMerchant, getSession, setSession, getMerchantBalance } = api;
const { subscribeToPusher, subscribeToActiveOrders } = pusher;
const { sendMainMenu } = ui;

const API_BASE = state.API_BASE;

function register(bot) {
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
        ctx.reply('Your previous session has expired.', Markup.inlineKeyboard([
          [Markup.button.callback('Create Account', 'signup'), Markup.button.callback('Login', 'login')]
        ]));
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
    await ui.ack(ctx);
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
    await ui.ack(ctx);
    pendingSignups.set(ctx.from.id, { step: 'login_email', data: {} });

    ctx.reply(
      `*Login to Your Account*\n\n` +
      `Enter your *email address*:`,
      { parse_mode: 'Markdown' }
    );
  });
}

// Handle signup/login text input
async function handleSignupFlow(ctx) {
  const telegramId = ctx.from.id;
  const signup = pendingSignups.get(telegramId);
  if (!signup) return false;

  const text = ctx.message.text.trim();

  const cancelKb = Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'main_menu')]]);
  const startKb = Markup.inlineKeyboard([[Markup.button.callback('Start Over', 'signup'), Markup.button.callback('Login', 'login')]]);

  switch (signup.step) {
    // ---- SIGNUP ----
    case 'username': {
      if (text.length < 3 || text.length > 20 || !/^[a-zA-Z0-9_]+$/.test(text)) {
        ctx.reply('Invalid username. Use 3-20 characters (letters, numbers, underscores). Try again:', cancelKb);
        return true;
      }
      signup.data.username = text;
      signup.step = 'email';
      ctx.reply(
        `Username: *${text}*\n\n` +
        `Step 2/3: Enter your *email address*:`,
        { parse_mode: 'Markdown', ...cancelKb }
      );
      return true;
    }

    case 'email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        ctx.reply('Invalid email format. Try again:', cancelKb);
        return true;
      }
      signup.data.email = text.toLowerCase();
      signup.step = 'password';
      ctx.reply(
        `Email: *${text}*\n\n` +
        `Step 3/3: Choose a *password*\n` +
        `(minimum 6 characters):`,
        { parse_mode: 'Markdown', ...cancelKb }
      );
      return true;
    }

    case 'password': {
      if (text.length < 6) {
        ctx.reply('Password too short. Minimum 6 characters. Try again:', cancelKb);
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
        ctx.reply(`${errMsg}`, startKb);
        pendingSignups.delete(telegramId);
      }
      return true;
    }

    // ---- LOGIN ----
    case 'login_email': {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(text)) {
        ctx.reply('Invalid email format. Try again:', cancelKb);
        return true;
      }
      signup.data.email = text.toLowerCase();
      signup.step = 'login_password';
      ctx.reply(
        `Email: *${text}*\n\n` +
        `Enter your *password*:`,
        { parse_mode: 'Markdown', ...cancelKb }
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
        ctx.reply(`${errMsg}`, startKb);
        pendingSignups.delete(telegramId);
      }
      return true;
    }

    default:
      pendingSignups.delete(telegramId);
      return false;
  }
}

module.exports = { register, handleSignupFlow };
