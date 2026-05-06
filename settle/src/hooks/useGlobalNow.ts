"use client";

import { useSyncExternalStore } from "react";

/**
 * Single shared 1-second tick for ALL countdown components.
 *
 * Before: every <OrderExpiryTimer /> and <ExpiryProgressBar /> created its
 * own setInterval(1000), causing N timers + N setState calls per second when
 * N orders were visible. With 5 orders that's 5 re-renders/sec = visible jank.
 *
 * After: ONE setInterval at module scope, ONE timestamp value, all consumers
 * subscribe via useSyncExternalStore (identical re-render cadence — no
 * behavior change, just shared state).
 *
 * The interval auto-stops when nobody is subscribed.
 */

let now = Date.now();
const subscribers = new Set<() => void>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function start(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    now = Date.now();
    for (const cb of subscribers) cb();
  }, 1000);
}

function stop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  start();
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0) stop();
  };
}

function getSnapshot(): number {
  return now;
}

function getServerSnapshot(): number {
  // SSR: stable seed; client will hydrate to live value on first tick.
  return 0;
}

/**
 * Returns the current shared timestamp, refreshed once per second.
 * Drop-in replacement for `const [now, setNow] = useState(Date.now()) +
 * setInterval(setNow, 1000)`.
 */
export function useGlobalNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
