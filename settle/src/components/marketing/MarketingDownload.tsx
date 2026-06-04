"use client";

import { useState, useEffect } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type State = "unavailable" | "ready" | "installing" | "installed";

export function MarketingDownload() {
  const [userAppState, setUserAppState] = useState<State>("unavailable");
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setUserAppState("installed");
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setUserAppState("ready");
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => {
      setUserAppState("installed");
      setDeferredPrompt(null);
    });
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function installUserApp() {
    if (!deferredPrompt) return;
    setUserAppState("installing");
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setUserAppState(outcome === "accepted" ? "installed" : "ready");
    setDeferredPrompt(null);
  }

  return (
    <section className="dl-section">
      <div className="dl-inner">
        <div className="dl-label">Download the app</div>
        <div className="dl-cards">

          {/* User app */}
          <div className="dl-card">
            <div className="dl-card-top">
              <div className="dl-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="6" y="2" width="12" height="20" rx="3"/>
                  <path d="M11 18h2"/>
                </svg>
              </div>
              <div className="dl-card-meta">
                <div className="dl-card-name">Blip Money</div>
                <div className="dl-card-sub">Send &amp; receive — for users</div>
              </div>
            </div>
            <div className="dl-plts">
              <span className="dl-pl">Web</span>
              <span className="dl-pl">iOS</span>
              <span className="dl-pl">Android</span>
            </div>
            {userAppState === "installed" ? (
              <div className="dl-btn dl-btn-done">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Installed
              </div>
            ) : userAppState === "installing" ? (
              <div className="dl-btn dl-btn-loading">Installing…</div>
            ) : userAppState === "ready" ? (
              <button className="dl-btn dl-btn-primary" onClick={installUserApp}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
                Install app
              </button>
            ) : (
              <a href="/?welcome=skip&tab=signin" className="dl-btn dl-btn-outline">
                Open in browser →
              </a>
            )}
          </div>

          {/* Merchant / Market app */}
          <div className="dl-card dl-card-dark">
            <div className="dl-card-top">
              <div className="dl-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <path d="M8 21h8"/><path d="M12 17v4"/>
                </svg>
              </div>
              <div className="dl-card-meta">
                <div className="dl-card-name">Blip Market</div>
                <div className="dl-card-sub">Desk dashboard — for merchants</div>
              </div>
            </div>
            <div className="dl-plts">
              <span className="dl-pl">Web</span>
              <span className="dl-pl">PWA</span>
            </div>
            <a href="/market/login?install=1" className="dl-btn dl-btn-accent" target="_top">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
              Install app
            </a>
          </div>

        </div>
      </div>
    </section>
  );
}
