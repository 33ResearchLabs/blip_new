// src/loadEnv.ts
import { config } from "dotenv";
import { existsSync } from "fs";
if (process.env.NODE_ENV !== "production") {
  const paths = ["../../settle/.env.local", "../../settle/.env"];
  for (const p of paths) {
    if (existsSync(p)) config({ path: p });
  }
}

// src/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";

// src/routes/health.ts
var healthRoutes = async (fastify2) => {
  fastify2.get("/health", async () => {
    return {
      ok: true,
      service: "core-api",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  });
};

// src/routes/orders.ts
import {
  query as dbQuery,
  queryOne,
  transaction,
  atomicCancelWithRefund,
  verifyReleaseInvariants,
  verifyRefundInvariants,
  validateTransition,
  normalizeStatus,
  isTransientStatus,
  getTransitionEventType,
  shouldRestoreLiquidity,
  logger as logger2,
  MOCK_MODE
} from "settlement-core";

// src/ws/broadcast.ts
import { WebSocketServer, WebSocket } from "ws";
import { logger } from "settlement-core";
var clients = /* @__PURE__ */ new Map();
var actorIndex = /* @__PURE__ */ new Map();
var wss = null;
var heartbeatInterval = null;
function initWebSocketServer(server) {
  wss = new WebSocketServer({ server, path: "/ws/orders" });
  wss.on("connection", (ws) => {
    logger.info("[WS] New connection");
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "subscribe" && msg.actorType && msg.actorId) {
          const meta = {
            actorType: msg.actorType,
            actorId: msg.actorId,
            alive: true
          };
          clients.set(ws, meta);
          const key = `${msg.actorType}:${msg.actorId}`;
          if (!actorIndex.has(key)) {
            actorIndex.set(key, /* @__PURE__ */ new Set());
          }
          actorIndex.get(key).add(ws);
          ws.send(JSON.stringify({ type: "subscribed", actorType: msg.actorType, actorId: msg.actorId }));
          logger.info("[WS] Client subscribed", { actorType: msg.actorType, actorId: msg.actorId });
        }
        if (msg.type === "pong") {
          const meta = clients.get(ws);
          if (meta) meta.alive = true;
        }
      } catch {
      }
    });
    ws.on("close", () => {
      const meta = clients.get(ws);
      if (meta) {
        const key = `${meta.actorType}:${meta.actorId}`;
        actorIndex.get(key)?.delete(ws);
        if (actorIndex.get(key)?.size === 0) {
          actorIndex.delete(key);
        }
      }
      clients.delete(ws);
    });
    ws.on("error", (err) => {
      logger.error("[WS] Client error", { error: err.message });
    });
  });
  heartbeatInterval = setInterval(() => {
    clients.forEach((meta, ws) => {
      if (!meta.alive) {
        ws.terminate();
        return;
      }
      meta.alive = false;
      ws.send(JSON.stringify({ type: "ping" }));
    });
  }, 3e4);
  logger.info("[WS] WebSocket server initialized on /ws/orders");
}
function broadcastOrderEvent(payload) {
  if (!wss) return;
  const message = JSON.stringify({
    type: "order_event",
    event_type: payload.event_type,
    order_id: payload.order_id,
    status: payload.status,
    minimal_status: payload.minimal_status,
    order_version: payload.order_version,
    previousStatus: payload.previousStatus
  });
  const targets = /* @__PURE__ */ new Set();
  if (payload.userId) {
    actorIndex.get(`user:${payload.userId}`)?.forEach((ws) => targets.add(ws));
  }
  if (payload.merchantId) {
    actorIndex.get(`merchant:${payload.merchantId}`)?.forEach((ws) => targets.add(ws));
  }
  if (payload.buyerMerchantId) {
    actorIndex.get(`merchant:${payload.buyerMerchantId}`)?.forEach((ws) => targets.add(ws));
  }
  const broadcastToAll = ["ORDER_CREATED", "ORDER_ACCEPTED", "ORDER_CANCELLED", "ORDER_EXPIRED"];
  if (broadcastToAll.includes(payload.event_type)) {
    for (const [key, wsSet] of actorIndex) {
      if (key.startsWith("merchant:")) {
        wsSet.forEach((ws) => targets.add(ws));
      }
    }
  }
  let sent = 0;
  targets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      sent++;
    }
  });
  if (sent > 0) {
    logger.info("[WS] Broadcast sent", {
      event: payload.event_type,
      orderId: payload.order_id,
      recipients: sent
    });
  }
}
function getWsStats() {
  const subscriptions = {};
  for (const [key, wsSet] of actorIndex) {
    subscriptions[key] = wsSet.size;
  }
  return {
    connected: clients.size,
    subscriptions,
    subscriptionCount: actorIndex.size
  };
}
function closeWebSocketServer() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (wss) {
    wss.close();
    wss = null;
  }
  clients.clear();
  actorIndex.clear();
}

// src/batchWriter.ts
import { query } from "settlement-core";
var eventBuf = [];
var notifBuf = [];
var repBuf = [];
var FLUSH_MS = 50;
var MAX_BUF = 500;
var timer = null;
function schedule() {
  if (!timer) {
    timer = setTimeout(flush, FLUSH_MS);
  }
}
async function flush() {
  timer = null;
  const events = eventBuf.splice(0);
  const notifs = notifBuf.splice(0);
  const reps = repBuf.splice(0);
  if (events.length > 0) {
    const vals = [];
    const phs = [];
    for (let i = 0; i < events.length; i++) {
      const o = i * 7;
      phs.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7})`);
      const e = events[i];
      vals.push(e.order_id, e.event_type, e.actor_type, e.actor_id, e.old_status, e.new_status, e.metadata);
    }
    query(
      `INSERT INTO order_events (order_id,event_type,actor_type,actor_id,old_status,new_status,metadata) VALUES ${phs.join(",")}`,
      vals
    ).catch(() => {
    });
  }
  if (notifs.length > 0) {
    const vals = [];
    const phs = [];
    for (let i = 0; i < notifs.length; i++) {
      const o = i * 3;
      phs.push(`($${o + 1},$${o + 2},$${o + 3},'pending')`);
      const n = notifs[i];
      vals.push(n.order_id, n.event_type, n.payload);
    }
    query(
      `INSERT INTO notification_outbox (order_id,event_type,payload,status) VALUES ${phs.join(",")}`,
      vals
    ).catch(() => {
    });
  }
  if (reps.length > 0) {
    const vals = [];
    const phs = [];
    for (let i = 0; i < reps.length; i++) {
      const o = i * 6;
      phs.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6})`);
      const r = reps[i];
      vals.push(r.entity_id, r.entity_type, r.event_type, r.score_change, r.reason, r.metadata);
    }
    query(
      `INSERT INTO reputation_events (entity_id,entity_type,event_type,score_change,reason,metadata) VALUES ${phs.join(",")} ON CONFLICT DO NOTHING`,
      vals
    ).catch(() => {
    });
  }
}
function bufferEvent(row) {
  eventBuf.push(row);
  if (eventBuf.length >= MAX_BUF) flush();
  else schedule();
}
function bufferNotification(row) {
  notifBuf.push(row);
  if (notifBuf.length >= MAX_BUF) flush();
  else schedule();
}
function bufferReputation(row) {
  repBuf.push(row);
  if (repBuf.length >= MAX_BUF) flush();
  else schedule();
}
process.on("beforeExit", flush);

