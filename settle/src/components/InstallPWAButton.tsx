"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X, Share2, Plus, MoreVertical } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

interface Props {
  /** Which app this button installs. Drives sheet copy + the "go to the
   *  correct page" CTA when the user is on the wrong page for this install. */
  app?: "user" | "merchant";
}

/**
 * "Download App" button — always visible until the matching PWA is installed.
 *
 * Tap flow:
 *  - If the browser has queued `beforeinstallprompt` → native install dialog
 *    (one-tap install of whichever manifest is linked on the current page).
 *  - Otherwise → bottom sheet with platform-specific instructions and an
 *    explicit name of the app being installed so the two PWAs aren't
 *    confused.
 */
export function InstallPWAButton({ app = "user" }: Props) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");

  const appName = app === "merchant" ? "Blip Money Merchant" : "Blip Money";

  useEffect(() => {
    const standalone =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches ||
        // @ts-expect-error legacy iOS
        window.navigator?.standalone === true);
    if (standalone) {
      setInstalled(true);
      return;
    }

    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) setPlatform("ios");
    else if (/Android/i.test(ua)) setPlatform("android");
    else setPlatform("desktop");

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw-install.js", { scope: "/" }).catch(() => {});
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
      setShowSheet(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const onTap = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        await deferred.userChoice;
      } finally {
        setDeferred(null);
      }
      return;
    }
    setShowSheet(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={onTap}
        data-app={app}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-[#0B0F14] bg-white hover:bg-white/90 shadow-[0_8px_24px_-10px_rgba(255,255,255,0.4)] transition-all"
      >
        <Download className="w-3.5 h-3.5" />
        Download
      </button>

      <AnimatePresence>
        {showSheet && (
          <>
            <motion.div
              className="fixed inset-0 z-[150] bg-black/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSheet(false)}
            />
            <motion.div
              className="fixed inset-x-0 bottom-0 z-[151] bg-[#0B0F14] text-white rounded-t-3xl border-t border-white/10 shadow-2xl"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
            >
              <div className="mx-auto max-w-[440px] px-5 py-5 pb-[max(env(safe-area-inset-bottom,16px),16px)]">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/55">
                    Install
                  </p>
                  <button
                    onClick={() => setShowSheet(false)}
                    className="p-1.5 rounded-full hover:bg-white/10"
                  >
                    <X className="w-4 h-4 text-white/55" />
                  </button>
                </div>

                <p className="mt-2 text-[20px] font-bold tracking-[-0.02em]">{appName}</p>
                <p className="mt-1 text-[12px] text-white/55">
                  Add to your home screen — opens in one tap.
                </p>

                <div className="mt-5 space-y-3">
                  {platform === "ios" && (
                    <>
                      <Step
                        n={1}
                        icon={<Share2 className="w-4 h-4" />}
                        title="Tap the Share button"
                        sub="Square with arrow at the bottom of Safari."
                      />
                      <Step
                        n={2}
                        icon={<Plus className="w-4 h-4" />}
                        title='Tap "Add to Home Screen"'
                        sub={`Confirm "${appName}", then tap Add.`}
                      />
                    </>
                  )}
                  {platform === "android" && (
                    <>
                      <Step
                        n={1}
                        icon={<MoreVertical className="w-4 h-4" />}
                        title="Open the browser menu (⋮)"
                        sub="Top-right corner of Chrome / Firefox / Edge."
                      />
                      <Step
                        n={2}
                        icon={<Download className="w-4 h-4" />}
                        title='Tap "Install app" or "Add to Home screen"'
                        sub={`The "${appName}" icon will appear on your home screen.`}
                      />
                    </>
                  )}
                  {platform === "desktop" && (
                    <>
                      <Step
                        n={1}
                        icon={<Download className="w-4 h-4" />}
                        title="Look for the install icon in the address bar"
                        sub="Chrome / Edge: ⊕ icon. Click and confirm."
                      />
                      <Step
                        n={2}
                        icon={<MoreVertical className="w-4 h-4" />}
                        title={`Or open menu → "Install ${appName}"`}
                        sub="Three-dot menu, top-right corner."
                      />
                    </>
                  )}
                </div>

                <button
                  onClick={() => setShowSheet(false)}
                  className="mt-5 w-full py-3 rounded-xl bg-white text-[#0B0F14] text-sm font-bold"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Step({
  n,
  icon,
  title,
  sub,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl p-3 bg-white/[0.04] border border-white/10">
      <div className="shrink-0 w-7 h-7 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[11px] font-bold">
        {n}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <span className="text-white/80">{icon}</span>
          {title}
        </div>
        <p className="text-[11px] text-white/55 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}
