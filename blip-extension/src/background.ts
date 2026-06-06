/**
 * Background service worker for Blip extension.
 *
 * Responsibilities:
 * 1. Proactive token refresh (alarm every 12 min)
 * 2. Order status polling (alarm every 30s when popup is closed)
 * 3. Desktop notifications for order events
 */

import { getAuth, setAuth, getRefreshToken, isTokenFresh, type StoredAuth } from "./lib/auth";
import { apiFetch } from "./lib/api";

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshToken(): Promise<boolean> {
  const auth = await getAuth();
  if (!auth) return false;
  if (isTokenFresh(auth)) return true;

  const refreshTk = await getRefreshToken();
  if (!refreshTk) return false;

  try {
    const res = await apiFetch("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshTk }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const newToken = data?.data?.access_token;
    if (!newToken) return false;

    await setAuth({ ...auth, accessToken: newToken, expiresAt: Date.now() + 14 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

// ── Order polling ─────────────────────────────────────────────────────────────

interface StoredOrderState {
  [orderId: string]: string; // orderId → last known status
}

async function getOrderState(): Promise<StoredOrderState> {
  return new Promise((resolve) => {
    chrome.storage.session.get("blip_order_state", (r) => resolve(r.blip_order_state ?? {}));
  });
}

async function setOrderState(state: StoredOrderState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ blip_order_state: state }, resolve);
  });
}

async function pollOrders() {
  const auth = await getAuth();
  if (!auth) return;

  await refreshToken();

  try {
    const res = await apiFetch(
      `/api/orders?userId=${auth.userId}&status=active&limit=5`,
      {},
      auth.accessToken,
    );
    if (!res.ok) return;
    const data = await res.json();
    const orders: Array<{ id: string; status: string; type: string; amount: string }> = data?.data ?? [];

    const prevState = await getOrderState();
    const nextState: StoredOrderState = {};

    for (const order of orders) {
      nextState[order.id] = order.status;
      const prev = prevState[order.id];

      if (prev && prev !== order.status) {
        notifyStatusChange(order.id, order.type, order.amount, prev, order.status);
      }
    }

    await setOrderState(nextState);
  } catch {
    // swallow — polling is best-effort
  }
}

function notifyStatusChange(id: string, type: string, amount: string, from: string, to: string) {
  const USDT = parseFloat(amount || "0").toFixed(2);
  const dir = type === "buy" ? "Buy" : "Sell";

  const messages: Record<string, string> = {
    accepted: `${dir} ${USDT} USDT matched with a merchant`,
    escrowed: `Crypto locked in escrow — next step: payment`,
    payment_sent: `Payment marked as sent`,
    complete: `${dir} ${USDT} USDT complete! 🎉`,
    completed: `${dir} ${USDT} USDT complete! 🎉`,
    disputed: `A dispute was opened on your order`,
    cancelled: `Order cancelled`,
  };

  const msg = messages[to];
  if (!msg) return;

  chrome.notifications.create(`order-${id}-${to}`, {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: "Blip · Order Update",
    message: msg,
    priority: to === "complete" || to === "completed" ? 2 : 1,
  });
}

// ── Alarm setup ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refresh-token", { periodInMinutes: 12 });
  chrome.alarms.create("poll-orders", { periodInMinutes: 0.5 }); // every 30s
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refresh-token") refreshToken();
  if (alarm.name === "poll-orders") pollOrders();
});

// Notification click → open extension popup
chrome.notifications.onClicked.addListener(() => {
  chrome.action.openPopup?.();
});

// Kick off initial poll
pollOrders();
