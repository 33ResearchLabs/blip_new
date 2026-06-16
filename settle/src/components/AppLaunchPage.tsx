"use client";

import { useState, useEffect } from "react";
import { BlipLogo } from "@/components/shared/BlipLogo";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type InstallState = "unavailable" | "ready" | "installing" | "installed";

/* ── design tokens (from styles.css) ── */
const T = {
  bg: "#FAF8F5",
  bgWarm: "#F0EDE8",
  ink: "#100e0c",
  inkSoft: "#2c2825",
  muted: "#8a857d",
  faint: "#b6b0a7",
  line: "rgba(16,14,12,.10)",
  line2: "rgba(16,14,12,.17)",
  coral: "#d6603a",
  coralHi: "#e6794f",
  coralDeep: "#bb4d2b",
  coralSoft: "#f3d4c5",
  coralWash: "#fcefe8",
  coralGlow: "rgba(214,96,58,.14)",
  black: "#0d0c0a",
  black2: "#16140f",
  onBlack: "#f5f3ef",
  onBlackMut: "#9a958c",
  onBlackFaint: "#615c54",
  onBlackLine: "rgba(255,255,255,.09)",
  green: "#3a9e6a",
  greenLt: "#4cc98c",
  red: "#d6493f",
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono: "'SF Mono', Monaco, 'Courier New', monospace",
};

type HelpKind = "ios" | "android" | "desktop";

// Best-effort platform sniff — used only to pick which Add-to-Home-Screen
// instructions to show when no native install prompt is available.
function detectPlatform(): HelpKind {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  // iPadOS 13+ masquerades as "Macintosh" but is touch-capable.
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/.test(ua) &&
      typeof document !== "undefined" &&
      "ontouchend" in document);
  if (isIOS) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

