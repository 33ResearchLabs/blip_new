#!/usr/bin/env node
/**
 * Blip Payments MCP Server
 *
 * Exposes Blip's P2P USDC payment rails as tools any AI agent can call.
 * Auth: set BLIP_API_KEY=sk_live_* and BLIP_MERCHANT_ID in env.
 *
 * Usage (Claude Desktop):
 *   Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
 *   {
 *     "mcpServers": {
 *       "blip-payments": {
 *         "command": "node",
 *         "args": ["/path/to/blip-mcp/index.js"],
 *         "env": {
 *           "BLIP_API_KEY": "sk_live_...",
 *           "BLIP_MERCHANT_ID": "your-merchant-uuid",
 *           "BLIP_API_BASE": "https://app.blip.money/api"
 *         }
 *       }
 *     }
 *   }
 */

require('dotenv').config();

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} = require('@modelcontextprotocol/sdk/types.js');
const axios = require('axios');

// ── Config ────────────────────────────────────────────────────────────

const API_KEY      = process.env.BLIP_API_KEY;
const MERCHANT_ID  = process.env.BLIP_MERCHANT_ID;
const API_BASE     = process.env.BLIP_API_BASE || 'http://localhost:3000/api';

if (!API_KEY) {
  console.error('[Blip MCP] BLIP_API_KEY is required');
  process.exit(1);
}
if (!MERCHANT_ID) {
  console.error('[Blip MCP] BLIP_MERCHANT_ID is required');
  process.exit(1);
}

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 20000,
});

// ── Helpers ───────────────────────────────────────────────────────────

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

async function call(fn) {
  try {
    return ok(await fn());
  } catch (err) {
    const msg = err.response?.data?.error || err.response?.data?.message || err.message;
    return fail(msg);
  }
}

