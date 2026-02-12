/**
 * WebSocket Server Handlers
 *
 * Handles real-time chat messaging via native WebSocket
 */

const { Pool } = require('pg');
const url = require('url');

// Connection pool for database
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'settle',
      user: process.env.DB_USER || undefined,
      password: process.env.DB_PASSWORD || undefined,
    };
const pool = new Pool(poolConfig);

// Room management - maps orderId to Set of WebSocket connections
const orderRooms = new Map();
// Client info - maps WebSocket to client metadata
const clientInfo = new Map();

// Error codes
const WS_ERROR_CODES = {
  AUTH_FAILED: 4001,
  INVALID_MESSAGE: 4002,
  ORDER_ACCESS_DENIED: 4003,
  RATE_LIMITED: 4004,
  SERVER_ERROR: 4005,
};

// Rate limiting for WebSocket messages
const messageRateLimits = new Map(); // actorId -> { count, resetAt }
const RATE_LIMIT_MAX_MESSAGES = 30; // 30 messages per window
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window

/**
 * Check rate limit for an actor
 * Returns true if within limit, false if exceeded
 */
function checkMessageRateLimit(actorId) {
  const now = Date.now();
  let entry = messageRateLimits.get(actorId);

  if (!entry || entry.resetAt < now) {
    // Create new window
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    messageRateLimits.set(actorId, entry);
    return true;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_MESSAGES) {
    return false;
  }

  return true;
}

// Cleanup rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [actorId, entry] of messageRateLimits.entries()) {
    if (entry.resetAt < now) {
      messageRateLimits.delete(actorId);
    }
  }
}, 5 * 60 * 1000);

/**
 * Verify user exists in database
 */
async function verifyUser(userId) {
  try {
    const result = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying user:', error);
    return false;
  }
}

/**
 * Verify merchant exists and is active
 */