export function AppLaunchPage() {
  const [state, setState] = useState<InstallState>("unavailable");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [help, setHelp] = useState<HelpKind | null>(null);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) {
      setState("installed");
      return;
    }
    const h = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      setState("ready");
    };
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", () => {
      setState("installed");
      setPrompt(null);
    });
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  // Install the USER app. On Android / desktop Chrome the captured
  // `beforeinstallprompt` shows the native install dialog. When no native
  // prompt is available (iOS Safari, in-app webviews, or before the event has
  // fired) we show platform-specific Add-to-Home-Screen steps — instead of
  // silently dropping the user onto the login page in the browser.
  async function installUserApp() {
    if (state === "installed") return;
    if (prompt) {
      setState("installing");
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        setState(outcome === "accepted" ? "installed" : "ready");
      } catch {
        setState("ready");
      }
      setPrompt(null);
      return;
    }
    setHelp(detectPlatform());
  }

  const openUserApp = () => {
    window.location.href = "/user/login";
  };
  const downloadUserApp = installUserApp;
  // Open the merchant web app — direct navigation, matching the user card.
  const openMerchantApp = () => {
    window.location.href = "/market/login";
  };
  // The merchant PWA has its own manifest + scope (/market). The landing-page
  // install prompt targets the USER app, so it can't install the merchant app.
  // Send the merchant to /market/login, where the merchant manifest is active
  // and Chrome offers install directly (and iOS can Add-to-Home-Screen there).
  const downloadMerchantApp = () => {
    window.location.href = "/market/login";
  };

  return (
    <>
      {/* Google Fonts */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap&display=swap');`}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: T.bg,
          fontFamily: T.font,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {/* radial coral glow top */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            background: `radial-gradient(920px 540px at 50% -8%, rgba(240,105,30,.11), transparent 62%),
                       radial-gradient(620px 520px at 100% 4%, rgba(240,105,30,.05), transparent 55%)`,
          }}
        />

        {/* ── NAV (dark bar, hidden on mobile) ── */}
        <nav
          className="blip-nav"
          style={{
            height: 62,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 22,
            padding: "0 clamp(20px,3vw,40px)",
            background: T.black,
            color: T.onBlack,
            position: "relative",
            zIndex: 10,
          }}
        >
          {/* Brand — matches blip.money logo exactly */}
          <a
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              textDecoration: "none",
              color: T.onBlack,
            }}
          >
            <BlipLogo />

            <span
              style={{
                fontWeight: 700,
                fontSize: 19,
                letterSpacing: "-0.04em",
                display: "flex",
                alignItems: "baseline",
              }}
            >
              <span style={{ color: "#ffffff" }}>Blip</span>
              <em
                style={{
                  fontStyle: "italic",
                  fontWeight: 600,
                  color: "#ffffff",
                  marginLeft: 4,
                }}
              >
                money
              </em>
            </span>
          </a>

          {/* Live status */}
          <span
            className="blip-status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontFamily: T.mono,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.14em",
              color: T.onBlackMut,
              paddingLeft: 18,
              borderLeft: `1px solid ${T.onBlackLine}`,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: T.greenLt,
                boxShadow: `0 0 6px ${T.greenLt}`,
              }}
            />
            MAINNET · LIVE
          </span>

          {/* Links */}
          <div
            className="blip-links"
            style={{ display: "flex", gap: 24, marginLeft: "auto" }}
          >
            {["How it works", "Network"].map((l) => (
              <a
                key={l}
                href="#"
                style={{
                  color: T.onBlackMut,
                  fontSize: 14,
                  fontWeight: 500,
                  textDecoration: "none",
                }}
              >
                {l}
              </a>
            ))}
          </div>

          {/* Sign in */}
          <div style={{ marginLeft: 24 }}>
            <a
              href="/user/login"
              style={{
                padding: "9px 16px",
                fontSize: 13.5,
                fontWeight: 700,
                border: `1px solid ${T.onBlackLine}`,
                borderRadius: 10,
                color: T.onBlackMut,
                background: "transparent",
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              Sign in
            </a>
          </div>
        </nav>

        {/* ── MAIN STAGE ── */}
        <div
          className="blip-main"
          style={{
            flex: 1,
            minHeight: 0,
            position: "relative",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 clamp(24px,5vw,72px)",
            textAlign: "center",
            zIndex: 1,
          }}
        >
          {/* Decorative phone (bottom-left) */}
          <div
            aria-hidden
            className="blip-deco"
            style={{
              position: "absolute",
              left: -46,
              bottom: -150,
              transform: "rotate(12deg) scale(.92)",
              zIndex: 1,
              pointerEvents: "none",
            }}
          >
            <PhoneMock />
          </div>

          {/* Decorative dashboard (bottom-right) */}
          <div
            aria-hidden
            className="blip-deco"
            style={{
              position: "absolute",
              right: -70,
              bottom: -120,
              width: 420,
              transform: "rotate(-9deg) scale(.96)",
              zIndex: 1,
              pointerEvents: "none",
            }}
          >
            <DashMock />
          </div>

          {/* Content */}
          <div
            className="blip-main-content"
            style={{ position: "relative", zIndex: 3 }}
          >
            {/* Eyebrow */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                marginBottom: 18,
                fontFamily: T.mono,
                fontSize: 11.5,
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: T.muted,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: T.coral,
                  animation: "blipPulse 2.4s infinite",
                }}
              />
              Open liquidity network
            </div>

            {/* Headline */}
            <h1
              className="blip-h1"
              style={{
                fontWeight: 700,
                lineHeight: 0.98,
                letterSpacing: "-0.06em",
                fontSize: "clamp(3.2rem,11vw,3.9rem)",
                color: T.ink,
                margin: "0 0 0",
              }}
            >
              Two apps.{" "}
              <em style={{ fontStyle: "italic", fontWeight: 600 }}>
                One network.
              </em>
            </h1>

            {/* Two-card chooser */}
            <div
              className="blip-chooser"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 20,
                maxWidth: 800,
                margin: "34px auto 0",
                textAlign: "left",
              }}
            >
              {/* User card */}
              <div
                style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 32,
                  padding: 28,
                  background: T.bg,
                  boxShadow: "0 30px 70px -42px rgba(16,14,12,.32)",
                  transition:
                    "transform .25s, border-color .25s, box-shadow .25s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    "translateY(-4px)";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    T.coralSoft;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = "";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    T.line;
                }}
              >
                {/* Head */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    paddingBottom: 22,
                    marginBottom: 22,
                    borderBottom: `1px solid ${T.line}`,
                  }}
                >
                  <span className="w-[50px] h-[50px] rounded-[15px] shrink-0 grid place-items-center bg-black border border-gray-200">
                    <BlipLogo />
                  </span>
                  <div>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 21,
                        letterSpacing: "-0.02em",
                        lineHeight: 1,
                        color: T.ink,
                      }}
                    >
                      Blip{" "}
                      <em style={{ fontStyle: "italic", fontWeight: 600 }}>
                        money
                      </em>
                    </div>
                    <div style={{ color: T.muted, fontSize: 14, marginTop: 6 }}>
                      Send &amp; receive money, anywhere
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 10.5,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "#6b6560",
                    marginBottom: 10,
                  }}
                >
                  Use it now
                </div>
                <button
                  onClick={openUserApp}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 9,
                    padding: "15px 18px",
                    borderRadius: 14,
                    cursor: "pointer",
                    background: "#fff",
                    color: T.coral,
                    border: `2px solid ${T.coral}`,
                    fontFamily: T.font,
                    fontWeight: 700,
                    fontSize: 15.5,
                    letterSpacing: "-0.01em",
                  }}
                >
                  <GlobeIcon /> Open web app
                </button>

                {/* Download */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: T.mono,
                    fontSize: 10.5,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "#6b6560",
                    marginTop: 18,
                    marginBottom: 10,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={12}
                    height={12}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 4v12M8 12l4 4 4-4M4 20h16" />
                  </svg>
                  Download the app
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PlatBtn icon="ios" label="iOS" onClick={downloadUserApp} />
                  <PlatBtn
                    icon="android"
                    label="Android"
                    onClick={downloadUserApp}
                  />
                </div>
              </div>

              {/* Market card */}
              <div
                style={{
                  border: `1px solid ${T.line}`,
                  borderRadius: 32,
                  padding: 28,
                  background: T.bg,
                  boxShadow: "0 30px 70px -42px rgba(16,14,12,.32)",
                  transition:
                    "transform .25s, border-color .25s, box-shadow .25s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform =
                    "translateY(-4px)";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    T.coralSoft;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.transform = "";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    T.line;
                }}
              >
                {/* Head */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    paddingBottom: 22,
                    marginBottom: 22,
                    borderBottom: `1px solid ${T.line}`,
                  }}
                >
                  <span className="w-[50px] h-[50px] rounded-[15px] shrink-0 grid place-items-center bg-black border border-gray-200">
                    <BlipLogo />
                  </span>

                  <div>
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 21,
                        letterSpacing: "-0.02em",
                        lineHeight: 1,
                        color: T.ink,
                      }}
                    >
                      Blip{" "}
                      <em style={{ fontStyle: "italic", fontWeight: 600 }}>
                        Market
                      </em>
                    </div>
                    <div style={{ color: T.muted, fontSize: 14, marginTop: 6 }}>
                      Run a merchant desk &amp; earn
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 10.5,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "#6b6560",
                    marginBottom: 10,
                  }}
                >
                  Use it now
                </div>
                <button
                  onClick={openMerchantApp}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 9,
                    padding: "15px 18px",
                    borderRadius: 14,
                    border: "none",
                    cursor: "pointer",
                    background: T.black,
                    color: T.onBlack,
                    fontFamily: T.font,
                    fontWeight: 700,
                    fontSize: 15.5,
                    letterSpacing: "-0.01em",
                  }}
                >
                  <MonitorIcon /> Open web app
                </button>

                {/* Download */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: T.mono,
                    fontSize: 10.5,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    color: "#6b6560",
                    marginTop: 18,
                    marginBottom: 10,
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width={12}
                    height={12}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 4v12M8 12l4 4 4-4M4 20h16" />
                  </svg>
                  Download the app
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <PlatBtn
                    icon="android"
                    label="Mobile"
                    onClick={downloadMerchantApp}
                  />
                  <PlatBtn
                    icon="mac"
                    label="Desktop"
                    onClick={downloadMerchantApp}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Styles */}
        <style>{`
          @keyframes blipPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.8)}}
          @media(max-width:820px){
            .blip-chooser{grid-template-columns:1fr !important;}
            .blip-deco{display:none !important;}
            .blip-links{display:none !important;}
            .blip-status{display:none !important;}
            .blip-nav{display:none !important;}
            .blip-main{overflow-y:auto !important; overflow-x:hidden !important; justify-content:flex-start !important; padding-top:40px !important; padding-bottom:40px !important;}
            .blip-main-content{width:100% !important;}
            .blip-h1{font-size:clamp(2.4rem,10vw,3.2rem) !important; letter-spacing:-0.04em !important;}
          }
        `}</style>
      </div>
      {help && <InstallHelp kind={help} onClose={() => setHelp(null)} />}
    </>
  );
}

