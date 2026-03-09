/**
 * API client: all backend HTTP calls + session management
 */
const axios = require('axios');
const solanaWallet = require('./solana-wallet');
const state = require('./state');

const { API_BASE, MOCK_MODE, sessions, merchantToTelegram, saveSessions } = state;

// ─── Auth ────────────────────────────────────────────────────────────────────

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

// ─── Balance & Transactions ──────────────────────────────────────────────────

async function getMerchantBalance(merchantId) {
  let onChainBalance = null;

  if (!MOCK_MODE) {
    const pubkey = solanaWallet.getPublicKey(merchantId);
    if (pubkey) {
      try {
        onChainBalance = await solanaWallet.getUsdtBalance(pubkey);
      } catch (e) {
        console.error(`[Balance] On-chain balance failed for ${merchantId}:`, e.message);
      }
    }
  }

  try {
    const res = await axios.get(`${API_BASE}/merchant/transactions`, {
      params: { merchant_id: merchantId, summary: true }
    });
    const dbBalance = res.data.data;
    return {
      current_balance: onChainBalance != null ? onChainBalance : dbBalance.current_balance,
      db_balance: dbBalance.current_balance,
      on_chain_balance: onChainBalance,
      total_credits: dbBalance.total_credits,
      total_debits: dbBalance.total_debits,
      total_transactions: dbBalance.total_transactions,
      source: onChainBalance != null ? 'on-chain' : 'db',
    };
  } catch (err) {
    try {
      const res = await axios.get(`${API_BASE}/mock/balance`, {
        params: { userId: merchantId, type: 'merchant' }
      });
      return {
        current_balance: onChainBalance != null ? onChainBalance : (res.data.balance || 0),
        total_credits: 0,
        total_debits: 0,
        total_transactions: 0,
      };
    } catch {
      return {
        current_balance: onChainBalance || 0,
        total_credits: 0,
        total_debits: 0,
        total_transactions: 0,
      };
    }
  }
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

// ─── Orders ──────────────────────────────────────────────────────────────────

async function createOrder(merchantId, type, amount, paymentMethod = 'bank', escrowFields = {}) {
  const res = await axios.post(`${API_BASE}/merchant/orders`, {
    merchant_id: merchantId,
    type,
    crypto_amount: amount,
    payment_method: paymentMethod,
    spread_preference: 'fastest',
    ...escrowFields,
  });

  const order = res.data.data;

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
  if (!MOCK_MODE && solanaWallet.getKeypair(merchantId)) {
    try {
      const order = await getOrderDetails(orderId);
      if (order.escrow_tx_hash && order.escrow_creator_wallet && order.escrow_trade_id) {
        console.log(`[Accept] Order ${orderId} has escrow — calling acceptTrade on-chain`);
        const result = await solanaWallet.acceptTradeOnChain(
          merchantId,
          order.escrow_creator_wallet,
          Number(order.escrow_trade_id)
        );
        console.log(`[Accept] acceptTrade tx: ${result.txHash}`);
      }
    } catch (e) {
      console.error(`[Accept] On-chain acceptTrade failed:`, e.message);
    }
  }

  const res = await axios.patch(`${API_BASE}/orders/${orderId}`, {
    status: 'accepted',
    actor_type: 'merchant',
    actor_id: merchantId,
    acceptor_wallet_address: solanaWallet.getPublicKey(merchantId) || undefined,
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

// ─── Escrow ──────────────────────────────────────────────────────────────────

async function lockEscrow(orderId, merchantId) {
  const order = await getOrderDetails(orderId);
  const amount = parseFloat(order.crypto_amount);

  if (!MOCK_MODE) {
    if (!solanaWallet.getKeypair(merchantId)) {
      throw new Error('Wallet not unlocked. Use /wallet → Unlock before locking escrow.');
    }
    const result = await solanaWallet.fundEscrow(merchantId, amount);
    const res = await axios.post(`${API_BASE}/orders/${orderId}/escrow`, {
      tx_hash: result.txHash,
      actor_type: 'merchant',
      actor_id: merchantId,
      escrow_trade_id: result.tradeId,
      escrow_trade_pda: result.tradePda,
      escrow_pda: result.escrowPda,
      escrow_creator_wallet: result.creatorWallet,
    });
    return res.data.data;
  }

  // Mock mode only
  const txHash = `demo-tg-${Date.now()}`;
  const res = await axios.post(`${API_BASE}/orders/${orderId}/escrow`, {
    tx_hash: txHash,
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  return res.data.data;
}

async function releaseEscrow(orderId, merchantId) {
  if (!MOCK_MODE) {
    if (!solanaWallet.getKeypair(merchantId)) {
      throw new Error('Wallet not unlocked. Use /wallet → Unlock before releasing escrow.');
    }
    const order = await getOrderDetails(orderId);
    if (order.escrow_trade_id && order.escrow_creator_wallet) {
      const counterparty = order.buyer_wallet_address
        || order.buyer_merchant?.wallet_address
        || order.acceptor_wallet_address
        || order.user?.wallet_address;

      if (!counterparty) throw new Error('Cannot release: buyer wallet address not found on order.');

      const result = await solanaWallet.releaseEscrowOnChain(
        merchantId,
        order.escrow_creator_wallet,
        Number(order.escrow_trade_id),
        counterparty
      );

      const res = await axios.patch(`${API_BASE}/orders/${orderId}/escrow`, {
        tx_hash: result.txHash,
        actor_type: 'merchant',
        actor_id: merchantId,
      });
      return res.data.data;
    }
    // No on-chain escrow data on this order — likely a legacy/demo order
    throw new Error('No on-chain escrow data found for this order. Cannot release.');
  }

  // Mock mode only
  const txHash = `demo-tg-release-${Date.now()}`;
  const res = await axios.patch(`${API_BASE}/orders/${orderId}/escrow`, {
    tx_hash: txHash,
    actor_type: 'merchant',
    actor_id: merchantId,
  });
  return res.data.data;
}

// ─── Chat ────────────────────────────────────────────────────────────────────

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

// ─── Session Management ──────────────────────────────────────────────────────

function getSession(telegramId) {
  return sessions.get(telegramId) || null;
}

async function setSession(telegramId, session) {
  sessions.set(telegramId, session);
  merchantToTelegram.set(session.merchantId, telegramId);
  saveSessions();

  try {
    await axios.patch(`${API_BASE}/merchant/${session.merchantId}/telegram`, {
      telegram_chat_id: String(telegramId)
    });
    console.log(`[Telegram] Updated chat_id for merchant ${session.merchantId}`);
  } catch (err) {
    console.error(`[Telegram] Failed to update chat_id:`, err.message);
  }
}

async function validateSessions() {
  const stale = [];
  for (const [telegramId, session] of sessions) {
    try {
      const res = await axios.get(`${API_BASE}/auth/merchant`, {
        params: { action: 'check_session', merchant_id: session.merchantId }
      });
      if (!res.data?.data?.valid) {
        console.log(`[Session] Stale session for telegramId=${telegramId} (merchant ${session.merchantId} not in DB)`);
        if (session.email) {
          try {
            const merchant = await loginMerchant(session.email, session.password || 'telegram_user');
            if (merchant && merchant.id) {
              console.log(`[Session] Re-login succeeded for ${session.email} -> new merchantId=${merchant.id}`);
              merchantToTelegram.delete(session.merchantId);
              session.merchantId = merchant.id;
              session.username = merchant.username || session.username;
              merchantToTelegram.set(merchant.id, telegramId);
              continue;
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

module.exports = {
  registerMerchant, loginMerchant,
  getMerchantBalance, getTransactionHistory,
  createOrder, getOrders, getAvailableOrders, getOrderDetails,
  acceptOrder, updateOrderStatus, cancelOrder,
  lockEscrow, releaseEscrow,
  sendChatMessage, getChatMessages,
  getSession, setSession, validateSessions,
};
