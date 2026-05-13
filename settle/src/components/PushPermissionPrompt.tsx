"use client";

/**
 * PushPermissionPrompt
 * ────────────────────
 * Shown after the user signs in for the first time and hasn't been asked
 * about push notifications yet. Educates briefly, then triggers the OS
 * permission dialog and subscribes the device via /api/user/push/subscribe.
 *
 * Suppressed forever (per browser) after either decision:
 *   - localStorage flag `blip_push_prompted_at` is set on every shown
 *   - OS Notification.permission already in 'granted' / 'denied' → don't ask
 *
 * Safe to mount once at the top of authed routes. No-ops when:
 *   - serviceWorker / PushManager / Notification APIs unavailable
 *   - NEXT_PUBLIC_VAPID_PUBLIC_KEY env unset
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, Zap } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

const STORAGE_KEY = "blip_push_prompted_at";
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

interface Props {
  /** Whether the user is signed in. Prompt only shows when true. */
  authed: boolean;
}

export function PushPermissionPrompt({ authed }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!authed) return;
    // Browser support gates.
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!("PushManager" in window)) return;
    if (!("Notification" in window)) return;
    if (!VAPID_PUBLIC_KEY) return;

    // Already asked (granted, denied, or dismissed) → don't ask again.
    if (Notification.permission !== "default") return;
    if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) return;

    // Small delay so it doesn't fight with the post-login render.
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [authed]);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* */ }
    setOpen(false);
  };

  const subscribe = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw-install.js", { scope: "/" });
      // Make sure the SW is active before subscribing.
      const readyReg = await navigator.serviceWorker.ready;
      const sub = await (reg.pushManager || readyReg.pushManager).subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const raw = sub.toJSON();
      await fetchWithAuth("/api/user/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      });
    } catch {
      // User denied or push service unreachable. Either way, don't re-ask.
    } finally {
      try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* */ }
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[148] bg-black/65"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismiss}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-[149] bg-[#0B0F14] text-white rounded-t-3xl border-t border-white/10 shadow-2xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
          >
            <div className="mx-auto max-w-[440px] px-5 py-5 pb-[max(env(safe-area-inset-bottom,16px),16px)]">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/55">
                  Stay in the loop
                </p>
                <button onClick={dismiss} className="p-1.5 rounded-full hover:bg-white/10">
                  <X className="w-4 h-4 text-white/55" />
                </button>
              </div>

              <div className="mt-3 flex items-start gap-3">
                <div className="shrink-0 w-12 h-12 rounded-2xl bg-white/10 border border-white/15 flex items-center justify-center">
                  <Bell className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[18px] font-bold tracking-[-0.02em]">
                    Enable notifications?
                  </p>
                  <p className="mt-1 text-[12px] text-white/55">
                    Get notified when a merchant accepts your order, marks payment
                    sent, or your trade settles.
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] font-medium text-white/55">
                {[
                  "Order accepted",
                  "Payment sent",
                  "Trade settled",
                ].map((label) => (
                  <div
                    key={label}
                    className="rounded-xl px-2 py-2 bg-white/[0.04] border border-white/10 text-center inline-flex items-center justify-center gap-1"
                  >
                    <Zap className="w-3 h-3 text-accent" />
                    {label}
                  </div>
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={subscribe}
                disabled={busy}
                className="mt-4 w-full py-3.5 rounded-xl text-sm font-bold tracking-[-0.01em] bg-accent text-accent-text"
              >
                {busy ? "Enabling…" : "Enable notifications"}
              </motion.button>
              <button
                onClick={dismiss}
                className="mt-2 w-full py-2.5 rounded-xl text-[12px] font-medium text-white/55 hover:text-white"
              >
                Not now
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