// src/routes/orders.ts
var bgQuery = (sql, params) => dbQuery(sql, params).catch(() => {
});
var orderRoutes = async (fastify2) => {
  fastify2.get(
    "/orders/:id",
    async (request, reply) => {
      const { id } = request.params;
      try {
        const order = await queryOne(
          "SELECT * FROM orders WHERE id = $1",
          [id]
        );
        if (!order) {
          return reply.status(404).send({
            success: false,
            error: "Order not found"
          });
        }
        const orderWithMinimalStatus = {
          ...order,
          minimal_status: normalizeStatus(order.status)
        };
        return reply.send({
          success: true,
          data: orderWithMinimalStatus
        });
      } catch (error) {
        fastify2.log.error({ error, id }, "Error fetching order");
        return reply.status(500).send({
          success: false,
          error: "Internal server error"
        });
      }
    }
  );
  fastify2.patch("/orders/:id", async (request, reply) => {
    const { id } = request.params;
    const { status: newStatus, actor_type, actor_id, reason, acceptor_wallet_address } = request.body;
    if (!newStatus || !actor_type || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: "status, actor_type, and actor_id are required"
      });
    }
    try {
      if (isTransientStatus(newStatus)) {
        return reply.status(400).send({
          success: false,
          error: `Status '${newStatus}' is transient. Use '${normalizeStatus(newStatus)}' instead.`
        });
      }
      if (newStatus !== "cancelled") {
        const selfRefCheck = await queryOne(
          `SELECT id FROM orders WHERE id = $1 AND merchant_id = buyer_merchant_id`,
          [id]
        );
        if (selfRefCheck) {
          logger2.error("[GUARD] Blocked transition on self-referencing order", { orderId: id, newStatus, actor_id });
          return reply.status(400).send({
            success: false,
            error: "Order is in an invalid state (self-referencing). Please cancel and recreate."
          });
        }
      }
      if (newStatus === "cancelled") {
        const order = await queryOne("SELECT * FROM orders WHERE id = $1", [id]);
        if (!order) {
          return reply.status(404).send({ success: false, error: "Order not found" });
        }
        if (order.escrow_tx_hash) {
          const cancelResult = await atomicCancelWithRefund(
            id,
            order.status,
            actor_type,
            actor_id,
            reason,
            {
              type: order.type,
              crypto_amount: parseFloat(String(order.crypto_amount)),
              merchant_id: order.merchant_id,
              user_id: order.user_id,
              buyer_merchant_id: order.buyer_merchant_id,
              order_number: parseInt(order.order_number, 10),
              crypto_currency: order.crypto_currency,
              fiat_amount: parseFloat(String(order.fiat_amount)),
              fiat_currency: order.fiat_currency
            }
          );
          if (!cancelResult.success) {
            return reply.status(400).send({ success: false, error: cancelResult.error });
          }
          try {
            await verifyRefundInvariants({ orderId: id, expectedStatus: "cancelled", expectedMinOrderVersion: order.order_version + 1 });
          } catch (invariantError) {
            logger2.error("[CRITICAL] Refund invariant FAILED (PATCH cancel)", { orderId: id, error: invariantError });
            return reply.status(500).send({ success: false, error: "ORDER_REFUND_INVARIANT_FAILED" });
          }
          broadcastOrderEvent({
            event_type: "ORDER_CANCELLED",
            order_id: id,
            status: "cancelled",
            minimal_status: "cancelled",
            order_version: cancelResult.order.order_version,
            userId: order.user_id,
            merchantId: order.merchant_id,
            buyerMerchantId: order.buyer_merchant_id ?? void 0,
            previousStatus: order.status
          });
          return reply.send({ success: true, data: { ...cancelResult.order, minimal_status: normalizeStatus(cancelResult.order.status) } });
        }
      }
      if (newStatus === "accepted" || newStatus === "payment_pending" && request.body.metadata?.is_m2m) {
        if (actor_type === "merchant") {
          const preCheck = await queryOne(
            "SELECT o.merchant_id, u.username FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = $1",
            [id]
          );
          if (preCheck && preCheck.merchant_id === actor_id) {
            const username = preCheck.username || "";
            if (username.startsWith("open_order_") || username.startsWith("m2m_")) {
              logger2.warn("[GUARD] Blocked self-acceptance", { orderId: id, actor_id });
              return reply.status(400).send({ success: false, error: "Cannot accept your own order" });
            }
          }
        }
        const procResult = await queryOne(
          "SELECT accept_order_v1($1,$2,$3,$4)",
          [id, actor_type, actor_id, request.body.acceptor_wallet_address || null]
        );
        const data = procResult.accept_order_v1;
        if (!data.success) {
          return reply.status(400).send({ success: false, error: data.error });
        }
        const order = data.order;
        const oldStatus = data.old_status;
        bufferEvent({ order_id: id, event_type: getTransitionEventType(oldStatus, newStatus), actor_type, actor_id, old_status: oldStatus, new_status: newStatus, metadata: JSON.stringify(request.body.metadata || {}) });
        bufferNotification({ order_id: id, event_type: `ORDER_${newStatus.toUpperCase()}`, payload: JSON.stringify({
          orderId: id,
          userId: order.user_id,
          merchantId: order.merchant_id,
          status: order.status,
          minimal_status: normalizeStatus(order.status),
          order_version: order.order_version,
          previousStatus: oldStatus,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }) });
        broadcastOrderEvent({
          event_type: `ORDER_${newStatus.toUpperCase()}`,
          order_id: id,
          status: order.status,
          minimal_status: normalizeStatus(order.status),
          order_version: order.order_version,
          userId: order.user_id,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id ?? void 0,
          previousStatus: oldStatus
        });
        return reply.send({ success: true, data: { ...order, minimal_status: normalizeStatus(order.status) } });
      }
      if (newStatus === "payment_sent") {
        const updated = await queryOne(
          `UPDATE orders SET status = 'payment_sent', payment_sent_at = NOW(), order_version = order_version + 1
           WHERE id = $1 AND status = 'escrowed'
           RETURNING *`,
          [id]
        );
        if (!updated) {
          return reply.status(400).send({ success: false, error: "Order not found or cannot transition to payment_sent" });
        }
        bufferEvent({ order_id: id, event_type: "status_changed_to_payment_sent", actor_type, actor_id, old_status: "escrowed", new_status: "payment_sent", metadata: "{}" });
        bufferNotification({ order_id: id, event_type: "ORDER_PAYMENT_SENT", payload: JSON.stringify({
          orderId: id,
          userId: updated.user_id,
          merchantId: updated.merchant_id,
          status: "payment_sent",
          minimal_status: "payment_sent",
          order_version: updated.order_version,
          previousStatus: "escrowed",
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }) });
        broadcastOrderEvent({
          event_type: "ORDER_PAYMENT_SENT",
          order_id: id,
          status: "payment_sent",
          minimal_status: "payment_sent",
          order_version: updated.order_version,
          userId: updated.user_id,
          merchantId: updated.merchant_id,
          buyerMerchantId: updated.buyer_merchant_id ?? void 0,
          previousStatus: "escrowed"
        });
        return reply.send({ success: true, data: { ...updated, minimal_status: normalizeStatus(updated.status) } });
      }
      const result = await transaction(async (client) => {
        const currentResult = await client.query(
          "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (currentResult.rows.length === 0) {
          return { success: false, error: "Order not found" };
        }
        const currentOrder = currentResult.rows[0];
        const oldStatus = currentOrder.status;
        const validation = validateTransition(oldStatus, newStatus, actor_type);
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }
        if (oldStatus === newStatus) {
          return { success: true, order: currentOrder };
        }
        if (newStatus === "completed" && currentOrder.escrow_tx_hash && !currentOrder.release_tx_hash) {
          return { success: false, error: "Cannot complete: escrow not released" };
        }
        if (actor_type === "merchant" && (newStatus === "accepted" || newStatus === "payment_pending") && currentOrder.merchant_id === actor_id) {
          const userResult = await client.query(
            "SELECT username FROM users WHERE id = $1",
            [currentOrder.user_id]
          );
          const username = userResult.rows[0]?.username || "";
          if (username.startsWith("open_order_") || username.startsWith("m2m_")) {
            return { success: false, error: "Cannot accept your own order" };
          }
        }
        const isMerchantClaiming = actor_type === "merchant" && (oldStatus === "pending" || oldStatus === "escrowed") && newStatus === "accepted" && currentOrder.merchant_id !== actor_id;
        const isM2MAcceptance = actor_type === "merchant" && (oldStatus === "escrowed" || oldStatus === "pending") && (newStatus === "accepted" || newStatus === "payment_pending") && currentOrder.merchant_id !== actor_id;
        let timestampField = "";
        const extraSetClauses = [];
        const updateParams = [];
        let paramIdx = 2;
        const addParam = (value) => {
          paramIdx++;
          updateParams.push(value);
          return `$${paramIdx}`;
        };
        switch (newStatus) {
          case "accepted":
            timestampField = ", accepted_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
            if ((isMerchantClaiming || isM2MAcceptance) && currentOrder.escrow_tx_hash && !currentOrder.buyer_merchant_id) {
              extraSetClauses.push(`buyer_merchant_id = ${addParam(actor_id)}`);
            } else if (isMerchantClaiming || isM2MAcceptance && currentOrder.buyer_merchant_id) {
              extraSetClauses.push(`merchant_id = ${addParam(actor_id)}`);
            } else if (isM2MAcceptance && !currentOrder.buyer_merchant_id) {
              extraSetClauses.push(`buyer_merchant_id = ${addParam(actor_id)}`);
            }
            if (acceptor_wallet_address) {
              extraSetClauses.push(`acceptor_wallet_address = ${addParam(acceptor_wallet_address)}`);
            }
            break;
          case "escrowed":
            timestampField = ", escrowed_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
            break;
          case "payment_pending":
            if (isM2MAcceptance) {
              timestampField = ", accepted_at = NOW(), expires_at = NOW() + INTERVAL '120 minutes'";
              if (currentOrder.buyer_merchant_id) {
                extraSetClauses.push(`merchant_id = ${addParam(actor_id)}`);
              } else {
                extraSetClauses.push(`buyer_merchant_id = ${addParam(actor_id)}`);
              }
              if (acceptor_wallet_address) {
                extraSetClauses.push(`acceptor_wallet_address = ${addParam(acceptor_wallet_address)}`);
              }
            }
            break;
          case "payment_sent":
            timestampField = ", payment_sent_at = NOW()";
            break;
          case "payment_confirmed":
            timestampField = ", payment_confirmed_at = NOW()";
            break;
          case "completed":
            timestampField = ", completed_at = NOW()";
            break;
          case "cancelled":
            timestampField = `, cancelled_at = NOW(), cancelled_by = ${addParam(actor_type)}::actor_type, cancellation_reason = ${addParam(reason || null)}::TEXT`;
            break;
          case "expired":
            timestampField = ", cancelled_at = NOW(), cancelled_by = 'system', cancellation_reason = 'Timed out'";
            break;
        }
        let effectiveStatus = newStatus;
        if (newStatus === "accepted" && oldStatus === "escrowed" && currentOrder.escrow_tx_hash) {
          effectiveStatus = "escrowed";
        }
        const extraSetStr = extraSetClauses.length > 0 ? ", " + extraSetClauses.join(", ") : "";
        const allParams = [effectiveStatus, id, ...updateParams];
        const sql = `UPDATE orders SET status = $1${timestampField}${extraSetStr}, order_version = order_version + 1 WHERE id = $2 RETURNING *`;
        const updateResult = await client.query(sql, allParams);
        const updatedOrder = updateResult.rows[0];
        if (shouldRestoreLiquidity(oldStatus, newStatus)) {
          await client.query(
            "UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2",
            [currentOrder.crypto_amount, currentOrder.offer_id]
          );
        }
        if (MOCK_MODE && newStatus === "completed" && currentOrder.escrow_tx_hash && !currentOrder.release_tx_hash) {
          const amount = parseFloat(String(currentOrder.crypto_amount));
          const isBuyOrder = currentOrder.type === "buy";
          const recipientId = isBuyOrder ? currentOrder.buyer_merchant_id || currentOrder.user_id : currentOrder.buyer_merchant_id || currentOrder.merchant_id;
          const recipientTable = isBuyOrder ? currentOrder.buyer_merchant_id ? "merchants" : "users" : "merchants";
          await client.query(
            `UPDATE ${recipientTable} SET balance = balance + $1 WHERE id = $2`,
            [amount, recipientId]
          );
        }
        if (newStatus === "completed" && currentOrder.payment_via === "saed_corridor" && currentOrder.corridor_fulfillment_id) {
          try {
            const ffResult = await client.query(
              "SELECT * FROM corridor_fulfillments WHERE id = $1 FOR UPDATE",
              [currentOrder.corridor_fulfillment_id]
            );
            if (ffResult.rows.length > 0 && ffResult.rows[0].provider_status !== "completed") {
              const ff = ffResult.rows[0];
              const saedAmount = parseInt(String(ff.saed_amount_locked));
              const providerMerchantId = ff.provider_merchant_id;
              await client.query(
                "UPDATE merchants SET sinr_balance = sinr_balance + $1 WHERE id = $2",
                [saedAmount, providerMerchantId]
              );
              await client.query(
                `UPDATE corridor_fulfillments SET provider_status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
                [currentOrder.corridor_fulfillment_id]
              );
            }
          } catch (corridorErr) {
            logger2.error("[Corridor] Settlement failed on completion", { orderId: id, error: corridorErr });
          }
        }
        return { success: true, order: updatedOrder, oldStatus, currentOrder };
      });
      if (!result.success) {
        return reply.status(400).send({ success: false, error: result.error });
      }
      const txOldStatus = result.oldStatus;
      const txOrder = result.currentOrder;
      bufferEvent({ order_id: id, event_type: getTransitionEventType(txOldStatus, newStatus), actor_type, actor_id, old_status: txOldStatus, new_status: newStatus, metadata: JSON.stringify(request.body.metadata || {}) });
      bufferNotification({ order_id: id, event_type: `ORDER_${newStatus.toUpperCase()}`, payload: JSON.stringify({
        orderId: id,
        userId: result.order.user_id,
        merchantId: result.order.merchant_id,
        status: result.order.status,
        minimal_status: normalizeStatus(result.order.status),
        order_version: result.order.order_version,
        previousStatus: txOldStatus,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }) });
      if (newStatus === "completed") {
        bgQuery(
          `WITH u AS (UPDATE users SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $2 RETURNING 1)
           UPDATE merchants SET total_trades = total_trades + 1, total_volume = total_volume + $1 WHERE id = $3`,
          [txOrder.fiat_amount, txOrder.user_id, txOrder.merchant_id]
        );
      }
      if (["completed", "cancelled", "disputed", "expired"].includes(newStatus)) {
        const repType = newStatus === "completed" ? "order_completed" : newStatus === "disputed" ? "order_disputed" : newStatus === "expired" ? "order_timeout" : "order_cancelled";
        const repScore = newStatus === "completed" ? 5 : newStatus === "disputed" ? -5 : newStatus === "expired" ? -5 : -2;
        const repReason = `Order ${txOrder.order_number} ${newStatus}`;
        const repMeta = JSON.stringify({ order_id: id });
        bufferReputation({ entity_id: txOrder.merchant_id, entity_type: "merchant", event_type: repType, score_change: repScore, reason: repReason, metadata: repMeta });
        bufferReputation({ entity_id: txOrder.user_id, entity_type: "user", event_type: repType, score_change: repScore, reason: repReason, metadata: repMeta });
        const settleUrl = process.env.SETTLE_URL || "http://localhost:3000";
        Promise.allSettled([
          fetch(`${settleUrl}/api/reputation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: result.order.merchant_id, entityType: "merchant" }) }),
          fetch(`${settleUrl}/api/reputation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: result.order.user_id, entityType: "user" }) })
        ]).catch(() => {
        });
      }
      broadcastOrderEvent({
        event_type: `ORDER_${newStatus.toUpperCase()}`,
        order_id: id,
        status: result.order.status,
        minimal_status: normalizeStatus(result.order.status),
        order_version: result.order.order_version,
        userId: result.order.user_id,
        merchantId: result.order.merchant_id,
        buyerMerchantId: result.order.buyer_merchant_id ?? void 0,
        previousStatus: txOldStatus
      });
      return reply.send({
        success: true,
        data: { ...result.order, minimal_status: normalizeStatus(result.order.status) }
      });
    } catch (error) {
      fastify2.log.error({ error, id }, "Error updating order status");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.delete("/orders/:id", async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, reason } = request.query;
    if (!actor_type || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: "actor_type and actor_id query params required"
      });
    }
    try {
      const order = await queryOne(
        "SELECT * FROM orders WHERE id = $1",
        [id]
      );
      if (!order) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }
      if (order.escrow_tx_hash) {
        const result = await atomicCancelWithRefund(
          id,
          order.status,
          actor_type,
          actor_id,
          reason || void 0,
          {
            type: order.type,
            crypto_amount: parseFloat(String(order.crypto_amount)),
            merchant_id: order.merchant_id,
            user_id: order.user_id,
            buyer_merchant_id: order.buyer_merchant_id,
            order_number: parseInt(order.order_number, 10),
            crypto_currency: order.crypto_currency,
            fiat_amount: parseFloat(String(order.fiat_amount)),
            fiat_currency: order.fiat_currency
          }
        );
        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }
        try {
          await verifyRefundInvariants({
            orderId: id,
            expectedStatus: "cancelled",
            expectedMinOrderVersion: order.order_version + 1
          });
        } catch (invariantError) {
          logger2.error("[CRITICAL] Refund invariant FAILED (DELETE)", { orderId: id, error: invariantError });
          return reply.status(500).send({ success: false, error: "ORDER_REFUND_INVARIANT_FAILED" });
        }
        broadcastOrderEvent({
          event_type: "ORDER_CANCELLED",
          order_id: id,
          status: "cancelled",
          minimal_status: "cancelled",
          order_version: result.order.order_version,
          userId: order.user_id,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id ?? void 0,
          previousStatus: order.status
        });
        return reply.send({
          success: true,
          data: { ...result.order, minimal_status: normalizeStatus(result.order.status) }
        });
      } else {
        const result = await transaction(async (client) => {
          const current = await client.query(
            "SELECT * FROM orders WHERE id = $1 FOR UPDATE",
            [id]
          );
          if (current.rows.length === 0) {
            return { success: false, error: "Order not found" };
          }
          const currentOrder = current.rows[0];
          const validation = validateTransition(currentOrder.status, "cancelled", actor_type);
          if (!validation.valid) {
            return { success: false, error: validation.error };
          }
          const updateResult = await client.query(
            `UPDATE orders
             SET status = 'cancelled',
                 cancelled_at = NOW(),
                 cancelled_by = $2::actor_type,
                 cancellation_reason = $3,
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id, actor_type, reason || null]
          );
          const updatedOrder = updateResult.rows[0];
          await client.query(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_cancelled', $2, $3, $4, 'cancelled', $5)`,
            [id, actor_type, actor_id, currentOrder.status, JSON.stringify({ reason })]
          );
          await client.query(
            `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_CANCELLED', $2, 'pending')`,
            [
              id,
              JSON.stringify({
                orderId: id,
                userId: updatedOrder.user_id,
                merchantId: updatedOrder.merchant_id,
                status: "cancelled",
                order_version: updatedOrder.order_version,
                previousStatus: currentOrder.status,
                updatedAt: (/* @__PURE__ */ new Date()).toISOString()
              })
            ]
          );
          if (shouldRestoreLiquidity(currentOrder.status, "cancelled")) {
            await client.query(
              "UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2",
              [currentOrder.crypto_amount, currentOrder.offer_id]
            );
          }
          return { success: true, order: updatedOrder };
        });
        if (!result.success) {
          return reply.status(400).send({ success: false, error: result.error });
        }
        broadcastOrderEvent({
          event_type: "ORDER_CANCELLED",
          order_id: id,
          status: "cancelled",
          minimal_status: "cancelled",
          order_version: result.order.order_version,
          userId: result.order.user_id,
          merchantId: result.order.merchant_id,
          buyerMerchantId: result.order.buyer_merchant_id ?? void 0,
          previousStatus: order.status
        });
        return reply.send({
          success: true,
          data: { ...result.order, minimal_status: normalizeStatus(result.order.status) }
        });
      }
    } catch (error) {
      fastify2.log.error({ error, id }, "Error cancelling order");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.post("/orders/:id/events", async (request, reply) => {
    const { id } = request.params;
    const { event_type, tx_hash, reason } = request.body;
    const actorType = request.headers["x-actor-type"];
    const actorId = request.headers["x-actor-id"];
    if (!actorType || !actorId) {
      return reply.status(401).send({ success: false, error: "Actor headers required" });
    }
    try {
      if (event_type === "release") {
        if (!tx_hash) {
          return reply.status(400).send({ success: false, error: "tx_hash required for release" });
        }
        const procResult = await queryOne(
          "SELECT release_order_v1($1,$2,$3)",
          [id, tx_hash, MOCK_MODE]
        );
        const releaseData = procResult.release_order_v1;
        if (!releaseData.success) {
          if (releaseData.error === "NOT_FOUND") {
            return reply.status(404).send({ success: false, error: "Order not found" });
          }
          return reply.status(400).send({ success: false, error: releaseData.error });
        }
        const result = { updated: releaseData.order, oldOrder: { ...releaseData.order, status: releaseData.old_status } };
        bufferEvent({ order_id: id, event_type: "status_changed_to_completed", actor_type: actorType, actor_id: actorId, old_status: result.oldOrder.status, new_status: "completed", metadata: JSON.stringify({ tx_hash }) });
        bufferNotification({ order_id: id, event_type: "ORDER_COMPLETED", payload: JSON.stringify({
          orderId: id,
          userId: result.oldOrder.user_id,
          merchantId: result.oldOrder.merchant_id,
          status: "completed",
          minimal_status: normalizeStatus("completed"),
          order_version: result.updated.order_version,
          previousStatus: result.oldOrder.status,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }) });
        verifyReleaseInvariants({
          orderId: id,
          expectedStatus: "completed",
          expectedTxHash: tx_hash,
          expectedMinOrderVersion: result.updated.order_version
        }).catch((invariantError) => {
          logger2.error("[CRITICAL] Release invariant FAILED", { orderId: id, error: invariantError });
        });
        broadcastOrderEvent({
          event_type: "ORDER_COMPLETED",
          order_id: id,
          status: "completed",
          minimal_status: "completed",
          order_version: result.updated.order_version,
          userId: result.oldOrder.user_id,
          merchantId: result.oldOrder.merchant_id,
          buyerMerchantId: result.oldOrder.buyer_merchant_id ?? void 0,
          previousStatus: result.oldOrder.status
        });
        return reply.send({
          success: true,
          data: { ...result.updated, minimal_status: normalizeStatus(result.updated.status) }
        });
      } else if (event_type === "refund") {
        const order = await queryOne("SELECT * FROM orders WHERE id = $1", [id]);
        if (!order) {
          return reply.status(404).send({ success: false, error: "Order not found" });
        }
        const refundResult = await atomicCancelWithRefund(
          id,
          order.status,
          actorType,
          actorId,
          reason,
          {
            type: order.type,
            crypto_amount: parseFloat(String(order.crypto_amount)),
            merchant_id: order.merchant_id,
            user_id: order.user_id,
            buyer_merchant_id: order.buyer_merchant_id,
            order_number: parseInt(order.order_number, 10),
            crypto_currency: order.crypto_currency,
            fiat_amount: parseFloat(String(order.fiat_amount)),
            fiat_currency: order.fiat_currency
          }
        );
        if (!refundResult.success) {
          return reply.status(400).send({ success: false, error: refundResult.error });
        }
        try {
          await verifyRefundInvariants({
            orderId: id,
            expectedStatus: "cancelled",
            expectedMinOrderVersion: order.order_version + 1
          });
        } catch (invariantError) {
          logger2.error("[CRITICAL] Refund invariant FAILED", { orderId: id, error: invariantError });
          return reply.status(500).send({ success: false, error: "ORDER_REFUND_INVARIANT_FAILED" });
        }
        broadcastOrderEvent({
          event_type: "ORDER_CANCELLED",
          order_id: id,
          status: "cancelled",
          minimal_status: "cancelled",
          order_version: refundResult.order.order_version,
          userId: order.user_id,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id ?? void 0,
          previousStatus: order.status
        });
        return reply.send({
          success: true,
          data: { ...refundResult.order, minimal_status: normalizeStatus(refundResult.order.status) }
        });
      } else {
        return reply.status(400).send({ success: false, error: "Invalid event_type" });
      }
    } catch (error) {
      const errMsg = error.message;
      if (errMsg === "NOT_FOUND") {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }
      fastify2.log.error({ error, id, event_type }, "Error processing order event");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
};

// src/routes/orderCreate.ts
import {
  query as dbQuery2,
  normalizeStatus as normalizeStatus2,
  logger as logger3
} from "settlement-core";
var orderCreateRoutes = async (fastify2) => {
  fastify2.post("/orders", async (request, reply) => {
    const data = request.body;
    if (!data.user_id || !data.merchant_id || !data.offer_id) {
      return reply.status(400).send({
        success: false,
        error: "user_id, merchant_id, and offer_id are required"
      });
    }
    try {
      const fields = [
        "user_id",
        "merchant_id",
        "offer_id",
        "type",
        "payment_method",
        "crypto_amount",
        "fiat_amount",
        "crypto_currency",
        "fiat_currency",
        "rate",
        "payment_details",
        "status"
      ];
      const values = [
        data.user_id,
        data.merchant_id,
        data.offer_id,
        data.type,
        data.payment_method,
        data.crypto_amount,
        data.fiat_amount,
        "USDC",
        "AED",
        data.rate,
        data.payment_details ? JSON.stringify(data.payment_details) : null,
        data.escrow_tx_hash ? "escrowed" : "pending"
      ];
      const expiresAtRaw = "now() + interval '15 minutes'";
      const optionals = [
        ["buyer_wallet_address", data.buyer_wallet_address],
        ["buyer_merchant_id", data.buyer_merchant_id],
        ["spread_preference", data.spread_preference],
        ["protocol_fee_percentage", data.protocol_fee_percentage],
        ["protocol_fee_amount", data.protocol_fee_amount],
        ["escrow_tx_hash", data.escrow_tx_hash],
        ["escrow_trade_id", data.escrow_trade_id],
        ["escrow_trade_pda", data.escrow_trade_pda],
        ["escrow_pda", data.escrow_pda],
        ["escrow_creator_wallet", data.escrow_creator_wallet],
        // Bump/decay fields
        ["ref_price_at_create", data.ref_price_at_create],
        ["premium_bps_current", data.premium_bps_current],
        ["premium_bps_cap", data.premium_bps_cap],
        ["bump_step_bps", data.bump_step_bps],
        ["bump_interval_sec", data.bump_interval_sec],
        ["auto_bump_enabled", data.auto_bump_enabled],
        ["next_bump_at", data.next_bump_at]
      ];
      for (const [field, value] of optionals) {
        if (value !== void 0 && value !== null) {
          fields.push(field);
          values.push(value);
        }
      }
      if (data.escrow_tx_hash) {
        fields.push("escrowed_at");
        values.push(/* @__PURE__ */ new Date());
      }
      const deducted = await dbQuery2(
        "UPDATE merchant_offers SET available_amount = available_amount - $1 WHERE id = $2 AND available_amount >= $1 RETURNING id",
        [data.crypto_amount, data.offer_id]
      );
      if (deducted.length === 0) {
        return reply.status(409).send({ success: false, error: "Insufficient offer liquidity" });
      }
      const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
      const allFields = [...fields, "expires_at"];
      const allPlaceholders = [placeholders, expiresAtRaw].join(", ");
      const rows = await dbQuery2(`INSERT INTO orders (${allFields.join(", ")}) VALUES (${allPlaceholders}) RETURNING *`, values);
      const order = rows[0];
      bufferNotification({ order_id: order.id, event_type: "ORDER_CREATED", payload: JSON.stringify({
        orderId: order.id,
        userId: data.user_id,
        merchantId: data.merchant_id,
        status: order.status,
        minimal_status: normalizeStatus2(order.status),
        order_version: order.order_version || 1,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }) });
      logger3.info("[core-api] Order created", { orderId: order.id, type: data.type });
      broadcastOrderEvent({
        event_type: "ORDER_CREATED",
        order_id: order.id,
        status: String(order.status),
        minimal_status: normalizeStatus2(order.status),
        order_version: order.order_version || 1,
        userId: data.user_id,
        merchantId: data.merchant_id,
        buyerMerchantId: data.buyer_merchant_id
      });
      return reply.status(201).send({
        success: true,
        data: { ...order, minimal_status: normalizeStatus2(order.status) }
      });
    } catch (error) {
      if (error?.statusCode) {
        return reply.status(error.statusCode).send({ success: false, error: error.message });
      }
      fastify2.log.error({ error }, "Error creating order");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.post(
    "/merchant/orders",
    async (request, reply) => {
      const data = request.body;
      if (!data.user_id || !data.merchant_id || !data.offer_id) {
        return reply.status(400).send({
          success: false,
          error: "user_id, merchant_id, and offer_id are required"
        });
      }
      try {
        const expiresAtRaw = "now() + interval '15 minutes'";
        const fields = [
          "user_id",
          "merchant_id",
          "offer_id",
          "type",
          "payment_method",
          "crypto_amount",
          "fiat_amount",
          "crypto_currency",
          "fiat_currency",
          "rate",
          "payment_details",
          "status"
        ];
        const values = [
          data.user_id,
          data.merchant_id,
          data.offer_id,
          data.type,
          data.payment_method,
          data.crypto_amount,
          data.fiat_amount,
          "USDC",
          "AED",
          data.rate,
          data.payment_details ? JSON.stringify(data.payment_details) : null,
          data.escrow_tx_hash ? "escrowed" : "pending"
        ];
        const optionalFields = [
          ["buyer_wallet_address", data.buyer_wallet_address],
          ["buyer_merchant_id", data.buyer_merchant_id],
          ["spread_preference", data.spread_preference],
          ["protocol_fee_percentage", data.protocol_fee_percentage],
          ["protocol_fee_amount", data.protocol_fee_amount],
          ["escrow_tx_hash", data.escrow_tx_hash],
          ["escrow_trade_id", data.escrow_trade_id],
          ["escrow_trade_pda", data.escrow_trade_pda],
          ["escrow_pda", data.escrow_pda],
          ["escrow_creator_wallet", data.escrow_creator_wallet],
          // Bump/decay fields
          ["ref_price_at_create", data.ref_price_at_create],
          ["premium_bps_current", data.premium_bps_current],
          ["premium_bps_cap", data.premium_bps_cap],
          ["bump_step_bps", data.bump_step_bps],
          ["bump_interval_sec", data.bump_interval_sec],
          ["auto_bump_enabled", data.auto_bump_enabled],
          ["next_bump_at", data.next_bump_at]
        ];
        for (const [field, value] of optionalFields) {
          if (value !== void 0 && value !== null) {
            fields.push(field);
            values.push(value);
          }
        }
        if (data.escrow_tx_hash) {
          fields.push("escrowed_at");
          values.push(/* @__PURE__ */ new Date());
        }
        const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
        const allFields = [...fields, "expires_at"];
        const allPlaceholders = [placeholders, expiresAtRaw].join(", ");
        const sql = `INSERT INTO orders (${allFields.join(", ")}) VALUES (${allPlaceholders}) RETURNING *`;
        const rows = await dbQuery2(sql, values);
        const order = rows[0];
        bufferNotification({ order_id: order.id, event_type: "ORDER_CREATED", payload: JSON.stringify({
          orderId: order.id,
          userId: data.user_id,
          merchantId: data.merchant_id,
          buyerMerchantId: data.buyer_merchant_id,
          status: order.status,
          minimal_status: normalizeStatus2(order.status),
          order_version: order.order_version || 1,
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }) });
        logger3.info("[core-api] Merchant order created", {
          orderId: order.id,
          merchantId: data.merchant_id,
          buyerMerchantId: data.buyer_merchant_id,
          isM2M: data.is_m2m
        });
        broadcastOrderEvent({
          event_type: "ORDER_CREATED",
          order_id: order.id,
          status: String(order.status),
          minimal_status: normalizeStatus2(order.status),
          order_version: order.order_version || 1,
          userId: data.user_id,
          merchantId: data.merchant_id,
          buyerMerchantId: data.buyer_merchant_id
        });
        return reply.status(201).send({
          success: true,
          data: { ...order, minimal_status: normalizeStatus2(order.status) }
        });
      } catch (error) {
        if (error?.statusCode) {
          return reply.status(error.statusCode).send({ success: false, error: error.message });
        }
        fastify2.log.error({ error }, "Error creating merchant order");
        return reply.status(500).send({ success: false, error: "Internal server error" });
      }
    }
  );
};

// src/routes/escrow.ts
import {
  queryOne as queryOne3,
  MOCK_MODE as MOCK_MODE3,
  normalizeStatus as normalizeStatus3
} from "settlement-core";
var escrowRoutes = async (fastify2) => {
  fastify2.post("/orders/:id/escrow", async (request, reply) => {
    const { id } = request.params;
    const {
      tx_hash,
      actor_type,
      actor_id,
      escrow_address,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet
    } = request.body;
    if (!tx_hash || !actor_type || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: "tx_hash, actor_type, and actor_id are required"
      });
    }
    try {
      const procResult = await queryOne3(
        "SELECT escrow_order_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          tx_hash,
          actor_type,
          actor_id,
          escrow_address || null,
          escrow_trade_id ?? null,
          escrow_trade_pda || null,
          escrow_pda || null,
          escrow_creator_wallet || null,
          MOCK_MODE3
        ]
      );
      const data = procResult.escrow_order_v1;
      if (!data.success) {
        const errMsg = data.error;
        if (errMsg === "INSUFFICIENT_BALANCE") {
          return reply.status(400).send({ success: false, error: "Insufficient balance to lock escrow" });
        }
        if (errMsg === "ALREADY_ESCROWED") {
          return reply.status(409).send({ success: false, error: "Escrow already locked" });
        }
        if (errMsg === "ORDER_STATUS_CHANGED") {
          return reply.status(409).send({ success: false, error: "Order status changed" });
        }
        if (errMsg === "ORDER_NOT_FOUND") {
          return reply.status(404).send({ success: false, error: "Order not found" });
        }
        return reply.status(400).send({ success: false, error: errMsg });
      }
      const updatedOrder = data.order;
      const oldStatus = data.old_status;
      const userId = updatedOrder.user_id;
      const merchantId = updatedOrder.merchant_id;
      bufferEvent({ order_id: id, event_type: "status_changed_to_escrowed", actor_type, actor_id, old_status: oldStatus, new_status: "escrowed", metadata: JSON.stringify({ tx_hash }) });
      bufferNotification({ order_id: id, event_type: "ORDER_ESCROWED", payload: JSON.stringify({ orderId: id, status: "escrowed", previousStatus: oldStatus, escrowTxHash: tx_hash, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }) });
      broadcastOrderEvent({
        event_type: "ORDER_ESCROWED",
        order_id: id,
        status: "escrowed",
        minimal_status: normalizeStatus3("escrowed"),
        order_version: updatedOrder.order_version,
        userId,
        merchantId,
        buyerMerchantId: updatedOrder.buyer_merchant_id ?? void 0,
        previousStatus: oldStatus
      });
      return reply.send({
        success: true,
        data: updatedOrder
      });
    } catch (error) {
      fastify2.log.error({ error, id }, "Error locking escrow");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
};

// src/routes/extension.ts
import {
  query as dbQuery3,
  queryOne as queryOne4,
  canExtendOrder,
  getExtensionDuration,
  getExpiryOutcome,
  normalizeStatus as normalizeStatus4,
  logger as logger5
} from "settlement-core";
var extensionRoutes = async (fastify2) => {
  fastify2.post("/orders/:id/extension", async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id } = request.body;
    if (!actor_type || !actor_id) {
      return reply.status(400).send({ success: false, error: "actor_type and actor_id required" });
    }
    try {
      const order = await queryOne4(
        "SELECT id, status, extension_count, max_extensions, extension_requested_by, user_id, merchant_id FROM orders WHERE id = $1",
        [id]
      );
      if (!order) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }
      const extensionCheck = canExtendOrder(order.status, order.extension_count, order.max_extensions);
      if (!extensionCheck.canExtend) {
        return reply.status(400).send({ success: false, error: extensionCheck.reason });
      }
      if (order.extension_requested_by) {
        return reply.status(400).send({ success: false, error: "Extension request already pending" });
      }
      const duration = getExtensionDuration(order.status);
      const updatedOrder = await queryOne4(
        `UPDATE orders
         SET extension_requested_by = $2,
             extension_requested_at = NOW(),
             extension_minutes = $3,
             order_version = order_version + 1
         WHERE id = $1
         RETURNING *`,
        [id, actor_type, duration]
      );
      await dbQuery3(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, 'extension_requested', $2, $3, $4)`,
        [id, actor_type, actor_id, JSON.stringify({ extension_count: order.extension_count, extension_minutes: duration })]
      );
      logger5.info("[core-api] Extension requested", { orderId: id, actor: actor_type });
      broadcastOrderEvent({
        event_type: "EXTENSION_REQUESTED",
        order_id: id,
        status: order.status,
        minimal_status: normalizeStatus4(order.status),
        order_version: updatedOrder.order_version,
        userId: order.user_id,
        merchantId: order.merchant_id
      });
      return reply.send({ success: true, data: updatedOrder });
    } catch (error) {
      fastify2.log.error({ error, id }, "Error requesting extension");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.put("/orders/:id/extension", async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, accept } = request.body;
    if (!actor_type || !actor_id || accept === void 0) {
      return reply.status(400).send({ success: false, error: "actor_type, actor_id, and accept required" });
    }
    try {
      const order = await queryOne4(
        "SELECT * FROM orders WHERE id = $1",
        [id]
      );
      if (!order) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }
      if (!order.extension_requested_by) {
        return reply.status(400).send({ success: false, error: "No extension request pending" });
      }
      if (order.extension_requested_by === actor_type) {
        return reply.status(400).send({ success: false, error: "Cannot respond to own request" });
      }
      let updatedOrder;
      if (accept) {
        const extensionMinutes = order.extension_minutes || getExtensionDuration(order.status);
        updatedOrder = await queryOne4(
          `UPDATE orders
           SET extension_count = extension_count + 1,
               extension_requested_by = NULL,
               extension_requested_at = NULL,
               expires_at = COALESCE(expires_at, NOW()) + INTERVAL '1 minute' * $2,
               order_version = order_version + 1
           WHERE id = $1
           RETURNING *`,
          [id, extensionMinutes]
        );
        await dbQuery3(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'extension_accepted', $2, $3, $4)`,
          [id, actor_type, actor_id, JSON.stringify({ extension_count: order.extension_count + 1, extension_minutes: extensionMinutes })]
        );
      } else {
        const outcome = getExpiryOutcome(order.status, order.extension_count, order.max_extensions);
        if (outcome === "disputed") {
          updatedOrder = await queryOne4(
            `UPDATE orders
             SET extension_requested_by = NULL,
                 extension_requested_at = NULL,
                 status = 'disputed',
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id]
          );
          await dbQuery3(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_disputed', 'system', NULL, $2, 'disputed', $3)`,
            [id, order.status, JSON.stringify({ reason: "Extension declined after max extensions" })]
          );
        } else {
          updatedOrder = await queryOne4(
            `UPDATE orders
             SET extension_requested_by = NULL,
                 extension_requested_at = NULL,
                 status = 'cancelled',
                 cancelled_at = NOW(),
                 cancelled_by = $2,
                 cancellation_reason = 'Extension declined',
                 order_version = order_version + 1
             WHERE id = $1
             RETURNING *`,
            [id, actor_type]
          );
          await dbQuery3(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'status_changed_to_cancelled', $2, $3, $4, 'cancelled', $5)`,
            [id, actor_type, actor_id, order.status, JSON.stringify({ reason: "Extension declined" })]
          );
        }
        await dbQuery3(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'extension_declined', $2, $3, $4)`,
          [id, actor_type, actor_id, JSON.stringify({ outcome })]
        );
      }
      logger5.info("[core-api] Extension response", { orderId: id, accepted: accept });
      const finalStatus = updatedOrder.status || order.status;
      broadcastOrderEvent({
        event_type: accept ? "EXTENSION_ACCEPTED" : `ORDER_${finalStatus.toUpperCase()}`,
        order_id: id,
        status: finalStatus,
        minimal_status: normalizeStatus4(finalStatus),
        order_version: updatedOrder.order_version,
        userId: order.user_id,
        merchantId: order.merchant_id,
        previousStatus: order.status
      });
      return reply.send({
        success: true,
        data: updatedOrder
      });
    } catch (error) {
      fastify2.log.error({ error, id }, "Error responding to extension");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
};

// src/routes/dispute.ts
import {
  query as dbQuery4,
  queryOne as queryOne5,
  normalizeStatus as normalizeStatus5,
  logger as logger6
} from "settlement-core";
var disputeRoutes = async (fastify2) => {
  fastify2.post("/orders/:id/dispute", async (request, reply) => {
    const { id } = request.params;
    const { reason, description, initiated_by, actor_id } = request.body;
    if (!reason || !initiated_by || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: "reason, initiated_by, and actor_id are required"
      });
    }
    try {
      const order = await queryOne5(
        "SELECT id, status, user_id, merchant_id FROM orders WHERE id = $1",
        [id]
      );
      if (!order) {
        return reply.status(404).send({ success: false, error: "Order not found" });
      }
      if (order.status === "disputed") {
        return reply.status(400).send({ success: false, error: "Order is already disputed" });
      }
      const existing = await dbQuery4("SELECT id FROM disputes WHERE order_id = $1", [id]);
      if (existing.length > 0) {
        return reply.status(400).send({ success: false, error: "Dispute already exists" });
      }
      try {
        await dbQuery4(`
          ALTER TABLE disputes
          ADD COLUMN IF NOT EXISTS proposed_resolution VARCHAR(50),
          ADD COLUMN IF NOT EXISTS proposed_by UUID,
          ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
          ADD COLUMN IF NOT EXISTS user_confirmed BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS merchant_confirmed BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS split_percentage JSONB,
          ADD COLUMN IF NOT EXISTS assigned_to UUID
        `);
      } catch (alterErr) {
      }
      const disputeResult = await dbQuery4(
        `INSERT INTO disputes (
          order_id, reason, description, raised_by, raiser_id, status,
          user_confirmed, merchant_confirmed, created_at
        )
         VALUES ($1, $2::dispute_reason, $3, $4::actor_type, $5, 'open'::dispute_status, false, false, NOW())
         RETURNING *`,
        [id, reason, description || "", initiated_by, actor_id]
      );
      await dbQuery4(
        `UPDATE orders SET status = 'disputed'::order_status, order_version = order_version + 1 WHERE id = $1`,
        [id]
      );
      await dbQuery4(
        `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
         VALUES ($1, 'status_changed_to_disputed', $2, $3, $4, 'disputed', $5)`,
        [id, initiated_by, actor_id, order.status, JSON.stringify({ reason, description })]
      );
      await dbQuery4(
        `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_DISPUTED', $2, 'pending')`,
        [
          id,
          JSON.stringify({
            orderId: id,
            userId: order.user_id,
            merchantId: order.merchant_id,
            status: "disputed",
            previousStatus: order.status,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          })
        ]
      );
      logger6.info("[core-api] Dispute created", { orderId: id, reason });
      broadcastOrderEvent({
        event_type: "ORDER_DISPUTED",
        order_id: id,
        status: "disputed",
        minimal_status: normalizeStatus5("disputed"),
        order_version: 0,
        // version already incremented in DB
        userId: order.user_id,
        merchantId: order.merchant_id,
        previousStatus: order.status
      });
      return reply.send({ success: true, data: disputeResult[0] });
    } catch (error) {
      fastify2.log.error({ error, id }, "Error creating dispute");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.post("/orders/:id/dispute/confirm", async (request, reply) => {
    const { id } = request.params;
    const { party, action, partyId } = request.body;
    if (!party || !action || !partyId) {
      return reply.status(400).send({ success: false, error: "party, action, and partyId required" });
    }
    try {
      const disputeResult = await dbQuery4(
        `SELECT d.*, o.user_id, o.merchant_id
         FROM disputes d JOIN orders o ON d.order_id = o.id
         WHERE d.order_id = $1`,
        [id]
      );
      if (disputeResult.length === 0) {
        return reply.status(404).send({ success: false, error: "Dispute not found" });
      }
      const dispute = disputeResult[0];
      if (dispute.status !== "pending_confirmation") {
        return reply.status(400).send({ success: false, error: "No pending resolution" });
      }
      if (party === "user" && partyId !== dispute.user_id) {
        return reply.status(403).send({ success: false, error: "Unauthorized" });
      }
      if (party === "merchant" && partyId !== dispute.merchant_id) {
        return reply.status(403).send({ success: false, error: "Unauthorized" });
      }
      if (action === "reject") {
        await dbQuery4(
          `UPDATE disputes
           SET status = 'investigating'::dispute_status,
               proposed_resolution = NULL,
               user_confirmed = false,
               merchant_confirmed = false
           WHERE order_id = $1`,
          [id]
        );
        return reply.send({
          success: true,
          data: { status: "investigating", message: "Resolution rejected" }
        });
      }
      const updateField = party === "user" ? "user_confirmed" : "merchant_confirmed";
      await dbQuery4(`UPDATE disputes SET ${updateField} = true WHERE order_id = $1`, [id]);
      const updated = await queryOne5("SELECT user_confirmed, merchant_confirmed, proposed_resolution FROM disputes WHERE order_id = $1", [id]);
      if (updated && updated.user_confirmed && updated.merchant_confirmed) {
        const resolution = updated.proposed_resolution;
        const orderResult = await dbQuery4(
          `SELECT o.*, d.split_percentage FROM orders o JOIN disputes d ON d.order_id = o.id WHERE o.id = $1`,
          [id]
        );
        const order = orderResult[0];
        const amount = parseFloat(String(order.crypto_amount));
        let userAmount = 0;
        let merchantAmount = 0;
        let orderStatus = "completed";
        if (resolution === "user") {
          userAmount = amount;
          orderStatus = "cancelled";
        } else if (resolution === "merchant") {
          merchantAmount = amount;
          orderStatus = "completed";
        } else if (resolution === "split") {
          const splitPct = order.split_percentage ? typeof order.split_percentage === "string" ? JSON.parse(order.split_percentage) : order.split_percentage : { user: 50, merchant: 50 };
          userAmount = amount * (splitPct.user / 100);
          merchantAmount = amount * (splitPct.merchant / 100);
          orderStatus = "completed";
        }
        if (userAmount > 0) {
          await dbQuery4("UPDATE users SET balance = balance + $1 WHERE id = $2", [userAmount, order.user_id]);
        }
        if (merchantAmount > 0) {
          await dbQuery4("UPDATE merchants SET balance = balance + $1 WHERE id = $2", [merchantAmount, order.merchant_id]);
        }
        await dbQuery4(
          `UPDATE disputes SET status = 'resolved'::dispute_status, resolution = $1, resolved_at = NOW() WHERE order_id = $2`,
          [resolution, id]
        );
        await dbQuery4(
          `UPDATE orders SET status = $1::order_status, order_version = order_version + 1 WHERE id = $2`,
          [orderStatus, id]
        );
        await dbQuery4(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, $2, $3, 'pending')`,
          [
            id,
            `ORDER_${orderStatus.toUpperCase()}`,
            JSON.stringify({
              orderId: id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: orderStatus,
              previousStatus: "disputed",
              resolution,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            })
          ]
        );
        logger6.info("[core-api] Dispute resolved", { orderId: id, resolution, orderStatus });
        broadcastOrderEvent({
          event_type: `ORDER_${orderStatus.toUpperCase()}`,
          order_id: id,
          status: orderStatus,
          minimal_status: normalizeStatus5(orderStatus),
          order_version: 0,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: "disputed"
        });
        return reply.send({
          success: true,
          data: {
            status: `resolved_${resolution}`,
            orderStatus,
            finalized: true,
            moneyReleased: { user: userAmount, merchant: merchantAmount, total: amount }
          }
        });
      }
      return reply.send({
        success: true,
        data: {
          status: "pending_confirmation",
          userConfirmed: party === "user" ? true : dispute.user_confirmed,
          merchantConfirmed: party === "merchant" ? true : dispute.merchant_confirmed,
          finalized: false
        }
      });
    } catch (error) {
      fastify2.log.error({ error, id }, "Error confirming dispute");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
};

// src/routes/expire.ts
import {
  query as dbQuery5,
  normalizeStatus as normalizeStatus6,
  logger as logger7
} from "settlement-core";
var expireRoutes = async (fastify2) => {
  fastify2.post("/orders/expire", async (_request, reply) => {
    try {
      const ordersToExpire = await dbQuery5(
        `SELECT id, status, user_id, merchant_id, buyer_merchant_id, type, crypto_amount, escrow_tx_hash, accepted_at
         FROM orders
         WHERE status NOT IN ('completed', 'cancelled', 'expired', 'disputed')
           AND (
             (status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes')
             OR (status NOT IN ('pending') AND COALESCE(accepted_at, created_at) < NOW() - INTERVAL '120 minutes')
           )`
      );
      if (ordersToExpire.length === 0) {
        return reply.send({ success: true, message: "No orders to expire", expiredCount: 0 });
      }
      const pendingExpired = ordersToExpire.filter((o) => o.status === "pending");
      const acceptedExpired = ordersToExpire.filter((o) => o.status !== "pending");
      let totalExpired = 0;
      if (pendingExpired.length > 0) {
        const pendingIds = pendingExpired.map((o) => o.id);
        await dbQuery5(
          `UPDATE orders
           SET status = 'expired'::order_status,
               cancelled_at = NOW(),
               cancelled_by = 'system',
               cancellation_reason = 'Order expired - no one accepted within 15 minutes',
               order_version = order_version + 1
           WHERE id = ANY($1)`,
          [pendingIds]
        );
        totalExpired += pendingIds.length;
        for (const o of pendingExpired) {
          broadcastOrderEvent({
            event_type: "ORDER_EXPIRED",
            order_id: o.id,
            status: "expired",
            minimal_status: normalizeStatus6("expired"),
            order_version: 0,
            userId: o.user_id,
            merchantId: o.merchant_id,
            previousStatus: o.status
          });
        }
      }
      for (const order of acceptedExpired) {
        const hasEscrow = !!order.escrow_tx_hash;
        if (hasEscrow) {
          await dbQuery5(
            `UPDATE orders
             SET status = 'disputed'::order_status,
                 cancellation_reason = 'Order timed out with escrow locked',
                 order_version = order_version + 1
             WHERE id = $1`,
            [order.id]
          );
        } else {
          await dbQuery5(
            `UPDATE orders
             SET status = 'cancelled'::order_status,
                 cancelled_at = NOW(),
                 cancelled_by = 'system',
                 cancellation_reason = 'Order timed out',
                 order_version = order_version + 1
             WHERE id = $1`,
            [order.id]
          );
        }
        const newStatus = hasEscrow ? "disputed" : "cancelled";
        await dbQuery5(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, $2, 'system', 'expiry-endpoint', $3, $4, $5)`,
          [
            order.id,
            `status_changed_to_${newStatus}`,
            order.status,
            newStatus,
            JSON.stringify({ reason: "Order timed out" })
          ]
        );
        await dbQuery5(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, $2, $3, 'pending')`,
          [
            order.id,
            `ORDER_${newStatus.toUpperCase()}`,
            JSON.stringify({
              orderId: order.id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: newStatus,
              previousStatus: order.status,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            })
          ]
        );
        broadcastOrderEvent({
          event_type: `ORDER_${newStatus.toUpperCase()}`,
          order_id: order.id,
          status: newStatus,
          minimal_status: normalizeStatus6(newStatus),
          order_version: 0,
          userId: order.user_id,
          merchantId: order.merchant_id,
          previousStatus: order.status
        });
        totalExpired++;
      }
      logger7.info("[core-api] Orders expired", { count: totalExpired });
      return reply.send({
        success: true,
        message: `Expired ${totalExpired} orders`,
        expiredCount: totalExpired
      });
    } catch (error) {
      fastify2.log.error({ error }, "Error expiring orders");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
};

// src/routes/debug.ts
import { query as query2 } from "settlement-core";
import { readFileSync } from "fs";
var debugRoutes = async (fastify2) => {
  fastify2.addHook("onRequest", async (_request, reply) => {
    if (process.env.NODE_ENV === "production") {
      return reply.status(404).send({ error: "Not found" });
    }
  });
  fastify2.get("/debug/ws", async () => {
    return getWsStats();
  });
  fastify2.get("/debug/workers", async () => {
    const readHeartbeat = (name) => {
      try {
        return JSON.parse(readFileSync(`/tmp/bm-worker-${name}.json`, "utf-8"));
      } catch {
        return { status: "not running or no heartbeat file" };
      }
    };
    return {
      outbox: readHeartbeat("outbox"),
      expiry: readHeartbeat("expiry"),
      autobump: readHeartbeat("autobump")
    };
  });
  fastify2.get("/debug/outbox", async (request) => {
    const status = request.query.status || "pending";
    const limit = Math.min(parseInt(request.query.limit || "50", 10), 200);
    const rows = await query2(
      `SELECT id, order_id, event_type, status, attempts, max_attempts,
              created_at, last_attempt_at, sent_at, last_error
       FROM notification_outbox
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [status, limit]
    );
    const counts = await query2(
      `SELECT status, count(*)::text FROM notification_outbox GROUP BY status ORDER BY status`
    );
    return {
      rows,
      counts: Object.fromEntries(counts.map((c) => [c.status, parseInt(c.count, 10)])),
      total: rows.length
    };
  });
};

// src/routes/conversion.ts
import { transaction as transaction2, logger as logger8 } from "settlement-core";
function calculateConversion(direction, amountIn, rate) {
  if (direction === "usdt_to_sinr") {
    return Math.floor(amountIn * rate * 100 / 1e6);
  } else {
    return Math.floor(amountIn * 1e6 / (rate * 100));
  }
}
function calculateDefaultExposureLimit(usdtBalance, rate) {
  return Math.floor(usdtBalance * rate * 100 * 0.9);
}
async function logLedgerEntry(client, accountType, accountId, direction, usdtAmount, usdtBalanceBefore, usdtBalanceAfter) {
  const ledgerAmount = direction === "usdt_to_sinr" ? -usdtAmount : usdtAmount;
  const description = direction === "usdt_to_sinr" ? "Converted USDT to sINR" : "Converted sINR to USDT";
  await client.query(
    `INSERT INTO ledger_entries
     (account_type, account_id, entry_type, amount, asset, description, balance_before, balance_after)
     VALUES ($1, $2, 'SYNTHETIC_CONVERSION', $3, 'USDT', $4, $5, $6)`,
    [accountType, accountId, ledgerAmount, description, usdtBalanceBefore, usdtBalanceAfter]
  );
}
async function logMerchantTransaction(client, accountType, accountId, direction, usdtAmount, amountIn, amountOut, usdtBalanceBefore) {
  const table = accountType === "merchant" ? "merchants" : "users";
  const merchantId = accountType === "merchant" ? accountId : null;
  const userId = accountType === "user" ? accountId : null;
  const transactionAmount = direction === "usdt_to_sinr" ? -usdtAmount : usdtAmount;
  const balanceAfter = usdtBalanceBefore + transactionAmount;
  const description = direction === "usdt_to_sinr" ? `Converted ${(amountIn / 1e6).toFixed(6)} USDT to ${(amountOut / 100).toFixed(2)} sINR` : `Converted ${(amountIn / 100).toFixed(2)} sINR to ${(amountOut / 1e6).toFixed(6)} USDT`;
  await client.query(
    `INSERT INTO merchant_transactions
     (merchant_id, user_id, type, amount, balance_before, balance_after, description)
     VALUES ($1, $2, 'manual_adjustment', $3, $4, $5, $6)`,
    [merchantId, userId, transactionAmount, usdtBalanceBefore, balanceAfter, description]
  );
}
var conversionRoutes = async (fastify2) => {
  fastify2.post("/convert/usdt-to-sinr", async (request, reply) => {
    const { account_type, account_id, amount, idempotency_key } = request.body;
    if (!account_type || !account_id || !amount) {
      return reply.status(400).send({
        success: false,
        error: "account_type, account_id, and amount are required"
      });
    }
    if (amount <= 0) {
      return reply.status(400).send({
        success: false,
        error: "Amount must be positive"
      });
    }
    try {
      const result = await transaction2(async (client) => {
        const table = account_type === "merchant" ? "merchants" : "users";
        if (idempotency_key) {
          const existing = await client.query(
            `SELECT id, amount_in, amount_out, rate, usdt_balance_after, sinr_balance_after
             FROM synthetic_conversions
             WHERE idempotency_key = $1`,
            [idempotency_key]
          );
          if (existing.rows.length > 0) {
            const conv = existing.rows[0];
            return {
              conversion_id: String(conv.id),
              amount_in: Number(conv.amount_in),
              amount_out: Number(conv.amount_out),
              rate: Number(conv.rate),
              usdt_balance_after: Number(conv.usdt_balance_after),
              sinr_balance_after: Number(conv.sinr_balance_after)
            };
          }
        }
        const lockResult = await client.query(
          `SELECT balance, sinr_balance, synthetic_rate, max_sinr_exposure
           FROM ${table}
           WHERE id = $1
           FOR UPDATE`,
          [account_id]
        );
        if (lockResult.rows.length === 0) {
          throw new Error("ACCOUNT_NOT_FOUND");
        }
        const account = lockResult.rows[0];
        const usdtBalance = parseFloat(String(account.balance));
        const sinrBalance = Number(account.sinr_balance);
        const rate = parseFloat(String(account.synthetic_rate));
        const maxExposure = account.max_sinr_exposure !== null ? Number(account.max_sinr_exposure) : null;
        const usdtAmount = amount / 1e6;
        if (usdtAmount > usdtBalance) {
          throw new Error("INSUFFICIENT_BALANCE");
        }
        const amountOut = calculateConversion("usdt_to_sinr", amount, rate);
        const newSinrBalance = sinrBalance + amountOut;
        const effectiveLimit = maxExposure ?? calculateDefaultExposureLimit(usdtBalance, rate);
        if (newSinrBalance > effectiveLimit) {
          throw new Error("EXPOSURE_LIMIT_EXCEEDED");
        }
        const newUsdtBalance = usdtBalance - usdtAmount;
        await client.query(
          `UPDATE ${table}
           SET balance = $1, sinr_balance = $2
           WHERE id = $3`,
          [newUsdtBalance, newSinrBalance, account_id]
        );
        const convResult = await client.query(
          `INSERT INTO synthetic_conversions
           (account_type, account_id, direction, amount_in, amount_out, rate,
            usdt_balance_before, usdt_balance_after, sinr_balance_before, sinr_balance_after,
            idempotency_key)
           VALUES ($1, $2, 'usdt_to_sinr', $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            account_type,
            account_id,
            amount,
            amountOut,
            rate,
            usdtBalance,
            newUsdtBalance,
            sinrBalance,
            newSinrBalance,
            idempotency_key || null
          ]
        );
        const conversionId = String(convResult.rows[0].id);
        await logLedgerEntry(
          client,
          account_type,
          account_id,
          "usdt_to_sinr",
          usdtAmount,
          usdtBalance,
          newUsdtBalance
        );
        await logMerchantTransaction(
          client,
          account_type,
          account_id,
          "usdt_to_sinr",
          usdtAmount,
          amount,
          amountOut,
          usdtBalance
        );
        logger8.info("[Conversion] USDT\u2192sINR completed", {
          conversionId,
          accountType: account_type,
          accountId: account_id,
          amountIn: amount,
          amountOut,
          rate
        });
        return {
          conversion_id: conversionId,
          amount_in: amount,
          amount_out: amountOut,
          rate,
          usdt_balance_after: newUsdtBalance,
          sinr_balance_after: newSinrBalance
        };
      });
      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const errMsg = error.message;
      if (errMsg === "INSUFFICIENT_BALANCE") {
        return reply.status(400).send({
          success: false,
          error: "Insufficient USDT balance"
        });
      }
      if (errMsg === "EXPOSURE_LIMIT_EXCEEDED") {
        return reply.status(400).send({
          success: false,
          error: "Conversion would exceed synthetic exposure limit"
        });
      }
      if (errMsg === "ACCOUNT_NOT_FOUND") {
        return reply.status(404).send({
          success: false,
          error: "Account not found"
        });
      }
      fastify2.log.error({ error, accountId: request.body.account_id }, "Error converting USDT to sINR");
      return reply.status(500).send({
        success: false,
        error: "Internal server error"
      });
    }
  });
  fastify2.post("/convert/sinr-to-usdt", async (request, reply) => {
    const { account_type, account_id, amount, idempotency_key } = request.body;
    if (!account_type || !account_id || !amount) {
      return reply.status(400).send({
        success: false,
        error: "account_type, account_id, and amount are required"
      });
    }
    if (amount <= 0) {
      return reply.status(400).send({
        success: false,
        error: "Amount must be positive"
      });
    }
    try {
      const result = await transaction2(async (client) => {
        const table = account_type === "merchant" ? "merchants" : "users";
        if (idempotency_key) {
          const existing = await client.query(
            `SELECT id, amount_in, amount_out, rate, usdt_balance_after, sinr_balance_after
             FROM synthetic_conversions
             WHERE idempotency_key = $1`,
            [idempotency_key]
          );
          if (existing.rows.length > 0) {
            const conv = existing.rows[0];
            return {
              conversion_id: String(conv.id),
              amount_in: Number(conv.amount_in),
              amount_out: Number(conv.amount_out),
              rate: Number(conv.rate),
              usdt_balance_after: Number(conv.usdt_balance_after),
              sinr_balance_after: Number(conv.sinr_balance_after)
            };
          }
        }
        const lockResult = await client.query(
          `SELECT balance, sinr_balance, synthetic_rate
           FROM ${table}
           WHERE id = $1
           FOR UPDATE`,
          [account_id]
        );
        if (lockResult.rows.length === 0) {
          throw new Error("ACCOUNT_NOT_FOUND");
        }
        const account = lockResult.rows[0];
        const usdtBalance = parseFloat(String(account.balance));
        const sinrBalance = Number(account.sinr_balance);
        const rate = parseFloat(String(account.synthetic_rate));
        if (amount > sinrBalance) {
          throw new Error("INSUFFICIENT_SINR_BALANCE");
        }
        const amountOut = calculateConversion("sinr_to_usdt", amount, rate);
        const usdtAmount = amountOut / 1e6;
        const newUsdtBalance = usdtBalance + usdtAmount;
        const newSinrBalance = sinrBalance - amount;
        await client.query(
          `UPDATE ${table}
           SET balance = $1, sinr_balance = $2
           WHERE id = $3`,
          [newUsdtBalance, newSinrBalance, account_id]
        );
        const convResult = await client.query(
          `INSERT INTO synthetic_conversions
           (account_type, account_id, direction, amount_in, amount_out, rate,
            usdt_balance_before, usdt_balance_after, sinr_balance_before, sinr_balance_after,
            idempotency_key)
           VALUES ($1, $2, 'sinr_to_usdt', $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            account_type,
            account_id,
            amount,
            amountOut,
            rate,
            usdtBalance,
            newUsdtBalance,
            sinrBalance,
            newSinrBalance,
            idempotency_key || null
          ]
        );
        const conversionId = String(convResult.rows[0].id);
        await logLedgerEntry(
          client,
          account_type,
          account_id,
          "sinr_to_usdt",
          usdtAmount,
          usdtBalance,
          newUsdtBalance
        );
        await logMerchantTransaction(
          client,
          account_type,
          account_id,
          "sinr_to_usdt",
          usdtAmount,
          amount,
          amountOut,
          usdtBalance
        );
        logger8.info("[Conversion] sINR\u2192USDT completed", {
          conversionId,
          accountType: account_type,
          accountId: account_id,
          amountIn: amount,
          amountOut,
          rate
        });
        return {
          conversion_id: conversionId,
          amount_in: amount,
          amount_out: amountOut,
          rate,
          usdt_balance_after: newUsdtBalance,
          sinr_balance_after: newSinrBalance
        };
      });
      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const errMsg = error.message;
      if (errMsg === "INSUFFICIENT_SINR_BALANCE") {
        return reply.status(400).send({
          success: false,
          error: "Insufficient sINR balance"
        });
      }
      if (errMsg === "ACCOUNT_NOT_FOUND") {
        return reply.status(404).send({
          success: false,
          error: "Account not found"
        });
      }
      fastify2.log.error({ error, accountId: request.body.account_id }, "Error converting sINR to USDT");
      return reply.status(500).send({
        success: false,
        error: "Internal server error"
      });
    }
  });
};

// src/routes/corridor.ts
import { transaction as transaction3, logger as logger9 } from "settlement-core";
var corridorRoutes = async (fastify2) => {
  fastify2.post("/corridor/match", async (request, reply) => {
    const { order_id, buyer_merchant_id, seller_merchant_id, fiat_amount, bank_details } = request.body;
    if (!order_id || !buyer_merchant_id || !seller_merchant_id || !fiat_amount) {
      return reply.status(400).send({ success: false, error: "Missing required fields" });
    }
    try {
      const result = await transaction3(async (client) => {
        const lpResult = await client.query(
          `SELECT cp.*, m.rating as merchant_rating, m.display_name as merchant_name
           FROM corridor_providers cp
           JOIN merchants m ON cp.merchant_id = m.id
           WHERE cp.is_active = true
             AND m.is_online = true
             AND m.status = 'active'
             AND cp.min_amount <= $1
             AND cp.max_amount >= $1
             AND cp.merchant_id != $2
             AND cp.merchant_id != $3
             AND (cp.available_hours_start IS NULL
                  OR CURRENT_TIME BETWEEN cp.available_hours_start AND cp.available_hours_end)
           ORDER BY cp.fee_percentage ASC, m.rating DESC
           LIMIT 1
           FOR UPDATE`,
          [fiat_amount, buyer_merchant_id, seller_merchant_id]
        );
        if (lpResult.rows.length === 0) {
          throw new Error("NO_LP_AVAILABLE");
        }
        const lp = lpResult.rows[0];
        const feePercentage = parseFloat(String(lp.fee_percentage));
        const fiatFils = Math.round(fiat_amount * 100);
        const corridorFeeFils = Math.round(fiatFils * feePercentage / 100);
        const totalSaedLock = fiatFils + corridorFeeFils;
        const buyerResult = await client.query(
          "SELECT sinr_balance FROM merchants WHERE id = $1 FOR UPDATE",
          [buyer_merchant_id]
        );
        if (buyerResult.rows.length === 0) throw new Error("BUYER_NOT_FOUND");
        const buyerSaed = parseInt(String(buyerResult.rows[0].sinr_balance));
        if (buyerSaed < totalSaedLock) throw new Error("INSUFFICIENT_SAED");
        await client.query(
          "UPDATE merchants SET sinr_balance = sinr_balance - $1 WHERE id = $2",
          [totalSaedLock, buyer_merchant_id]
        );
        const saedAfter = buyerSaed - totalSaedLock;
        await client.query(
          `INSERT INTO ledger_entries
           (account_type, account_id, entry_type, amount, asset,
            related_order_id, description, metadata, balance_before, balance_after)
           VALUES ('merchant', $1, 'CORRIDOR_SAED_LOCK', $2, 'sAED', $3, $4, $5, $6, $7)`,
          [
            buyer_merchant_id,
            -totalSaedLock,
            order_id,
            `Corridor sAED lock: ${totalSaedLock} fils (${fiat_amount} AED + ${corridorFeeFils} fils fee)`,
            JSON.stringify({ fiat_fils: fiatFils, fee_fils: corridorFeeFils, fee_pct: feePercentage }),
            buyerSaed,
            saedAfter
          ]
        );
        await client.query(
          `INSERT INTO merchant_transactions
           (merchant_id, order_id, type, amount, balance_before, balance_after, description)
           VALUES ($1, $2, 'synthetic_conversion', $3, $4, $5, $6)`,
          [buyer_merchant_id, order_id, -totalSaedLock, buyerSaed, saedAfter, "Corridor sAED lock"]
        );
        const ffResult = await client.query(
          `INSERT INTO corridor_fulfillments
           (order_id, provider_merchant_id, provider_id, saed_amount_locked, fiat_amount,
            corridor_fee, bank_details, send_deadline)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '30 minutes')
           RETURNING *`,
          [
            order_id,
            lp.merchant_id,
            lp.id,
            totalSaedLock,
            fiat_amount,
            corridorFeeFils,
            bank_details ? JSON.stringify(bank_details) : null
          ]
        );
        const fulfillment = ffResult.rows[0];
        await client.query(
          `UPDATE orders
           SET payment_via = 'saed_corridor', corridor_fulfillment_id = $1
           WHERE id = $2`,
          [fulfillment.id, order_id]
        );
        await client.query(
          `INSERT INTO notification_outbox
           (order_id, event_type, merchant_id, payload)
           VALUES ($1, 'CORRIDOR_ASSIGNMENT', $2, $3)`,
          [
            order_id,
            lp.merchant_id,
            JSON.stringify({
              fulfillment_id: fulfillment.id,
              fiat_amount,
              corridor_fee_fils: corridorFeeFils,
              send_deadline: fulfillment.send_deadline,
              bank_details: bank_details || null
            })
          ]
        );
        logger9.info("[Corridor] LP matched and sAED locked", {
          orderId: order_id,
          buyerMerchantId: buyer_merchant_id,
          lpMerchantId: lp.merchant_id,
          feePercentage,
          totalSaedLock,
          fiatAmount: fiat_amount
        });
        return {
          fulfillment_id: fulfillment.id,
          provider_merchant_id: lp.merchant_id,
          provider_name: lp.merchant_name,
          fee_percentage: feePercentage,
          corridor_fee_fils: corridorFeeFils,
          saed_locked: totalSaedLock,
          fiat_amount,
          send_deadline: fulfillment.send_deadline
        };
      });
      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const msg = error.message;
      if (msg === "NO_LP_AVAILABLE") {
        return reply.status(404).send({ success: false, error: "No liquidity provider available for this amount" });
      }
      if (msg === "BUYER_NOT_FOUND") {
        return reply.status(404).send({ success: false, error: "Buyer merchant not found" });
      }
      if (msg === "INSUFFICIENT_SAED") {
        return reply.status(400).send({ success: false, error: "Insufficient sAED balance" });
      }
      fastify2.log.error({ error, orderId: order_id }, "Corridor match failed");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.patch("/corridor/fulfillments/:id", async (request, reply) => {
    const { id } = request.params;
    const { provider_status, actor_id } = request.body;
    if (provider_status !== "payment_sent") {
      return reply.status(400).send({ success: false, error: "Can only update to payment_sent" });
    }
    try {
      const result = await transaction3(async (client) => {
        const ffResult = await client.query(
          "SELECT * FROM corridor_fulfillments WHERE id = $1 FOR UPDATE",
          [id]
        );
        if (ffResult.rows.length === 0) throw new Error("NOT_FOUND");
        const ff = ffResult.rows[0];
        if (ff.provider_merchant_id !== actor_id) throw new Error("UNAUTHORIZED");
        if (ff.provider_status !== "pending") throw new Error("INVALID_STATUS");
        await client.query(
          `UPDATE corridor_fulfillments
           SET provider_status = 'payment_sent', payment_sent_at = NOW(), updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [id]
        );
        await client.query(
          `INSERT INTO notification_outbox
           (order_id, event_type, merchant_id, payload)
           VALUES ($1, 'CORRIDOR_PAYMENT_SENT', $2, $3)`,
          [ff.order_id, ff.provider_merchant_id, JSON.stringify({ fulfillment_id: id })]
        );
        logger9.info("[Corridor] LP marked payment sent", {
          fulfillmentId: id,
          orderId: ff.order_id,
          lpMerchantId: actor_id
        });
        return { id, provider_status: "payment_sent" };
      });
      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      const msg = error.message;
      if (msg === "NOT_FOUND") return reply.status(404).send({ success: false, error: "Fulfillment not found" });
      if (msg === "UNAUTHORIZED") return reply.status(403).send({ success: false, error: "Not your fulfillment" });
      if (msg === "INVALID_STATUS") return reply.status(400).send({ success: false, error: "Fulfillment not in pending status" });
      fastify2.log.error({ error, id }, "Corridor fulfillment update failed");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.get("/corridor/fulfillments", async (request, reply) => {
    const { provider_merchant_id } = request.query;
    if (!provider_merchant_id) {
      return reply.status(400).send({ success: false, error: "provider_merchant_id required" });
    }
    try {
      const rows = await transaction3(async (client) => {
        const result = await client.query(
          `SELECT cf.*, o.order_number, o.crypto_amount, o.fiat_currency,
                  m.display_name as seller_name
           FROM corridor_fulfillments cf
           JOIN orders o ON cf.order_id = o.id
           JOIN merchants m ON o.merchant_id = m.id
           WHERE cf.provider_merchant_id = $1
             AND cf.provider_status IN ('pending', 'payment_sent')
           ORDER BY cf.assigned_at DESC`,
          [provider_merchant_id]
        );
        return result.rows;
      });
      return reply.status(200).send({ success: true, data: rows });
    } catch (error) {
      fastify2.log.error({ error }, "Failed to fetch corridor fulfillments");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.get("/corridor/providers", async (request, reply) => {
    const { merchant_id } = request.query;
    if (!merchant_id) {
      return reply.status(400).send({ success: false, error: "merchant_id required" });
    }
    try {
      const rows = await transaction3(async (client) => {
        const result = await client.query(
          "SELECT * FROM corridor_providers WHERE merchant_id = $1",
          [merchant_id]
        );
        return result.rows;
      });
      return reply.status(200).send({ success: true, data: rows[0] || null });
    } catch (error) {
      fastify2.log.error({ error }, "Failed to fetch corridor provider");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.post("/corridor/providers", async (request, reply) => {
    const { merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept } = request.body;
    if (!merchant_id || fee_percentage == null || !min_amount || !max_amount) {
      return reply.status(400).send({ success: false, error: "Missing required fields" });
    }
    if (fee_percentage < 0 || fee_percentage > 10) {
      return reply.status(400).send({ success: false, error: "Fee must be 0-10%" });
    }
    try {
      const result = await transaction3(async (client) => {
        const row = await client.query(
          `INSERT INTO corridor_providers (merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (merchant_id) DO UPDATE SET
             is_active = $2, fee_percentage = $3, min_amount = $4, max_amount = $5,
             auto_accept = $6, updated_at = NOW()
           RETURNING *`,
          [merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept ?? true]
        );
        return row.rows[0];
      });
      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      fastify2.log.error({ error }, "Failed to upsert corridor provider");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
  fastify2.get("/corridor/availability", async (request, reply) => {
    const fiatAmount = parseFloat(request.query.fiat_amount);
    const excludeIds = request.query.exclude ? request.query.exclude.split(",") : [];
    if (!fiatAmount || fiatAmount <= 0) {
      return reply.status(400).send({ success: false, error: "Valid fiat_amount required" });
    }
    try {
      const result = await transaction3(async (client) => {
        const row = await client.query(
          `SELECT COUNT(*) as cnt, MIN(cp.fee_percentage) as min_fee
           FROM corridor_providers cp
           JOIN merchants m ON cp.merchant_id = m.id
           WHERE cp.is_active = true
             AND m.is_online = true
             AND m.status = 'active'
             AND cp.min_amount <= $1
             AND cp.max_amount >= $1
             AND ($2::uuid[] IS NULL OR cp.merchant_id != ALL($2::uuid[]))
             AND (cp.available_hours_start IS NULL
                  OR CURRENT_TIME BETWEEN cp.available_hours_start AND cp.available_hours_end)`,
          [fiatAmount, excludeIds.length > 0 ? excludeIds : null]
        );
        const cnt = parseInt(String(row.rows[0].cnt));
        return {
          available: cnt > 0,
          cheapest_fee: row.rows[0].min_fee ? parseFloat(String(row.rows[0].min_fee)) : null,
          provider_count: cnt
        };
      });
      return reply.status(200).send({ success: true, data: result });
    } catch (error) {
      fastify2.log.error({ error }, "Failed to check corridor availability");
      return reply.status(500).send({ success: false, error: "Internal server error" });
    }
  });
};

// src/hooks/auth.ts
import { createHmac, timingSafeEqual } from "crypto";
var authHook = async (fastify2) => {
  const secret = process.env.CORE_API_SECRET;
  if (!secret) {
    fastify2.log.warn("[Auth] CORE_API_SECRET not set -- auth disabled");
    return;
  }
  fastify2.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health" || request.url.startsWith("/debug")) return;
    const provided = request.headers["x-core-api-secret"];
    if (provided !== secret) {
      return reply.status(401).send({
        success: false,
        error: "Unauthorized: invalid or missing x-core-api-secret"
      });
    }
    const actorType = request.headers["x-actor-type"];
    const actorId = request.headers["x-actor-id"];
    const actorSignature = request.headers["x-actor-signature"];
    if (actorType && actorId) {
      if (!actorSignature) {
        return reply.status(401).send({
          success: false,
          error: "Unauthorized: missing actor signature"
        });
      }
      const expected = createHmac("sha256", secret).update(`${actorType}:${actorId}`).digest("hex");
      const expectedBuf = Buffer.from(expected, "hex");
      const providedBuf = Buffer.from(actorSignature, "hex");
      if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
        return reply.status(401).send({
          success: false,
          error: "Unauthorized: invalid actor signature"
        });
      }
    }
  });
};

// src/workers/notificationOutbox.ts
import { query as query3, logger as logger10 } from "settlement-core";
import { config as config2 } from "dotenv";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
config2({ path: "../../settle/.env.local" });
config2({ path: "../../settle/.env" });
var TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
var TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
var POLL_INTERVAL_MS = parseInt(process.env.OUTBOX_POLL_MS || "5000", 10);
var BATCH_SIZE = parseInt(process.env.OUTBOX_BATCH_SIZE || "50", 10);
var SUMMARY_INTERVAL_TICKS = Math.max(1, Math.round(3e4 / POLL_INTERVAL_MS));
var isRunning = false;
var pollTimer = null;
var tickCount = 0;
var totalProcessed = 0;
var consecutiveErrors = 0;
var MAX_BACKOFF_MS = 6e4;
async function sendTelegramNotification(merchantId, eventType, payload) {
  if (!TELEGRAM_BOT_TOKEN) {
    logger10.warn("[Telegram] Bot token not configured, skipping notification");
    return true;
  }
  try {
    const merchantResult = await query3(
      `SELECT telegram_chat_id FROM merchants WHERE id = $1`,
      [merchantId]
    );
    if (merchantResult.length === 0 || !merchantResult[0].telegram_chat_id) {
      logger10.info("[Telegram] No chat_id for merchant", { merchantId });
      return true;
    }
    const chatId = merchantResult[0].telegram_chat_id;
    let message = formatTelegramMessage(eventType, payload);
    const response = await fetch(`${TELEGRAM_API_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown",
        disable_web_page_preview: true
      })
    });
    const data = await response.json();
    if (!data.ok) {
      logger10.error("[Telegram] Failed to send message", {
        merchantId,
        chatId,
        error: data.description || "Unknown error"
      });
      return false;
    }
    logger10.info("[Telegram] Notification sent successfully", {
      merchantId,
      eventType,
      orderId: payload.orderId
    });
    return true;
  } catch (error) {
    logger10.error("[Telegram] Error sending notification", {
      merchantId,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
function formatTelegramMessage(eventType, payload) {
  const status = payload.status || payload.minimal_status || "updated";
  const orderId = payload.orderId || "Unknown";
  switch (eventType) {
    case "ORDER_ACCEPTED":
      return `\u2705 *Order Accepted*

Order #${orderId}
Status: ${status}

A merchant has accepted your order. Please proceed with payment.`;
    case "ORDER_PAYMENT_SENT":
      return `\u{1F4B8} *Payment Sent*

Order #${orderId}
Status: ${status}

The buyer has marked payment as sent. Please confirm receipt.`;
    case "ORDER_PAYMENT_CONFIRMED":
      return `\u2705 *Payment Confirmed*

Order #${orderId}
Status: ${status}

Payment has been confirmed. Release escrow to complete the order.`;
    case "ORDER_COMPLETED":
      return `\u{1F389} *Order Completed*

Order #${orderId}
Status: ${status}

The order has been successfully completed!`;
    case "ORDER_CANCELLED":
      return `\u274C *Order Cancelled*

Order #${orderId}
Status: ${status}

The order has been cancelled.`;
    case "ORDER_ESCROWED":
      return `\u{1F512} *Escrow Locked*

Order #${orderId}
Status: ${status}

Funds have been locked in escrow.`;
    default:
      return `\u{1F4E6} *Order Update*

Order #${orderId}
Status: ${status}

Your order has been updated.`;
  }
}
async function processOutboxRecord(record) {
  try {
    const statusCheck = await query3(
      "SELECT status FROM notification_outbox WHERE id = $1",
      [record.id]
    );
    if (statusCheck.length > 0 && statusCheck[0].status === "sent") {
      logger10.info("[Outbox] Skipping already-sent notification", {
        outboxId: record.id,
        orderId: record.order_id
      });
      return true;
    }
    const payload = typeof record.payload === "string" ? JSON.parse(record.payload) : record.payload;
    logger10.info("[Outbox] Notification delivered (inline WS broadcast)", {
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type
    });
    const telegramSuccess = await sendTelegramNotification(
      payload.merchantId,
      record.event_type,
      payload
    );
    if (!telegramSuccess) {
      logger10.warn("[Outbox] Telegram notification failed, but continuing", {
        outboxId: record.id,
        orderId: record.order_id
      });
    }
    logger10.info("[Outbox] Successfully processed notification", {
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type,
      attempts: record.attempts + 1,
      telegramSent: telegramSuccess
    });
    return true;
  } catch (error) {
    logger10.error("[Outbox] Failed to process notification", {
      errorCode: "OUTBOX_RECORD_ERROR",
      outboxId: record.id,
      orderId: record.order_id,
      eventType: record.event_type,
      attempts: record.attempts + 1,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}
async function processBatch() {
  try {
    const records = await query3(
      `SELECT * FROM notification_outbox
       WHERE status IN ('pending', 'failed')
       AND attempts < max_attempts
       AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '30 seconds')
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );
    if (records.length === 0) {
      consecutiveErrors = 0;
      writeHeartbeat(0);
      return;
    }
    logger10.info(`[Outbox] Processing ${records.length} pending notifications`);
    for (const record of records) {
      await query3(
        `UPDATE notification_outbox
         SET status = 'processing', last_attempt_at = NOW()
         WHERE id = $1`,
        [record.id]
      );
      const success = await processOutboxRecord(record);
      if (success) {
        await query3(
          `UPDATE notification_outbox
           SET status = 'sent', sent_at = NOW()
           WHERE id = $1`,
          [record.id]
        );
      } else {
        const newAttempts = record.attempts + 1;
        const newStatus = newAttempts >= record.max_attempts ? "failed" : "pending";
        const errorMsg = "Failed to send notification";
        await query3(
          `UPDATE notification_outbox
           SET status = $1, attempts = $2, last_error = $3, last_attempt_at = NOW()
           WHERE id = $4`,
          [newStatus, newAttempts, errorMsg, record.id]
        );
        if (newStatus === "failed") {
          logger10.error(
            "[Outbox] Notification permanently failed after max attempts",
            {
              errorCode: "OUTBOX_RECORD_ERROR",
              outboxId: record.id,
              orderId: record.order_id,
              eventType: record.event_type,
              attempts: newAttempts
            }
          );
        }
      }
    }
    totalProcessed += records.length;
    consecutiveErrors = 0;
    writeHeartbeat(records.length);
  } catch (error) {
    consecutiveErrors++;
    const backoff = Math.min(POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS);
    logger10.error("[Outbox] Error processing batch", {
      errorCode: "OUTBOX_BATCH_ERROR",
      consecutiveErrors,
      backoffMs: backoff,
      error: error instanceof Error ? error.message : String(error)
    });
    await new Promise((resolve) => setTimeout(resolve, backoff - POLL_INTERVAL_MS));
  }
}
function writeHeartbeat(batchSize) {
  try {
    writeFileSync("/tmp/bm-worker-outbox.json", JSON.stringify({
      lastRun: (/* @__PURE__ */ new Date()).toISOString(),
      totalProcessed,
      lastBatchSize: batchSize
    }));
  } catch {
  }
}
function startOutboxWorker() {
  if (isRunning) {
    logger10.warn("[Outbox] Worker already running");
    return;
  }
  isRunning = true;
  logger10.info("[Outbox] Starting notification outbox worker", {
    pollInterval: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE
  });
  const poll = async () => {
    if (!isRunning) return;
    await processBatch();
    tickCount++;
    if (tickCount % SUMMARY_INTERVAL_TICKS === 0) {
      try {
        const stats = await query3(
          `SELECT count(*)::text as count,
                  EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int::text as oldest_age_sec
           FROM notification_outbox
           WHERE status = 'pending'`
        );
        logger10.info("[Outbox] Summary", {
          totalProcessed,
          pending: parseInt(stats[0]?.count || "0", 10),
          oldestPendingAgeSec: stats[0]?.oldest_age_sec ? parseInt(stats[0].oldest_age_sec, 10) : null
        });
      } catch {
      }
    }
    pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
  };
  poll();
}
function stopOutboxWorker() {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger10.info("[Outbox] Stopped notification outbox worker");
}
async function cleanupSentNotifications() {
  try {
    const result = await query3(
      `DELETE FROM notification_outbox
       WHERE status = 'sent'
       AND sent_at < NOW() - INTERVAL '7 days'`,
      []
    );
    logger10.info("[Outbox] Cleaned up old sent notifications", {
      deleted: result.length
    });
  } catch (error) {
    logger10.error("[Outbox] Error cleaning up notifications", {
      errorCode: "OUTBOX_CLEANUP_ERROR",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
var __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startOutboxWorker();
  setInterval(cleanupSentNotifications, 60 * 60 * 1e3);
  process.on("SIGINT", () => {
    logger10.info("[Outbox] Received SIGINT, shutting down...");
    stopOutboxWorker();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    logger10.info("[Outbox] Received SIGTERM, shutting down...");
    stopOutboxWorker();
    process.exit(0);
  });
}

// src/workers/corridorTimeoutWorker.ts
import { transaction as transaction4, logger as logger11 } from "settlement-core";
var POLL_INTERVAL_MS2 = parseInt(process.env.CORRIDOR_POLL_MS || "60000", 10);
var isRunning2 = false;
var pollTimer2 = null;
async function processOverdueFulfillments() {
  try {
    const count = await transaction4(async (client) => {
      const result = await client.query(
        `SELECT cf.*, o.buyer_merchant_id
         FROM corridor_fulfillments cf
         JOIN orders o ON cf.order_id = o.id
         WHERE cf.provider_status = 'pending'
           AND cf.send_deadline < NOW()
         FOR UPDATE OF cf
         LIMIT 10`
      );
      if (result.rows.length === 0) return 0;
      let processed = 0;
      for (const row of result.rows) {
        const ff = row;
        const fulfillmentId = ff.id;
        const orderId = ff.order_id;
        const providerMerchantId = ff.provider_merchant_id;
        const buyerMerchantId = ff.buyer_merchant_id;
        const saedAmount = parseInt(String(ff.saed_amount_locked));
        await client.query(
          `UPDATE corridor_fulfillments
           SET provider_status = 'failed', failed_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [fulfillmentId]
        );
        if (buyerMerchantId && saedAmount > 0) {
          await client.query(
            "UPDATE merchants SET sinr_balance = sinr_balance + $1 WHERE id = $2",
            [saedAmount, buyerMerchantId]
          );
          await client.query(
            `INSERT INTO ledger_entries
             (account_type, account_id, entry_type, amount, asset,
              related_order_id, description, metadata, balance_before, balance_after)
             SELECT 'merchant', $1, 'CORRIDOR_SAED_TRANSFER', $2, 'sAED', $3,
                    'Corridor timeout sAED refund: ' || $2 || ' fils',
                    $4::jsonb, sinr_balance - $2, sinr_balance
             FROM merchants WHERE id = $1`,
            [
              buyerMerchantId,
              saedAmount,
              orderId,
              JSON.stringify({ refund: true, reason: "LP_TIMEOUT" })
            ]
          );
        }
        await client.query(
          `UPDATE orders
           SET payment_via = 'bank', corridor_fulfillment_id = NULL
           WHERE id = $1 AND corridor_fulfillment_id = $2`,
          [orderId, fulfillmentId]
        );
        await client.query(
          `INSERT INTO notification_outbox
           (order_id, event_type, merchant_id, payload)
           VALUES ($1, 'CORRIDOR_TIMEOUT', $2, $3)`,
          [
            orderId,
            providerMerchantId,
            JSON.stringify({
              fulfillment_id: fulfillmentId,
              reason: "LP failed to send payment before deadline"
            })
          ]
        );
        logger11.info("[CorridorTimeout] Fulfillment timed out, sAED refunded", {
          fulfillmentId,
          orderId,
          providerMerchantId,
          buyerMerchantId,
          saedAmount
        });
        processed++;
      }
      return processed;
    });
    return count;
  } catch (error) {
    logger11.error("[CorridorTimeout] Error processing overdue fulfillments", { error });
    return 0;
  }
}
async function tick() {
  if (!isRunning2) return;
  const count = await processOverdueFulfillments();
  if (count > 0) {
    logger11.info(`[CorridorTimeout] Processed ${count} overdue fulfillments`);
  }
  if (isRunning2) {
    pollTimer2 = setTimeout(tick, POLL_INTERVAL_MS2);
  }
}
function startCorridorTimeoutWorker() {
  if (isRunning2) return;
  isRunning2 = true;
  logger11.info(`[CorridorTimeout] Worker started (poll every ${POLL_INTERVAL_MS2}ms)`);
  pollTimer2 = setTimeout(tick, 5e3);
}
function stopCorridorTimeoutWorker() {
  isRunning2 = false;
  if (pollTimer2) {
    clearTimeout(pollTimer2);
    pollTimer2 = null;
  }
  logger11.info("[CorridorTimeout] Worker stopped");
}

// src/workers/autoBumpWorker.ts
import { query as dbQuery6, logger as logger12 } from "settlement-core";
import { writeFileSync as writeFileSync2 } from "fs";
var POLL_INTERVAL_MS3 = parseInt(process.env.AUTO_BUMP_POLL_MS || "10000", 10);
var isRunning3 = false;
var pollTimer3 = null;
var totalBumps = 0;
async function processAutoBumps() {
  try {
    const orders = await dbQuery6(
      `SELECT id, premium_bps_current, premium_bps_cap, bump_step_bps, bump_interval_sec
       FROM orders
       WHERE auto_bump_enabled = TRUE
         AND status = 'pending'
         AND next_bump_at IS NOT NULL
         AND next_bump_at <= NOW()
         AND premium_bps_current < premium_bps_cap`,
      []
    );
    if (orders.length === 0) return;
    for (const order of orders) {
      try {
        const newPremium = Math.min(
          order.premium_bps_current + order.bump_step_bps,
          order.premium_bps_cap
        );
        const maxReached = newPremium >= order.premium_bps_cap;
        const nextBumpAt = !maxReached ? new Date(Date.now() + order.bump_interval_sec * 1e3).toISOString() : null;
        await dbQuery6(
          `UPDATE orders
           SET premium_bps_current = $1,
               next_bump_at = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [newPremium, nextBumpAt, order.id]
        );
        totalBumps++;
        logger12.info("[AutoBump] Order bumped", {
          orderId: order.id,
          oldBps: order.premium_bps_current,
          newBps: newPremium,
          maxReached
        });
        broadcastOrderEvent({
          event_type: "ORDER_BUMPED",
          order_id: order.id,
          status: "pending",
          minimal_status: "pending",
          order_version: 0,
          premium_bps_current: newPremium,
          max_reached: maxReached
        });
      } catch (err) {
        logger12.error("[AutoBump] Failed to bump order", {
          orderId: order.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    writeHeartbeat2(orders.length);
  } catch (err) {
    logger12.error("[AutoBump] Worker error", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
function writeHeartbeat2(batchSize) {
  try {
    writeFileSync2("/tmp/bm-worker-autobump.json", JSON.stringify({
      lastRun: (/* @__PURE__ */ new Date()).toISOString(),
      totalBumps,
      lastBatchSize: batchSize
    }));
  } catch {
  }
}
function startAutoBumpWorker() {
  if (isRunning3) return;
  isRunning3 = true;
  logger12.info("[AutoBump] Starting auto-bump worker", { pollInterval: POLL_INTERVAL_MS3 });
  const poll = async () => {
    if (!isRunning3) return;
    await processAutoBumps();
    pollTimer3 = setTimeout(poll, POLL_INTERVAL_MS3);
  };
  poll();
}
function stopAutoBumpWorker() {
  isRunning3 = false;
  if (pollTimer3) {
    clearTimeout(pollTimer3);
    pollTimer3 = null;
  }
  logger12.info("[AutoBump] Stopped auto-bump worker");
}

// src/index.ts
var PORT = parseInt(process.env.CORE_API_PORT || "4010", 10);
var HOST = process.env.CORE_API_HOST || "0.0.0.0";
var IS_WORKER = process.env.WORKER_ID !== void 0;
var fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "warn"
  }
});
await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  credentials: true
});
await fastify.register(authHook);
await fastify.register(healthRoutes);
await fastify.register(orderRoutes, { prefix: "/v1" });
await fastify.register(orderCreateRoutes, { prefix: "/v1" });
await fastify.register(escrowRoutes, { prefix: "/v1" });
await fastify.register(extensionRoutes, { prefix: "/v1" });
await fastify.register(disputeRoutes, { prefix: "/v1" });
await fastify.register(expireRoutes, { prefix: "/v1" });
await fastify.register(conversionRoutes, { prefix: "/v1" });
await fastify.register(corridorRoutes, { prefix: "/v1" });
await fastify.register(debugRoutes);
try {
  await fastify.listen({ port: PORT, host: HOST });
  console.log(`Core API [${IS_WORKER ? "worker " + process.env.WORKER_ID : "standalone"}] running on http://${HOST}:${PORT}`);
  if (!IS_WORKER) {
    initWebSocketServer(fastify.server);
    startOutboxWorker();
    startCorridorTimeoutWorker();
    startAutoBumpWorker();
  }
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
var shutdown = async (signal) => {
  if (!IS_WORKER) {
    stopOutboxWorker();
    stopCorridorTimeoutWorker();
    stopAutoBumpWorker();
    closeWebSocketServer();
  }
  await fastify.close();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