/* ── Platform button ── */
function PlatBtn({
  icon,
  label,
  onClick,
}: {
  icon: "ios" | "android" | "mac";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        padding: "12px 6px",
        borderRadius: 13,
        border: `1px solid ${T.line2}`,
        background: T.bgWarm,
        color: T.inkSoft,
        fontFamily: T.font,
        fontWeight: 600,
        fontSize: 13.5,
        cursor: "pointer",
        transition: "background .2s",
      }}
    >
      {/* Apple logo — only for iOS */}
      {icon === "ios" && (
        <svg viewBox="0 0 24 24" width={15} height={15} fill={T.inkSoft}>
          <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.46 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
        </svg>
      )}
      {/* Desktop — generic monitor */}
      {icon === "mac" && (
        <svg
          viewBox="0 0 24 24"
          width={16}
          height={16}
          fill="none"
          stroke={T.inkSoft}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      )}
      {/* Android logo — official bugdroid */}
      {icon === "android" && (
        <svg viewBox="0 0 24 24" width={16} height={16} fill="#3DDC84">
          <path d="M17.523 15.341c-.551 0-.999-.449-.999-1s.448-.999.999-.999c.551 0 .999.448.999.999 0 .551-.448 1-.999 1m-11.046 0c-.551 0-.999-.449-.999-1s.448-.999.999-.999c.551 0 .999.448.999.999 0 .551-.448 1-.999 1m11.405-6.02l1.997-3.459a.416.416 0 00-.152-.568.416.416 0 00-.568.152l-2.022 3.503A10.97 10.97 0 0012 7.851c-1.86 0-3.59.393-5.137 1.099L4.841 5.447a.416.416 0 00-.568-.152.416.416 0 00-.152.568l1.997 3.459C2.689 11.187.343 14.659 0 18.761h24c-.344-4.102-2.689-7.574-6.118-9.44" />
        </svg>
      )}
      {label}
    </button>
  );
}

