/**
 * AI brain for Blip Telegram Bot
 * Uses Claude Haiku with tool use to handle natural language messages.
 * Every tool maps 1:1 to an existing bot.js API helper.
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tool definitions ──────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'check_balance',
    description: 'Get the merchant\'s current USDC balance and transaction summary.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_order',
    description: 'Create a buy or sell USDC order.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['buy', 'sell'], description: 'buy = acquire USDC, sell = trade USDC for fiat' },
        amount: { type: 'number', description: 'USDC amount (positive number)' },
        payment_method: { type: 'string', enum: ['bank', 'upi'], description: 'Payment method, default bank' },
      },
      required: ['type', 'amount'],
    },
  },
  {
    name: 'get_my_orders',
    description: 'List the merchant\'s active or recent orders.',
    input_schema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['all', 'active', 'completed', 'cancelled'], description: 'Filter by status group' },
      },
      required: [],
    },
  },
  {
    name: 'get_available_orders',
    description: 'List orders posted by other merchants that this merchant can accept.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_order_details',
    description: 'Get full details of a specific order by ID or order number.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order UUID or order number (e.g. ORD-12345)' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'accept_order',
    description: 'Accept / claim an available order from the marketplace.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order UUID to accept' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'lock_escrow',
    description: 'Lock USDC escrow for an accepted sell order (merchant is seller).',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order UUID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'mark_payment_sent',
    description: 'Mark that fiat payment has been sent to the seller (buyer action).',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order UUID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'confirm_payment',
    description: 'Confirm fiat payment received and release escrow to complete the trade (seller action).',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order UUID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'cancel_order',
    description: 'Cancel a pending or accepted order.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order UUID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'get_transaction_history',
    description: 'Get the merchant\'s recent transaction history.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max transactions to return (default 10)' },
      },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = `You are the AI assistant for Blip Money, a P2P USDC trading platform.
You help merchants manage their USDC trading via Telegram.

HOW TRADING WORKS:
- BUY order: you want to acquire USDC by paying fiat → seller locks USDC escrow → you send fiat → seller confirms → escrow released to you
- SELL order: you want to sell USDC for fiat → you lock USDC escrow → buyer sends fiat → you confirm payment → escrow released to buyer
- Orders can also be accepted from the marketplace (other merchants' pending orders)

YOUR ROLE:
- Understand user intent from natural language
- Call the right tools to fulfil requests
- Be concise and friendly
- For financial actions (accept, escrow, payment), always confirm intent if the message is ambiguous
- Never invent order IDs — always use get_my_orders or get_available_orders first if uncertain
- Currency: USDC (crypto), AED (fiat) unless user specifies otherwise

RESPONSE STYLE:
- Short, clear messages
- Use amounts like "100 USDC" or "367 AED"
- No markdown headers, keep it conversational
- If a tool fails, explain what went wrong simply`;

// ── Conversation history (per-user) ──────────────────────────────────

const conversationHistory = new Map(); // telegramId -> [{role, content}]
const MAX_HISTORY = 10; // turns to keep (5 user + 5 assistant)

function getHistory(telegramId) {
  return conversationHistory.get(telegramId) || [];
}

function addToHistory(telegramId, role, content) {
  const history = getHistory(telegramId);
  history.push({ role, content });
  // Keep last MAX_HISTORY turns
  while (history.length > MAX_HISTORY * 2) history.splice(0, 2);
  conversationHistory.set(telegramId, history);
}

function clearHistory(telegramId) {
  conversationHistory.delete(telegramId);
}

// ── Tool executor ─────────────────────────────────────────────────────

async function executeTool(toolName, toolInput, apiHelpers, merchantId) {
  const {
    getMerchantBalance,
    createOrder,
    getOrders,
    getAvailableOrders,
    getOrderDetails,
    acceptOrder,
    lockEscrow,
    updateOrderStatus,
    releaseEscrow,
    cancelOrder,
    getTransactionHistory,
  } = apiHelpers;

  try {
    switch (toolName) {
      case 'check_balance': {
        const bal = await getMerchantBalance(merchantId);
        return {
          current_balance: bal.current_balance,
          total_in: bal.total_credits,
          total_out: bal.total_debits,
          transactions: bal.total_transactions,
          source: bal.source || 'ledger',
        };
      }

      case 'create_order': {
        const order = await createOrder(
          merchantId,
          toolInput.type,
          toolInput.amount,
          toolInput.payment_method || 'bank',
        );
        return {
          success: true,
          order_id: order.id,
          order_number: order.order_number,
          type: order.type,
          crypto_amount: order.crypto_amount,
          fiat_amount: order.fiat_amount,
          rate: order.rate,
          status: order.status,
        };
      }

      case 'get_my_orders': {
        const orders = await getOrders(merchantId);
        const filter = toolInput.filter || 'all';
        const filtered = orders.filter(o => {
          if (filter === 'active') return !['completed', 'cancelled', 'expired'].includes(o.status);
          if (filter === 'completed') return o.status === 'completed';
          if (filter === 'cancelled') return ['cancelled', 'expired'].includes(o.status);
          return true;
        });
        return filtered.slice(0, 8).map(o => ({
          order_id: o.id,
          order_number: o.order_number,
          type: o.type,
          crypto_amount: o.crypto_amount,
          fiat_amount: o.fiat_amount,
          rate: o.rate,
          status: o.status,
          created_at: o.created_at,
        }));
      }

      case 'get_available_orders': {
        const orders = await getAvailableOrders(merchantId);
        const oneDayAgo = Date.now() - 86400000;
        const available = orders.filter(o =>
          !o.is_my_order
          && (o.status === 'pending' || (o.status === 'escrowed' && !o.buyer_merchant_id))
          && new Date(o.created_at).getTime() > oneDayAgo,
        );
        return available.slice(0, 8).map(o => ({
          order_id: o.id,
          order_number: o.order_number,
          type: o.type,
          crypto_amount: o.crypto_amount,
          fiat_amount: o.fiat_amount,
          rate: o.rate,
          status: o.status,
        }));
      }

      case 'get_order_details': {
        const order = await getOrderDetails(toolInput.order_id);
        return {
          order_id: order.id,
          order_number: order.order_number,
          type: order.type,
          crypto_amount: order.crypto_amount,
          fiat_amount: order.fiat_amount,
          rate: order.rate,
          status: order.status,
          escrow_locked: !!order.escrow_tx_hash,
          created_at: order.created_at,
          merchant: order.merchant ? { name: order.merchant.business_name || order.merchant.username } : null,
          buyer_merchant: order.buyer_merchant ? { name: order.buyer_merchant.business_name || order.buyer_merchant.username } : null,
        };
      }

      case 'accept_order': {
        const order = await acceptOrder(toolInput.order_id, merchantId);
        return {
          success: true,
          order_id: order.id,
          order_number: order.order_number,
          status: order.status,
          crypto_amount: order.crypto_amount,
          fiat_amount: order.fiat_amount,
          rate: order.rate,
        };
      }

      case 'lock_escrow': {
        const order = await lockEscrow(toolInput.order_id, merchantId);
        return { success: true, order_id: toolInput.order_id, status: order.status || 'escrowed' };
      }

      case 'mark_payment_sent': {
        await updateOrderStatus(toolInput.order_id, 'payment_sent', merchantId);
        return { success: true, order_id: toolInput.order_id, status: 'payment_sent' };
      }

      case 'confirm_payment': {
        await releaseEscrow(toolInput.order_id, merchantId);
        return { success: true, order_id: toolInput.order_id, status: 'completed' };
      }

      case 'cancel_order': {
        await cancelOrder(toolInput.order_id, merchantId);
        return { success: true, order_id: toolInput.order_id, status: 'cancelled' };
      }

      case 'get_transaction_history': {
        const txs = await getTransactionHistory(merchantId, toolInput.limit || 10);
        return txs.slice(0, 10).map(t => ({
          type: t.type,
          amount: t.amount,
          status: t.status,
          description: t.description,
          created_at: t.created_at,
        }));
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    const msg = err.response?.data?.error || err.message || 'Unknown error';
    return { error: msg };
  }
}

// ── Main AI handler ───────────────────────────────────────────────────

/**
 * Handle a free-text message from a Telegram user.
 * Returns the assistant's reply text.
 *
 * @param {number} telegramId  - Telegram user ID (for conversation history)
 * @param {string} merchantId  - Authenticated merchant ID
 * @param {string} userMessage - The user's text message
 * @param {object} apiHelpers  - Object containing all API helper functions from bot.js
 * @returns {Promise<string>}  - Reply text to send back
 */
