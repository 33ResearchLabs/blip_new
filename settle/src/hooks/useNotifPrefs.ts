'use client';

import { useEffect, useState } from 'react';

// Mirror of the shape persisted by merchant/settings/page.tsx into
// localStorage under `blip_notif_settings`. Defaults intentionally all
// true so missing localStorage = unchanged behavior for users who never
// opened the notification settings.
export interface NotifPrefs {
  sound: boolean;
  orderAlerts: boolean;
  chatMessages: boolean;
  systemUpdates: boolean;
}

const STORAGE_KEY = 'blip_notif_settings';

const DEFAULTS: NotifPrefs = {
  sound: true,
  orderAlerts: true,
  chatMessages: true,
  systemUpdates: true,
};

function readPrefs(): NotifPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<NotifPrefs>;
    return {
      sound: typeof parsed.sound === 'boolean' ? parsed.sound : DEFAULTS.sound,
      orderAlerts:
        typeof parsed.orderAlerts === 'boolean'
          ? parsed.orderAlerts
          : DEFAULTS.orderAlerts,
      chatMessages:
        typeof parsed.chatMessages === 'boolean'
          ? parsed.chatMessages
          : DEFAULTS.chatMessages,
      systemUpdates:
        typeof parsed.systemUpdates === 'boolean'
          ? parsed.systemUpdates
          : DEFAULTS.systemUpdates,
    };
  } catch {
    return DEFAULTS;
  }
}

// Sync reader for use inside event handlers / effects where pulling React
// state via the hook would force a re-render. Reads fresh from localStorage
// on every call so a Save in the settings page is honored immediately.
export function getNotifPrefs(): NotifPrefs {
  return readPrefs();
}

// React hook with cross-tab sync via the `storage` event. Use this when a
// component needs to reactively re-render on pref changes (e.g. showing
// muted/unmuted UI). For one-off gate checks inside a handler, prefer
// `getNotifPrefs()`.
export function useNotifPrefs(): NotifPrefs {
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULTS);
  useEffect(() => {
    setPrefs(readPrefs());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(readPrefs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  return prefs;
}
