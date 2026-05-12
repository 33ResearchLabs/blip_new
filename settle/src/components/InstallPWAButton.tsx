"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Floating "Install App" button.
 *
 * - Registers the install-only service worker (required for the
 *   `beforeinstallprompt` event to fire in Chromium browsers).
 * - Captures the prompt and exposes it via a button.
 * - Hides itself once installed or if the OS doesn't support installs
 *   (e.g. iOS Safari, which uses the share-sheet flow instead).
 */
export function InstallPWAButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Already running as installed PWA → don't show.
    const standalone =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(display-mode: standalone)").matches ||
        // iOS
        // @ts-expect-error legacy
        window.navigator?.standalone === true);
    if (standalone) {
      setInstalled(true);
      return;
    }

    // Register the SW so the browser considers the app installable.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw-install.js", { scope: "/" })
        .catch(() => {});
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const trigger = async () => {
    if (!deferred) {
      // No native prompt available (e.g. iOS Safari, Firefox).
      // Show a short hint instead.
      alert(
        "To install: on iOS, tap the share button in Safari and choose “Add to Home Screen.” On Android Chrome, open the browser menu and choose “Install app.”"
      );
      return;
    }
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  };

  return (
    <button
      type="button"
      onClick={trigger}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold text-text-primary bg-surface-card hover:bg-surface-hover border border-border-medium hover:border-text-tertiary transition-all"
    >
      <Download className="w-3.5 h-3.5" />
      Install App
    </button>
  );
}
