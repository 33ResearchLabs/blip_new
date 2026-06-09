"use client";

import { useState, useEffect } from "react";
import { Download, Smartphone, Store, CheckCircle2, ExternalLink } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallState = "idle" | "installing" | "installed" | "unavailable";

export function AppDownloadSection({ compact = false }: { compact?: boolean }) {
  const [merchantInstallState, setMerchantInstallState] = useState<InstallState>("unavailable");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const userAppUrl = process.env.NEXT_PUBLIC_USER_APP_URL ?? "https://blip.money";

  useEffect(() => {
    // Check if already installed as a standalone PWA
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setMerchantInstallState("installed");
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setMerchantInstallState("idle");
    };
    window.addEventListener("beforeinstallprompt", handler);

    // Check if app was installed after user interacted
    window.addEventListener("appinstalled", () => {
      setMerchantInstallState("installed");
      setDeferredPrompt(null);
    });

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function installMerchantApp() {
    if (!deferredPrompt) return;
    setMerchantInstallState("installing");
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setMerchantInstallState("installed");
    } else {
      setMerchantInstallState("idle");
    }
    setDeferredPrompt(null);
  }

  if (compact) {
    return (
      <div className="px-3 py-2 flex gap-2">
        <CompactAppCard
          label="Merchant App"
          icon={<Store className="w-3.5 h-3.5" />}
          state={merchantInstallState}
          onInstall={installMerchantApp}
        />
        <CompactAppCard
          label="User App"
          icon={<Smartphone className="w-3.5 h-3.5" />}
          state="idle"
          href={userAppUrl}
        />
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-t border-white/[0.05] bg-background">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2.5">
        Download Apps
      </p>
      <div className="flex gap-2.5">
        <AppCard
          title="Merchant App"
          description="Your trading dashboard"
          icon={<Store className="w-4 h-4" />}
          state={merchantInstallState}
          onInstall={installMerchantApp}
        />
        <AppCard
          title="User App"
          description="For your customers"
          icon={<Smartphone className="w-4 h-4" />}
          state="idle"
          href={userAppUrl}
        />
      </div>
    </div>
  );
}

function AppCard({
  title,
  description,
  icon,
  state,
  onInstall,
  href,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  state: InstallState;
  onInstall?: () => void;
  href?: string;
}) {
  const isInstalled = state === "installed";
  const isInstalling = state === "installing";
  const canInstall = state === "idle" && !!onInstall;

  const buttonContent = isInstalled ? (
    <>
      <CheckCircle2 className="w-3 h-3 text-green-400" />
      <span>Installed</span>
    </>
  ) : isInstalling ? (
    <span>Installing…</span>
  ) : href ? (
    <>
      <ExternalLink className="w-3 h-3" />
      <span>Open</span>
    </>
  ) : canInstall ? (
    <>
      <Download className="w-3 h-3" />
      <span>Install</span>
    </>
  ) : (
    <>
      <Download className="w-3 h-3 opacity-40" />
      <span className="opacity-40">Install</span>
    </>
  );

  const buttonEl = href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-[11px] font-semibold text-white/70 hover:text-white transition-colors"
    >
      {buttonContent}
    </a>
  ) : (
    <button
      onClick={onInstall}
      disabled={!canInstall || isInstalling || isInstalled}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-[11px] font-semibold text-white/70 hover:text-white transition-colors disabled:cursor-default disabled:opacity-60"
    >
      {buttonContent}
    </button>
  );

  return (
    <div className="flex-1 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-white/50 shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-white/80 truncate">{title}</p>
          <p className="text-[10px] text-white/35 truncate">{description}</p>
        </div>
      </div>
      {buttonEl}
    </div>
  );
}

function CompactAppCard({
  label,
  icon,
  state,
  onInstall,
  href,
}: {
  label: string;
  icon: React.ReactNode;
  state: InstallState;
  onInstall?: () => void;
  href?: string;
}) {
  const isInstalled = state === "installed";
  const canInstall = state === "idle" && !!onInstall;

  const inner = (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] transition-colors cursor-pointer">
      <span className="text-white/40">{icon}</span>
      <span className="text-[11px] text-white/50 font-medium">{label}</span>
      {isInstalled ? (
        <CheckCircle2 className="w-3 h-3 text-green-400 ml-0.5" />
      ) : (
        <Download className={`w-3 h-3 ml-0.5 ${canInstall || href ? "text-white/40" : "text-white/20"}`} />
      )}
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex-1">
        {inner}
      </a>
    );
  }
  return (
    <button
      onClick={onInstall}
      disabled={!canInstall && !isInstalled}
      className="flex-1 text-left disabled:cursor-default"
    >
      {inner}
    </button>
  );
}