// ── Tool definitions ──────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'blip_get_balance',
    description: 'Get the current USDC balance and transaction summary for the authenticated merchant.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'blip_get_rate',
    description:
      'Get the current USDC exchange rate (e.g. USDT_AED, USDT_INR). ' +
      'Call this before creating an order so the user knows the rate.',
    inputSchema: {
      type: 'object',
      properties: {
        corridor: { type: 'string', description: 'e.g. USDT_AED or USDT_INR. Default: USDT_AED.' },
      },
      required: [],
    },
  },
  {
    name: 'blip_create_order',
    description:
      'Create a buy or sell USDC order on the Blip marketplace. ' +
      'BUY = pay fiat, receive USDC. SELL = send USDC, receive fiat. ' +
      'A counterparty merchant must manually accept the order.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['buy', 'sell'] },
        amount: { type: 'number', description: 'USDC amount' },
        payment_method: { type: 'string', enum: ['bank', 'upi'], description: 'Default: bank' },
      },
      required: ['type', 'amount'],
    },
  },
  {
    name: 'blip_get_order',
    description: 'Get full details and current status of a specific order.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order UUID' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'blip_list_orders',
    description: "List the merchant's own orders filtered by status.",
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['active', 'completed', 'cancelled', 'all'], description: 'Default: active' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },
  {
    name: 'blip_list_available_orders',
    description: 'List orders from other merchants available to accept from the marketplace.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'blip_accept_order',
    description: 'Accept an available order from the marketplace. You become the counterparty.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'blip_mark_payment_sent',
    description: 'Mark fiat payment as sent to the seller (buyer action, after bank transfer).',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'blip_confirm_payment',
    description: 'Confirm fiat received and release USDC escrow to complete the trade (seller action).',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'blip_cancel_order',
    description: 'Cancel a pending or accepted order (cannot cancel once escrow is locked).',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        reason: { type: 'string', description: 'Reason shown to counterparty' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'blip_send_chat_message',
    description: 'Send a message to the counterparty in the order chat.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['order_id', 'message'],
    },
  },
  {
    name: 'blip_get_chat',
    description: 'Read recent chat messages for an order.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        limit: { type: 'number', description: 'Default 10' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'blip_poll_until_status',
    description:
      'Poll an order until it reaches a target status or times out. ' +
      'Use to wait for counterparty actions (e.g. wait until accepted, until payment_sent).',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: { type: 'string' },
        target_status: {
          type: 'string',
          enum: ['accepted', 'escrowed', 'payment_sent', 'completed', 'cancelled', 'disputed'],
        },
        timeout_seconds: { type: 'number', description: 'Max wait in seconds (default 300, max 600)' },
      },
      required: ['order_id', 'target_status'],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {

    case 'blip_get_balance': return call(async () => {
      // GET /merchant/:id returns profile including balance
      const res = await api.get(`/merchant/${MERCHANT_ID}`);
      const m = res.data.data;
      return {
        merchant: m.business_name || m.display_name || m.username,
        wallet_address: m.wallet_address,
        balance_usdc: m.balance ?? 'check wallet',
        total_trades: m.total_trades,
        rating: m.rating,
      };
    });

    case 'blip_get_rate': return call(async () => {
      const corridor = args.corridor || 'USDT_AED';
      const res = await api.get('/orders/status', { params: { corridor } });
      return res.data.data || { corridor, note: 'Use blip_create_order to get a live rate on order creation' };
    });

    case 'blip_create_order': return call(async () => {
      if (!args.amount || args.amount <= 0) throw new Error('amount must be a positive number');
      const res = await api.post('/merchant/orders', {
        merchant_id: MERCHANT_ID,
        type: args.type,
        crypto_amount: args.amount,
        payment_method: args.payment_method || 'bank',
        spread_preference: 'fastest',
      });
      const o = res.data.data;
      return {
        order_id: o.id,
        order_number: o.order_number,
        type: o.type,
        crypto_amount: o.crypto_amount,
        fiat_amount: o.fiat_amount,
        rate: o.rate,
        status: o.status,
        expires_at: o.expires_at,
        note: 'Order is live on the marketplace. A merchant must manually accept it.',
      };
    });

    case 'blip_get_order': return call(async () => {
      const res = await api.get(`/orders/${args.order_id}`);
      const o = res.data.data;
      return {
        order_id: o.id,
        order_number: o.order_number,
        type: o.type,
        status: o.status,
        crypto_amount: o.crypto_amount,
        fiat_amount: o.fiat_amount,
        rate: o.rate,
        escrow_locked: !!o.escrow_tx_hash,
        created_at: o.created_at,
        accepted_at: o.accepted_at,
        completed_at: o.completed_at,
        counterparty: o.merchant?.business_name || o.buyer_merchant?.business_name || null,
        payment_details: o.payment_details || null,
      };
    });

    case 'blip_list_orders': return call(async () => {
      const res = await api.get('/merchant/orders', {
        params: { merchant_id: MERCHANT_ID },
      });
      let orders = res.data.data || [];
      const filter = args.filter || 'active';
      if (filter === 'active') orders = orders.filter(o => !['completed', 'cancelled', 'expired'].includes(o.status));
      else if (filter === 'completed') orders = orders.filter(o => o.status === 'completed');
      else if (filter === 'cancelled') orders = orders.filter(o => ['cancelled', 'expired'].includes(o.status));
      return orders.slice(0, Math.min(args.limit || 10, 50)).map(o => ({
        order_id: o.id,
        order_number: o.order_number,
        type: o.type,
        status: o.status,
        crypto_amount: o.crypto_amount,
        fiat_amount: o.fiat_amount,
        rate: o.rate,
        created_at: o.created_at,
      }));
    });

    case 'blip_list_available_orders': return call(async () => {
      const res = await api.get('/merchant/orders', {
        params: { merchant_id: MERCHANT_ID, include_all_pending: 'true' },
      });
      const oneDayAgo = Date.now() - 86400000;
      return (res.data.data || [])
        .filter(o =>
          !o.is_my_order &&
          (o.status === 'pending' || (o.status === 'escrowed' && !o.buyer_merchant_id)) &&
          new Date(o.created_at).getTime() > oneDayAgo,
        )
        .slice(0, 20)
        .map(o => ({
          order_id: o.id,
          order_number: o.order_number,
          type: o.type,
          status: o.status,
          crypto_amount: o.crypto_amount,
          fiat_amount: o.fiat_amount,
          rate: o.rate,
          payment_method: o.payment_method,
        }));
    });

    case 'blip_accept_order': return call(async () => {
      const res = await api.patch(`/orders/${args.order_id}`, {
        status: 'accepted',
        actor_type: 'merchant',
        actor_id: MERCHANT_ID,
      });
      const o = res.data.data;
      return {
        order_id: o.id,
        order_number: o.order_number,
        status: o.status,
        crypto_amount: o.crypto_amount,
        fiat_amount: o.fiat_amount,
        note: 'Order accepted. You have 120 minutes to complete this trade.',
      };
    });

    case 'blip_mark_payment_sent': return call(async () => {
      await api.patch(`/orders/${args.order_id}`, {
        status: 'payment_sent',
        actor_type: 'merchant',
        actor_id: MERCHANT_ID,
      });
      return { order_id: args.order_id, status: 'payment_sent', note: 'Waiting for seller to confirm receipt.' };
    });

    case 'blip_confirm_payment': return call(async () => {
      await api.patch(`/orders/${args.order_id}/escrow`, {
        actor_type: 'merchant',
        actor_id: MERCHANT_ID,
      });
      return { order_id: args.order_id, status: 'completed', note: 'Payment confirmed. Escrow released. Trade complete.' };
    });

    case 'blip_cancel_order': return call(async () => {
      const reason = args.reason || 'Cancelled by agent';
      await api.delete(`/orders/${args.order_id}`, {
        params: { actor_type: 'merchant', actor_id: MERCHANT_ID, reason },
      });
      return { order_id: args.order_id, status: 'cancelled' };
    });

    case 'blip_send_chat_message': return call(async () => {
      const res = await api.post(`/orders/${args.order_id}/messages`, {
        sender_type: 'merchant',
        sender_id: MERCHANT_ID,
        content: args.message,
        message_type: 'text',
      });
      return { sent: true, message_id: res.data.data?.id, content: args.message };
    });

    case 'blip_get_chat': return call(async () => {
      const res = await api.get(`/orders/${args.order_id}/messages`, {
        params: { limit: args.limit || 10 },
      });
      return (res.data.data || []).slice(-(args.limit || 10)).map(m => ({
        from: m.sender_id === MERCHANT_ID ? 'you' : m.sender_type,
        message: m.content,
        type: m.message_type,
        time: m.created_at,
      }));
    });

    case 'blip_poll_until_status': return call(async () => {
      const target = args.target_status;
      const timeoutMs = Math.min((args.timeout_seconds || 300), 600) * 1000;
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const res = await api.get(`/orders/${args.order_id}`);
        const order = res.data.data;

        if (order.status === target) {
          return {
            reached: true,
            status: order.status,
            order_id: args.order_id,
            crypto_amount: order.crypto_amount,
            fiat_amount: order.fiat_amount,
            payment_details: order.payment_details || null,
            counterparty: order.merchant?.business_name || order.buyer_merchant?.business_name || null,
          };
        }

        if (['completed', 'cancelled', 'expired', 'disputed'].includes(order.status)) {
          return { reached: false, current_status: order.status, note: `Order ended at ${order.status} before reaching ${target}` };
        }

        await new Promise(r => setTimeout(r, 5000));
      }

      return { reached: false, note: `Timed out after ${args.timeout_seconds || 300}s. Order has not yet reached ${target}.` };
    });

    default:
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
}

// ── MCP Server ────────────────────────────────────────────────────────

const server = new Server(
  { name: 'blip-payments', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => handleTool(req.params.name, req.params.arguments || {}));
server.onerror = (err) => console.error('[Blip MCP] Error:', err);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[Blip MCP] Connected — ${TOOLS.length} tools | merchant: ${MERCHANT_ID} | api: ${API_BASE}`);
}

main().catch(err => { console.error('[Blip MCP] Fatal:', err); process.exit(1); });