async function verifyMerchant(merchantId) {
  try {
    const result = await pool.query(
      "SELECT id FROM merchants WHERE id = $1 AND status = 'active'",
      [merchantId]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error verifying merchant:', error);
    return false;
  }
}

/**
 * Check if actor can access order
 */
async function canAccessOrder(actorType, actorId, orderId) {
  try {
    const result = await pool.query('SELECT user_id, merchant_id, buyer_merchant_id FROM orders WHERE id = $1', [
      orderId,
    ]);
    if (result.rows.length === 0) return false;

    const order = result.rows[0];
    if (actorType === 'user') return order.user_id === actorId;
    if (actorType === 'merchant') return order.merchant_id === actorId || order.buyer_merchant_id === actorId;
    if (actorType === 'compliance' || actorType === 'system') return true;

    return false;
  } catch (error) {
    console.error('Error checking order access:', error);
    return false;
  }
}

/**
 * Save message to database
 */
async function saveMessage(orderId, senderType, senderId, content, messageType, imageUrl) {
  try {
    const result = await pool.query(
      `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orderId, senderType, senderId, content, messageType || 'text', imageUrl || null]
    );
    return result.rows[0];
  } catch (error) {
    console.error('Error saving message:', error);
    return null;
  }
}

/**
 * Mark messages as read
 */
async function markMessagesRead(orderId, readerType) {
  try {
    await pool.query(
      `UPDATE chat_messages
       SET is_read = true, read_at = NOW()
       WHERE order_id = $1 AND sender_type != $2 AND is_read = false`,
      [orderId, readerType]
    );
    return true;
  } catch (error) {
    console.error('Error marking messages read:', error);
    return false;
  }
}

/**
 * Get sender name from database
 */
async function getSenderName(senderType, senderId) {
  try {
    if (senderType === 'user') {
      const result = await pool.query('SELECT username FROM users WHERE id = $1', [senderId]);
      return result.rows[0]?.username || 'User';
    }
    if (senderType === 'merchant') {
      const result = await pool.query('SELECT display_name FROM merchants WHERE id = $1', [
        senderId,
      ]);
      return result.rows[0]?.display_name || 'Merchant';
    }
    if (senderType === 'compliance') {
      // Gracefully handle missing compliance_team table
      try {
        const result = await pool.query('SELECT name FROM compliance_team WHERE id = $1', [senderId]);
        return result.rows[0]?.name || 'Compliance Officer';
      } catch (complianceError) {
        // Table may not exist yet - return default name
        console.warn('compliance_team table query failed, using default name');
        return 'Compliance Officer';
      }
    }
    return 'System';
  } catch (error) {
    console.error('Error getting sender name:', error);
    return senderType === 'user' ? 'User' : senderType === 'merchant' ? 'Merchant' : 'System';
  }
}

/**
 * Send message to a WebSocket client
 */
function sendToClient(ws, message) {
  if (ws.readyState === 1) {
    // WebSocket.OPEN
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast to all clients in an order room
 */
function broadcastToOrder(orderId, message, excludeWs = null) {
  const room = orderRooms.get(orderId);
  if (!room) return;

  const data = JSON.stringify(message);
  for (const client of room) {
    if (client !== excludeWs && client.readyState === 1) {
      client.send(data);
    }
  }
}

/**
 * Subscribe client to an order room
 */
function subscribeToOrder(ws, orderId) {
  if (!orderRooms.has(orderId)) {
    orderRooms.set(orderId, new Set());
  }
  orderRooms.get(orderId).add(ws);

  const info = clientInfo.get(ws);
  if (info) {
    info.subscribedOrders.add(orderId);
  }
}

/**
 * Unsubscribe client from an order room
 */
function unsubscribeFromOrder(ws, orderId) {
  const room = orderRooms.get(orderId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) {
      orderRooms.delete(orderId);
    }
  }

  const info = clientInfo.get(ws);
  if (info) {
    info.subscribedOrders.delete(orderId);
  }
}

/**
 * Handle incoming WebSocket message
 */
async function handleMessage(ws, rawData) {
  const info = clientInfo.get(ws);
  if (!info) {
    sendToClient(ws, { type: 'error', code: WS_ERROR_CODES.AUTH_FAILED, message: 'Not authenticated' });
    return;
  }

  let message;
  try {
    message = JSON.parse(rawData.toString());
  } catch {
    sendToClient(ws, { type: 'error', code: WS_ERROR_CODES.INVALID_MESSAGE, message: 'Invalid JSON' });
    return;
  }

  const { type } = message;

  switch (type) {
    case 'ping':
      info.lastPing = Date.now();
      sendToClient(ws, { type: 'pong', timestamp: new Date().toISOString() });
      break;

    case 'chat:subscribe': {
      const { orderId } = message;
      if (!orderId) {
        sendToClient(ws, {
          type: 'chat:subscribed',
          orderId,
          success: false,
          error: 'Missing orderId',
        });
        return;
      }

      const canAccess = await canAccessOrder(info.actorType, info.actorId, orderId);
      if (!canAccess) {
        sendToClient(ws, {
          type: 'chat:subscribed',
          orderId,
          success: false,
          error: 'Access denied',
        });
        return;
      }

      subscribeToOrder(ws, orderId);
      sendToClient(ws, {
        type: 'chat:subscribed',
        orderId,
        success: true,
        timestamp: new Date().toISOString(),
      });
      break;
    }

    case 'chat:unsubscribe': {
      const { orderId } = message;
      if (orderId) {
        unsubscribeFromOrder(ws, orderId);
        sendToClient(ws, {
          type: 'chat:unsubscribed',
          orderId,
          timestamp: new Date().toISOString(),
        });
      }
      break;
    }

    case 'chat:send': {
      const { orderId, content, messageType, imageUrl } = message;
      if (!orderId || !content) {
        sendToClient(ws, { type: 'error', code: WS_ERROR_CODES.INVALID_MESSAGE, message: 'Missing orderId or content' });
        return;
      }

      // Rate limit check
      if (!checkMessageRateLimit(info.actorId)) {
        sendToClient(ws, {
          type: 'error',
          code: WS_ERROR_CODES.RATE_LIMITED,
          message: 'Too many messages. Please wait before sending more.',
        });
        return;
      }

      // Verify still has access
      if (!info.subscribedOrders.has(orderId)) {
        sendToClient(ws, { type: 'error', code: WS_ERROR_CODES.ORDER_ACCESS_DENIED, message: 'Not subscribed to this order' });
        return;
      }

      // Save to database
      const savedMessage = await saveMessage(
        orderId,
        info.actorType,
        info.actorId,
        content,
        messageType || 'text',
        imageUrl
      );

      if (!savedMessage) {
        sendToClient(ws, { type: 'error', code: WS_ERROR_CODES.SERVER_ERROR, message: 'Failed to save message' });
        return;
      }

      // Get sender name
      const senderName = await getSenderName(info.actorType, info.actorId);

      // Broadcast to all clients in room
      const newMessageEvent = {
        type: 'chat:message-new',
        timestamp: new Date().toISOString(),
        data: {
          messageId: savedMessage.id,
          orderId,
          senderType: info.actorType,
          senderId: info.actorId,
          senderName,
          content,
          messageType: messageType || 'text',
          imageUrl: imageUrl || null,
          createdAt: savedMessage.created_at,
        },
      };

      broadcastToOrder(orderId, newMessageEvent);
      break;
    }

    case 'chat:typing': {
      const { orderId, isTyping } = message;
      if (!orderId) return;

      if (!info.subscribedOrders.has(orderId)) return;

      const typingEvent = {
        type: isTyping ? 'chat:typing-start' : 'chat:typing-stop',
        timestamp: new Date().toISOString(),
        data: {
          orderId,
          actorType: info.actorType,
        },
      };

      broadcastToOrder(orderId, typingEvent, ws); // Exclude sender
      break;
    }

    case 'chat:mark-read': {
      const { orderId } = message;
      if (!orderId) return;

      if (!info.subscribedOrders.has(orderId)) return;

      const success = await markMessagesRead(orderId, info.actorType);
      if (success) {
        const readEvent = {
          type: 'chat:messages-read',
          timestamp: new Date().toISOString(),
          data: {
            orderId,
            readerType: info.actorType,
            readAt: new Date().toISOString(),
          },
        };

        broadcastToOrder(orderId, readEvent, ws);
      }
      break;
    }

    default:
      sendToClient(ws, { type: 'error', code: WS_ERROR_CODES.INVALID_MESSAGE, message: `Unknown message type: ${type}` });
  }
}

/**
 * Handle new WebSocket connection
 */
async function handleConnection(ws, request, wss) {
  const parsedUrl = url.parse(request.url, true);
  const { actorType, actorId } = parsedUrl.query;

  // Validate required params
  if (!actorType || !actorId) {
    ws.close(WS_ERROR_CODES.AUTH_FAILED, 'Missing actorType or actorId');
    return;
  }

  // Verify actor exists
  let isValid = false;
  if (actorType === 'user') {
    isValid = await verifyUser(actorId);
  } else if (actorType === 'merchant') {
    isValid = await verifyMerchant(actorId);
  } else if (actorType === 'compliance' || actorType === 'system') {
    isValid = true; // Trust system/compliance actors
  }

  if (!isValid) {
    ws.close(WS_ERROR_CODES.AUTH_FAILED, 'Invalid actor');
    return;
  }

  // Generate connection ID
  const connectionId = `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Store client info
  clientInfo.set(ws, {
    actorType,
    actorId,
    connectionId,
    subscribedOrders: new Set(),
    lastPing: Date.now(),
  });

  // Send connected message
  sendToClient(ws, {
    type: 'connected',
    connectionId,
    timestamp: new Date().toISOString(),
  });

  console.log(`WebSocket connected: ${actorType}:${actorId} (${connectionId})`);

  // Handle messages
  ws.on('message', (data) => handleMessage(ws, data));

  // Handle close
  ws.on('close', () => {
    const info = clientInfo.get(ws);
    if (info) {
      // Unsubscribe from all rooms
      for (const orderId of info.subscribedOrders) {
        unsubscribeFromOrder(ws, orderId);
      }
      clientInfo.delete(ws);
      console.log(`WebSocket disconnected: ${info.actorType}:${info.actorId} (${info.connectionId})`);
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
}

/**
 * Heartbeat interval to clean up dead connections
 */
function startHeartbeat(wss, interval = 30000) {
  setInterval(() => {
    const now = Date.now();
    wss.clients.forEach((ws) => {
      const info = clientInfo.get(ws);
      if (info && now - info.lastPing > interval * 2) {
        // Connection is dead, terminate
        console.log(`Terminating stale connection: ${info.connectionId}`);
        ws.terminate();
      }
    });
  }, interval);
}

/**
 * Broadcast a message to an order room (called from external, e.g., API routes)
 * This is exported for use by other parts of the application
 */
function broadcastToOrderExternal(orderId, message) {
  broadcastToOrder(orderId, message);
}

module.exports = {
  handleConnection,
  startHeartbeat,
  broadcastToOrder: broadcastToOrderExternal,
  orderRooms,
  clientInfo,
};
