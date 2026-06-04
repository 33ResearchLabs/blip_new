"use client";

/**
 * PwaAppGuard
 * ───────────
 * Pins each installed PWA (User vs Merchant) to its intended routes.
 *
 * Each manifest's start_url carries ?pwa=user or ?pwa=merchant. On the
 * first launch we capture that into sessionStorage so the tag survives
 * navigations within the PWA window. The guard then enforces:
 *
 *   - app === 'user' on /merchant/*    → block + tell the user to install
 *                                        / open the Merchant app.
 *   - app === 'merchant' on non-/merchant → block + tell to open the
 *                                        User app.
 *
 * Web browser (display-mode: browser) is unguarded — anyone can hit any
 * route as usual. The guard only kicks in when the page is running as
 * an installed PWA (standalone display-mode).
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, ExternalLink } from "lucide-react";

const STORAGE_KEY = "blip_pwa_app";

type AppKind = "user" | "merchant";

interface Props {
  /** Which app this layout belongs to. */
  expected: AppKind;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // @ts-expect-error legacy iOS
  if (window.navigator?.standalone === true) return true;
  return false;
}

export function PwaAppGuard({ expected }: Props) {
  const [mismatch, setMismatch] = useState(false);
  const [actual, setActual] = useState<AppKind | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Capture the pwa= query param on the very first navigation into the
    // PWA window. Subsequent internal navigations drop the param but the
    // sessionStorage flag persists for the lifetime of the PWA session.
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("pwa");
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(STORAGE_KEY); } catch { /* */ }

    if (fromUrl === "user" || fromUrl === "merchant") {
      try { sessionStorage.setItem(STORAGE_KEY, fromUrl); } catch { /* */ }
      stored = fromUrl;
      // Strip the param so it doesn't leak into shareable URLs.
      url.searchParams.delete("pwa");
      const cleanUrl = url.pathname + (url.search ? url.search : "") + url.hash;
      window.history.replaceState({}, "", cleanUrl);
    }

    // Only enforce when running as an installed PWA. In-browser usage is
    // unrestricted.
    if (!isStandalone()) return;
    if (!stored) return; // PWA launched without a tag — likely a pre-v2
                         // install. Let it through.

    setActual(stored as AppKind);
    if (stored !== expected) setMismatch(true);
  }, [expected]);

  if (!mismatch) return null;

  const wrongKind = actual === "user" ? "User" : "Merchant";
  const rightKind = expected === "user" ? "User" : "Merchant";
  const rightUrl = expected === "user" ? "/user" : "/market/login";

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center text-center px-6"
      style={{ background: "#07090F", color: "#fff" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="w-14 h-14 rounded-full bg-white/10 border border-white/15 flex items-center justify-center mb-5">
        <Lock className="w-6 h-6 text-white/80" />
      </div>
      <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/55">
        Wrong app
      </p>
      <p className="mt-2 text-[22px] font-bold tracking-[-0.02em] max-w-[320px]">
        You're in the Blip {wrongKind} app
      </p>
      <p className="mt-2 text-[13px] text-white/55 max-w-[300px]">
        This area belongs to the Blip {rightKind} app. Install or open the {rightKind}
        {" "}app to continue.
      </p>
      <a
        href={rightUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#0B0F14] text-sm font-bold"
      >
        <ExternalLink className="w-4 h-4" />
        Open {rightKind} in browser
      </a>
      <p className="mt-3 text-[10px] text-white/40 max-w-[260px]">
        From there, tap “Download App” to install the {rightKind} PWA.
      </p>
    </motion.div>
  );
}