async function handleAiMessage(telegramId, merchantId, userMessage, apiHelpers) {
  addToHistory(telegramId, 'user', userMessage);

  const messages = getHistory(telegramId);

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });
  } catch (err) {
    console.error('[AI] Claude API error:', err.message);
    return 'Sorry, the AI is temporarily unavailable. Use /menu for manual controls.';
  }

  // Agentic tool-use loop — Claude may call multiple tools before replying
  let currentResponse = response;
  const assistantContent = [];

  while (currentResponse.stop_reason === 'tool_use') {
    const toolUseBlocks = currentResponse.content.filter(b => b.type === 'tool_use');

    // Collect the full assistant turn (text + tool_use blocks)
    for (const block of currentResponse.content) {
      assistantContent.push(block);
    }

    // Execute all tool calls in this turn
    const toolResults = [];
    for (const toolUse of toolUseBlocks) {
      console.log(`[AI] Tool call: ${toolUse.name}`, JSON.stringify(toolUse.input));
      const result = await executeTool(toolUse.name, toolUse.input, apiHelpers, merchantId);
      console.log(`[AI] Tool result: ${toolUse.name}`, JSON.stringify(result));
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    // Add assistant turn + tool results to history for this loop iteration
    const loopMessages = [
      ...messages.slice(0, -1), // everything before the last user message
      messages[messages.length - 1], // the user message
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: toolResults },
    ];

    try {
      currentResponse = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: loopMessages,
      });
    } catch (err) {
      console.error('[AI] Claude API error in tool loop:', err.message);
      return 'There was an error processing your request. Please try again.';
    }
  }

  // Extract final text reply
  const replyText = currentResponse.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  if (replyText) {
    addToHistory(telegramId, 'assistant', replyText);
  }

  return replyText || 'Done.';
}

module.exports = { handleAiMessage, clearHistory };
