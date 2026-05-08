"use client";

// Browser-level attention helpers for urgent merchant warnings.
//
// Two channels:
//  1. Tab-title flash — sets `document.title` to "(N) ⚠ <text>" while the
//     tab is hidden and at least one urgent warning is unacknowledged. The
//     original title is restored when count drops to 0 or the tab regains
//     focus. Requires no permission.
//  2. Browser Notifications API — fires an OS-level notification when the
//     tab is hidden and permission has been granted. Permission is requested
//     lazily on the first urgent fire. Falls through silently when denied
//     or unsupported, so this layer never breaks the in-app experience.
//
// Everything below is best-effort: every DOM / API access is guarded so a
// non-browser env (SSR, tests, headless) or a permission rejection cannot
// throw. Zero behavioral impact when these features are unavailable.

let originalTitle: string | null = null;
let isFlashingTitle = false;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function captureOriginalTitle(): void {
  if (!isBrowser() || originalTitle !== null) return;
  originalTitle = document.title;
}

export function flashTabTitle(count: number, text: string): void {
  if (!isBrowser()) return;
  // Only flash when the tab is hidden — flashing while the user is looking
  // at the tab is annoying and the in-app toast already grabs attention.
  if (!document.hidden) {
    restoreTabTitle();
    return;
  }
  captureOriginalTitle();
  try {
    const next = `(${count}) ⚠ ${text}`;
    if (document.title !== next) document.title = next;
    isFlashingTitle = true;
  } catch {
    // Some embedded contexts disallow title writes — ignore.
  }
}

export function restoreTabTitle(): void {
  if (!isBrowser() || !isFlashingTitle || originalTitle === null) return;
  try {
    document.title = originalTitle;
  } catch {
    // ignore
  }
  isFlashingTitle = false;
}

// Browser Notifications API — guarded for non-secure / unsupported contexts.
// Returns the current permission state without prompting.
export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!isBrowser() || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

// Request permission. Safe to call multiple times — browsers cache the
// answer after the first prompt. Returns the resolved permission.
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isBrowser() || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

interface OSNotificationOptions {
  body?: string;
  tag?: string;
  onClick?: () => void;
}

// Fires an OS notification. Silently no-ops when:
//  - Not in a browser env
//  - Notifications API unsupported
//  - Permission not granted
//  - Tab is currently visible (in-app toast already covers it)
export function showOSNotification(title: string, opts?: OSNotificationOptions): void {
  if (!isBrowser() || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const n = new Notification(title, {
      body: opts?.body,
      tag: opts?.tag, // dedupe — re-firing same tag replaces prior notif
      silent: false,
    });
    if (opts?.onClick) {
      n.onclick = () => {
        try {
          window.focus();
          opts.onClick?.();
        } catch {
          // ignore
        } finally {
          n.close();
        }
      };
    }
  } catch {
    // ignore — don't let an OS-level failure break the in-app path
  }
}
