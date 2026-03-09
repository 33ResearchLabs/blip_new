/**
 * Shared state: config, Maps, session persistence, dedup helpers
 */
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const API_BASE = process.env.API_BASE || (process.env.SETTLE_URL ? `${process.env.SETTLE_URL}/api` : 'http://localhost:3000/api');
const MOCK_MODE = process.env.MOCK_MODE === 'true';
const PUSHER_KEY = process.env.PUSHER_KEY || 'c3b9bd6d14b59c3d14d4';
const PUSHER_CLUSTER = process.env.PUSHER_CLUSTER || 'ap2';

// ─── In-memory state ─────────────────────────────────────────────────────────
const sessions = new Map();          // telegramId -> { merchantId, username, email, ... }
const pendingSignups = new Map();    // telegramId -> { step, data }
const pendingActions = new Map();    // telegramId -> { action, step, orderId?, ... }
const pusherConnections = new Map(); // telegramId -> { pusher, channels }
const orderSubscriptions = new Map(); // telegramId -> Map<orderId, pusherChannel>
const merchantToTelegram = new Map(); // merchantId -> telegramId (reverse lookup)

// ─── Session persistence ─────────────────────────────────────────────────────
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const [telegramId, session] of Object.entries(data)) {
        const tid = Number(telegramId);
        sessions.set(tid, session);
        merchantToTelegram.set(session.merchantId, tid);
      }
      console.log(`Loaded ${Object.keys(data).length} saved sessions`);
    }
  } catch (e) {
    console.error('Failed to load sessions:', e.message);
  }
}

function saveSessions() {
  try {
    const data = {};
    for (const [telegramId, session] of sessions) {
      data[telegramId] = session;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save sessions:', e.message);
  }
}

// ─── Notification dedup ──────────────────────────────────────────────────────
const recentOwnActions = new Map();

function markOwnAction(merchantId, orderId, status) {
  recentOwnActions.set(`${merchantId}:${orderId}:${status}`, Date.now());
  if (recentOwnActions.size > 100) {
    const now = Date.now();
    for (const [k, t] of recentOwnActions) {
      if (now - t > 30000) recentOwnActions.delete(k);
    }
  }
}

function isOwnAction(merchantId, orderId, status) {
  const t = recentOwnActions.get(`${merchantId}:${orderId}:${status}`);
  return t && Date.now() - t < 15000;
}

const recentNotifications = new Map();

function isDuplicateNotification(telegramId, orderId, status) {
  const key = `${telegramId}:${orderId}:${status}`;
  const now = Date.now();
  const lastSeen = recentNotifications.get(key);
  if (lastSeen && now - lastSeen < 5000) {
    console.log(`[Pusher] Skipping duplicate notification: ${key}`);
    return true;
  }
  recentNotifications.set(key, now);
  if (recentNotifications.size > 200) {
    for (const [k, t] of recentNotifications) {
      if (now - t > 10000) recentNotifications.delete(k);
    }
  }
  return false;
}

// Load on require
loadSessions();

module.exports = {
  API_BASE, MOCK_MODE, PUSHER_KEY, PUSHER_CLUSTER,
  sessions, pendingSignups, pendingActions,
  pusherConnections, orderSubscriptions, merchantToTelegram,
  loadSessions, saveSessions,
  recentOwnActions, markOwnAction, isOwnAction,
  recentNotifications, isDuplicateNotification,
};