/* ── Install instructions overlay (shown when no native prompt is available) ── */
function InstallHelp({
  kind,
  onClose,
}: {
  kind: HelpKind;
  onClose: () => void;
}) {
  const steps =
    kind === "ios"
      ? [
          {
            title: "Tap the Share button",
            body: "In Safari, tap the Share icon (a square with an upward arrow) in the bottom toolbar.",
          },
          {
            title: "Add to Home Screen",
            body: "Scroll down the share sheet and tap “Add to Home Screen”.",
          },
          {
            title: "Tap Add",
            body: "Confirm with “Add”. Blip appears on your home screen and opens fullscreen.",
          },
        ]
      : kind === "android"
      ? [
          {
            title: "Open the Chrome menu",
            body: "Tap the ⋮ menu in the top-right of Chrome.",
          },
          {
            title: "Install app",
            body: "Tap “Install app” (or “Add to Home screen”).",
          },
          {
            title: "Confirm",
            body: "Tap “Install”. Blip installs like a normal app and opens fullscreen.",
          },
        ]
      : [
          {
            title: "Use the address bar",
            body: "Click the install icon (a monitor with a down arrow) at the right of the address bar.",
          },
          {
            title: "Or the browser menu",
            body: "Otherwise open the ⋮ menu and choose “Install Blip Money”.",
          },
          {
            title: "Confirm",
            body: "Click “Install”. Blip opens in its own window.",
          },
        ];

  const heading =
    kind === "ios" ? "Add Blip to your Home Screen" : "Install Blip";
  const note =
    kind === "android"
      ? "Not seeing “Install app”? You may be in an in-app browser (Instagram, Facebook, Telegram). Tap ⋮ → “Open in Chrome”, then try again."
      : kind === "ios"
      ? "iPhone & iPad install Blip through Safari’s Share menu — there’s no one-tap button."
      : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(13,12,10,.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        fontFamily: T.font,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: T.bg,
          borderRadius: "24px 24px 0 0",
          padding: "22px 22px 28px",
          boxShadow: "0 -20px 60px -20px rgba(16,14,12,.5)",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 999,
            background: T.line2,
            margin: "0 auto 18px",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              flexShrink: 0,
              overflow: "hidden",
              display: "grid",
              placeItems: "center",
            }}
          >
            <BlipLogo size={44} alt="Blip" />
          </span>
          <div
            style={{
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "-0.02em",
              color: T.ink,
            }}
          >
            {heading}
          </div>
        </div>

        <ol
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {steps.map((s, i) => (
            <li key={i} style={{ display: "flex", gap: 12 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  background: T.coral,
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  fontFamily: T.mono,
                }}
              >
                {i + 1}
              </span>
              <div>
                <div
                  style={{ fontWeight: 700, fontSize: 14.5, color: T.inkSoft }}
                >
                  {s.title}
                </div>
                <div
                  style={{
                    fontSize: 13.5,
                    color: T.muted,
                    marginTop: 2,
                    lineHeight: 1.45,
                  }}
                >
                  {s.body}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {note && (
          <div
            style={{
              marginTop: 18,
              padding: "11px 13px",
              borderRadius: 12,
              background: T.coralWash,
              border: `1px solid ${T.coralSoft}`,
              fontSize: 12.5,
              color: T.coralDeep,
              lineHeight: 1.45,
            }}
          >
            {note}
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 20,
            padding: "14px 18px",
            borderRadius: 14,
            border: `1px solid ${T.line2}`,
            background: T.bgWarm,
            color: T.inkSoft,
            fontFamily: T.font,
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 010 18 15 15 0 010-18" />
    </svg>
  );
}
function MonitorIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

/* ── Phone decoration ── */
function PhoneMock() {
  return (
    <div
      style={{
        width: 248,
        borderRadius: 34,
        padding: 11,
        background: "linear-gradient(160deg,#2a241c,#0c0a07)",
        border: "1px solid rgba(0,0,0,.2)",
        boxShadow:
          "0 40px 80px -34px rgba(16,14,12,.55), inset 0 1px 0 rgba(255,255,255,.08)",
      }}
    >
      <div
        style={{
          background: "#0c0a07",
          borderRadius: 25,
          padding: "16px 15px 14px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: T.mono,
            fontSize: 11,
            color: T.onBlackMut,
            marginBottom: 14,
          }}
        >
          <span>9:41</span>
          <span
            style={{
              width: 46,
              height: 5,
              borderRadius: 3,
              background: "rgba(255,255,255,.18)",
            }}
          />
        </div>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 10,
            letterSpacing: "0.18em",
            color: T.onBlackFaint,
            textTransform: "uppercase",
          }}
        >
          Balance
        </div>
        <div
          style={{
            fontSize: 38,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            marginTop: 4,
            color: "#fff",
          }}
        >
          $2,400
        </div>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 12,
            color: T.onBlackMut,
            marginTop: 5,
          }}
        >
          ≈ ₹1,99,920
        </div>
        <div style={{ display: "flex", gap: 7, margin: "16px 0 14px" }}>
          {["Buy", "Sell", "Send", "Scan"].map((t, i) => (
            <div
              key={t}
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 12,
                fontWeight: 700,
                padding: "9px 0",
                borderRadius: 11,
                background: i === 0 ? T.coral : "rgba(255,255,255,.05)",
                color: i === 0 ? "#fff" : T.onBlackMut,
              }}
            >
              {t}
            </div>
          ))}
        </div>
        <div
          style={{
            fontFamily: T.mono,
            fontSize: 9.5,
            letterSpacing: "0.18em",
            color: T.onBlackFaint,
            textTransform: "uppercase",
            margin: "4px 0 8px",
          }}
        >
          Recent
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 0",
            borderTop: "1px solid rgba(255,255,255,.05)",
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              fontSize: 11,
              fontWeight: 700,
              color: "#fff",
              background: T.coral,
            }}
          >
            M
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff" }}>
              Meera K.
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: T.onBlackFaint,
                fontFamily: T.mono,
              }}
            >
              2m ago
            </div>
          </div>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              fontFamily: T.mono,
              color: T.greenLt,
            }}
          >
            +₹2,400
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Dashboard decoration ── */
function DashMock() {
  return (
    <div
      style={{
        borderRadius: 14,
        overflow: "hidden",
        background: "#0c0a07",
        border: "1px solid rgba(255,255,255,.08)",
        boxShadow: "0 30px 60px -30px rgba(16,14,12,.5)",
        color: T.onBlack,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "11px 14px",
          background: "#13100b",
          borderBottom: "1px solid rgba(255,255,255,.06)",
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "#fff",
          }}
        >
          BLIP MARKET
        </span>
        <span style={{ display: "flex", gap: 14, marginLeft: 14 }}>
          {["Orders", "Analytics"].map((l) => (
            <span key={l} style={{ fontSize: 10.5, color: T.onBlackFaint }}>
              {l}
            </span>
          ))}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: T.mono,
            fontSize: 11,
            fontWeight: 700,
            color: T.coralHi,
            background: T.coralGlow,
            padding: "4px 9px",
            borderRadius: 7,
          }}
        >
          $45,280
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "108px 1fr" }}>
        <div
          style={{
            padding: 14,
            borderRight: "1px solid rgba(255,255,255,.06)",
          }}
        >
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 9,
              letterSpacing: "0.16em",
              color: T.onBlackFaint,
              textTransform: "uppercase",
            }}
          >
            Balance
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              marginTop: 3,
              color: "#fff",
            }}
          >
            $45k
          </div>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 11,
              color: T.coralHi,
              fontWeight: 600,
              marginTop: 2,
            }}
          >
            ↑ +$1,247
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 3,
              height: 42,
              marginTop: 16,
            }}
          >
            {[30, 55, 40, 70, 50, 100, 60].map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${h}%`,
                  background: i === 5 ? T.coral : "rgba(255,255,255,.12)",
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
        </div>
        <div style={{ padding: 12 }}>
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 9,
              letterSpacing: "0.16em",
              color: T.onBlackFaint,
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Pending
          </div>
          {[
            { n: "parth.sol", a: "200 USDT", side: "BUY" },
            { n: "maya.eth", a: "150 USDT", side: "SELL" },
          ].map((o) => (
            <div
              key={o.n}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: 8,
                borderRadius: 9,
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  background: "#33302a",
                }}
              >
                {o.n[0].toUpperCase()}
              </span>
              <div>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#fff",
                  }}
                >
                  {o.n}
                </div>
                <div
                  style={{
                    fontFamily: T.mono,
                    fontSize: 9,
                    color: T.onBlackFaint,
                  }}
                >
                  {o.a}
                </div>
              </div>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: T.mono,
                  fontSize: 9.5,
                  fontWeight: 700,
                  padding: "3px 8px",
                  borderRadius: 6,
                  letterSpacing: "0.04em",
                  background:
                    o.side === "BUY"
                      ? "rgba(76,201,140,.16)"
                      : "rgba(214,73,63,.18)",
                  color: o.side === "BUY" ? T.greenLt : "#ef7b72",
                }}
              >
                {o.side}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "9px 14px",
          borderTop: "1px solid rgba(255,255,255,.06)",
          fontFamily: T.mono,
          fontSize: 10,
          color: T.onBlackMut,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: T.greenLt,
          }}
        />
        3 orders in progress
      </div>
    </div>
  );
}
