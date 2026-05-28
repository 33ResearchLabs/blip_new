"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, Loader2, Mail, ShieldCheck } from "lucide-react";
import { useMerchantStore } from "@/stores/merchantStore";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { useDashboardAuth } from "@/hooks/useDashboardAuth";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";

export default function MerchantLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  const merchantId = useMerchantStore((s) => s.merchantId);
  const setMerchantId = useMerchantStore((s) => s.setMerchantId);
  const setMerchantInfo = useMerchantStore((s) => s.setMerchantInfo);
  const setIsLoggedIn = useMerchantStore((s) => s.setIsLoggedIn);
  const setSessionToken = useMerchantStore((s) => s.setSessionToken);
  const solanaWallet = useSolanaWallet();
  const [showPassword, setShowPassword] = useState(false);

  // Live tape rows fetched from /api/corridor/dynamic-rate every 60s.
  // Falls back to realistic P2P rates if fetch fails — INR mid ~97.5
  // (P2P range 95–100, much higher than FX spot of ~83), AED mid ~3.665
  // (P2P range 3.65–3.67). These match what the merchant dashboard
  // actually shows so the preview reads as "alive" even offline.
  type TapeRow = { pair: string; dir: "bid" | "ask"; px: string; sz: string };
  const [tapeRows, setTapeRows] = useState<TapeRow[]>([
    { pair: "USDT/INR", dir: "bid", px: "97.5500", sz: "820" },
    { pair: "USDT/INR", dir: "ask", px: "97.4500", sz: "1,400" },
    { pair: "USDT/AED", dir: "bid", px: "3.6700", sz: "340" },
    { pair: "USDT/INR", dir: "bid", px: "97.6500", sz: "920" },
    { pair: "USDT/INR", dir: "ask", px: "97.3000", sz: "560" },
    { pair: "USDT/AED", dir: "ask", px: "3.6600", sz: "650" },
  ]);

  // Mirror of useDashboardAuth.handleLogin's success path — Google sign-in
  // skips the password flow but lands the same store updates so the
  // existing `/merchant` redirect (useEffect below) takes over.
  const handleGoogleSuccess = (data: any) => {
    if (data?.merchant) {
      setMerchantId(data.merchant.id);
      setMerchantInfo(data.merchant);
      setIsLoggedIn(true);
      if (data.token) setSessionToken(data.token);
      router.replace("/merchant");
    }
  };

  const auth = useDashboardAuth({
    isMockMode: false,
    solanaWallet,
    setShowWalletPrompt: () => {},
    setShowUsernameModal: () => {},
  });

  // Seed authTab / loginError from URL params so deep links like
  // /merchant/login?tab=register and /merchant/login?reason=session_expired
  // land on the right state. The `reason` param is consumed once on mount
  // and then stripped from the URL — otherwise a page refresh would
  // reapply the banner forever, even after the user dismisses it or
  // successfully signs back in.
  useEffect(() => {
    const tab = searchParams.get("tab");
    auth.setAuthTab(tab === "register" || tab === "create" ? "create" : "signin");
    const reason = searchParams.get("reason");
    if (reason === "session_expired") {
      auth.setLoginError("Your session expired. Please sign in again.");
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("reason");
        const clean =
          url.pathname +
          (url.searchParams.toString() ? `?${url.searchParams}` : "") +
          url.hash;
        window.history.replaceState(null, "", clean);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoggedIn && merchantId) router.replace("/merchant");
  }, [isLoggedIn, merchantId, router]);

  // Fetch live corridor prices every 60s and generate tape rows.
  // Pattern: 3× INR, 2× AED, with alternating bid/ask. Fallback to
  // fixture rates if the API call fails (network down, auth required).
  useEffect(() => {
    const fetchTapeRates = async () => {
      try {
        const [aedRes, inrRes] = await Promise.all([
          fetch("/api/corridor/dynamic-rate?pair=usdt_aed"),
          fetch("/api/corridor/dynamic-rate?pair=usdt_inr"),
        ]);

        const aedData = await aedRes.json();
        const inrData = await inrRes.json();

        // Fallback values match the P2P market reality (INR ~97.5, AED
        // ~3.665), not the FX spot rate (~83 INR) — the endpoint may
        // return P2P-aligned numbers but if it 401s or stalls we still
        // want the tape to look like the merchant dashboard.
        const aedRate =
          aedData?.success && typeof aedData.data?.ref_price === "number"
            ? aedData.data.ref_price
            : 3.665;
        const inrRate =
          inrData?.success && typeof inrData.data?.ref_price === "number"
            ? inrData.data.ref_price
            : 97.5;

        // Generate 6 rows in a 3× INR / 2× AED pattern. P2P spreads are
        // wider than FX spot — bids land 0.05–0.15 above mid, asks 0.05–
        // 0.20 below mid for INR; AED uses ±0.005 (~0.15%).
        const rows: TapeRow[] = [
          { pair: "USDT/INR", dir: "bid", px: (inrRate + 0.05).toFixed(4), sz: "820" },
          { pair: "USDT/INR", dir: "ask", px: (inrRate - 0.05).toFixed(4), sz: "1,400" },
          { pair: "USDT/AED", dir: "bid", px: (aedRate + 0.005).toFixed(4), sz: "340" },
          { pair: "USDT/INR", dir: "bid", px: (inrRate + 0.15).toFixed(4), sz: "920" },
          { pair: "USDT/INR", dir: "ask", px: (inrRate - 0.20).toFixed(4), sz: "560" },
          { pair: "USDT/AED", dir: "ask", px: (aedRate - 0.005).toFixed(4), sz: "650" },
        ];
        setTapeRows(rows);
      } catch {
        // Silent fail — keep the last good cache (initial fixture rates).
      }
    };

    fetchTapeRates();
    const interval = setInterval(fetchTapeRates, 60_000); // Poll every 60s
    return () => clearInterval(interval);
  }, []);

  const isSignIn = auth.authTab === "signin";
  const submit = () => (isSignIn ? auth.handleLogin() : auth.handleRegister());
  const isLoading = isSignIn ? auth.isLoggingIn : auth.isRegistering;

  const isDisabled =
    isLoading ||
    (isSignIn
      ? !auth.loginForm.email || !auth.loginForm.password
      : !auth.registerForm.email ||
        !auth.registerForm.password ||
        !auth.registerForm.confirmPassword);

  return (
    <div
      className="min-h-dvh flex flex-col text-[#1d1d1f]"
      style={{ background: "#ffffff", fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* Instrument Serif powers the italic accents ("at the open.",
          "run the book.", etc.) — React 19 hoists <link> into <head>. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
      />

      {/* Scoped keyframes for the order tape + pulsing dots. Reduced-motion
          users get a static tape via the global CSS rule (`*` transition
          override) — these animations are decorative, not load-bearing. */}
      <style>{`
        @keyframes blipTapeScroll { from { transform: translateY(0); } to { transform: translateY(-50%); } }
        @keyframes blipDotPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        @media (prefers-reduced-motion: reduce) {
          .blip-tape-list { animation: none !important; }
          .blip-dot-pulse { animation: none !important; }
        }
      `}</style>

      {/* Top bar — dark band with Blip Market lockup + user-app cross-link.
          Brand wraps a Link to `/` so clicking it acts as the implicit
          "home" affordance the old top bar provided. */}
      <header
        className="text-white"
        style={{
          background: "#0a0a0a",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "18px 0",
        }}
      >
        <div className="px-5 sm:px-10 lg:px-14 flex items-center justify-between gap-3">
          <Link
            href="/"
            aria-label="Home"
            className="flex items-center gap-1.5 text-white no-underline"
            style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", height: 16 }}>
              <svg viewBox="0 0 70 60" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ height: 16, width: "auto", display: "block" }}>
                <path d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>
              <span style={{ fontWeight: 700 }}>Blip</span>
              <span style={{ fontStyle: "italic", fontWeight: 600, letterSpacing: "-0.045em", marginLeft: 4, color: "rgba(255,255,255,0.85)" }}>Market</span>
            </span>
          </Link>
          <Link
            href="/login"
            className="text-[13px] inline-flex items-center gap-1.5 font-medium transition-colors hover:text-white"
            style={{ color: "rgba(255,255,255,0.65)" }}
          >
            <span className="hidden sm:inline">Sign in to user app instead</span>
            <span className="sm:hidden">User app</span>
            <span aria-hidden>→</span>
          </Link>
        </div>
      </header>

      {/* Split — dark operator preview on the left (≥1024px), white
          sign-in card on the right. On smaller widths the left panel is
          hidden per the showcase mobile rule. */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] items-stretch">

        {/* LEFT — operator console preview. Decorative only; no inputs. */}
        <section
          className="hidden lg:flex relative text-white flex-col justify-between overflow-hidden"
          style={{
            padding: "64px 56px 48px",
            background:
              "radial-gradient(900px 600px at 0% 0%, rgba(204,120,92,0.14), transparent 60%), radial-gradient(700px 500px at 100% 100%, rgba(204,120,92,0.08), transparent 60%), #0a0a0a",
          }}
        >
          {/* Huge "122" waitlist watermark — sets the editorial scale of
              the panel without needing additional copy. */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -30,
              right: -20,
              fontFamily: "'Inter', sans-serif",
              fontWeight: 800,
              fontSize: 340,
              lineHeight: 0.85,
              letterSpacing: "-0.06em",
              color: "rgba(204,120,92,0.06)",
              pointerEvents: "none",
              zIndex: 0,
              fontFeatureSettings: '"tnum"',
            }}
          >
            122
          </span>

          <div className="relative z-[1]">
            <span
              className="inline-flex items-center text-[10.5px] uppercase font-semibold"
              style={{
                gap: 10,
                color: "#e9a787",
                letterSpacing: "0.24em",
                padding: "7px 13px",
                background: "rgba(204,120,92,0.07)",
                border: "1px solid rgba(204,120,92,0.30)",
                borderRadius: 999,
                backdropFilter: "blur(8px)",
              }}
            >
              <span
                className="blip-dot-pulse"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#d8b85a",
                  boxShadow: "0 0 0 3px rgba(216,184,90,0.20)",
                  animation: "blipDotPulse 1.8s ease-in-out infinite",
                }}
              />
              Operator console · Preview
            </span>

            <h1
              className="font-bold text-white"
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 64,
                letterSpacing: "-0.042em",
                lineHeight: 0.96,
                margin: "24px 0 18px",
                maxWidth: "12ch",
              }}
            >
              Your desk,{" "}
              <em
                style={{
                  fontFamily: "'Instrument Serif', Georgia, serif",
                  fontStyle: "italic",
                  fontWeight: 400,
                  color: "#cc785c",
                  fontSize: "1.08em",
                  letterSpacing: "-0.022em",
                }}
              >
                at the open.
              </em>
            </h1>

            <p
              style={{
                color: "rgba(255,255,255,0.62)",
                fontSize: 15.5,
                lineHeight: 1.62,
                maxWidth: "44ch",
                margin: "0 0 36px",
                letterSpacing: "-0.005em",
              }}
            >
              Set your rates. Compete on price. Win the fill. Sign in now
              to reserve your seat for the launch.
            </p>

            <div
              className="inline-flex items-center gap-2 text-[11.5px] mb-3.5"
              style={{ color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em" }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "#d8b85a",
                  boxShadow: "0 0 0 4px rgba(216,184,90,0.18)",
                }}
              />
              Sample order tape · indicative pricing
            </div>

            {/* Order tape — vertical loop. Decorative copy (`demo`) and
                fake quotes; the production exchange data lives in
                /merchant/dashboard. */}
            <div
              className="relative overflow-hidden"
              style={{
                padding: "18px 20px",
                maxWidth: 440,
                background: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 16,
                boxShadow:
                  "0 30px 70px -40px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.06) inset",
              }}
            >
              <h5
                className="flex justify-between items-center"
                style={{
                  margin: "0 0 12px",
                  fontSize: 10,
                  letterSpacing: "0.20em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.50)",
                  fontWeight: 600,
                }}
              >
                <span>Sample fills · indicative</span>
                <span
                  className="inline-flex items-center gap-1.5"
                  style={{ color: "#d8b85a", fontSize: 9, letterSpacing: "0.16em" }}
                >
                  <span
                    className="blip-dot-pulse"
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#d8b85a",
                      animation: "blipDotPulse 1.8s ease-in-out infinite",
                    }}
                  />
                  Preview
                </span>
              </h5>
              <div className="relative" style={{ height: 170, overflow: "hidden" }}>
                <div
                  className="blip-tape-list flex flex-col"
                  style={{ animation: "blipTapeScroll 18s linear infinite" }}
                >
                  {/* 6 unique rows × 2 (seamless loop) — populated from live rates */}
                  {[...tapeRows, ...tapeRows].map((row, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "80px 1fr 60px 56px",
                        padding: "7px 0",
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.85)",
                        alignItems: "center",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                      }}
                    >
                      <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 11, letterSpacing: "0.02em" }}>{row.pair}</span>
                      <span
                        style={{
                          color: row.dir === "bid" ? "#7cd29c" : "#ee8e83",
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {row.dir === "bid" ? "↑ " : "↓ "}
                        {row.px}
                      </span>
                      <span
                        style={{
                          textAlign: "right",
                          color: "rgba(255,255,255,0.65)",
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {row.sz}
                      </span>
                      <span style={{ textAlign: "right", color: "rgba(255,255,255,0.35)", fontSize: 10.5, fontStyle: "italic" }}>demo</span>
                    </div>
                  ))}
                </div>
                {/* Bottom fade so the loop seam disappears into the panel. */}
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 50,
                    background: "linear-gradient(180deg, transparent, rgba(10,10,10,0.95))",
                    pointerEvents: "none",
                    zIndex: 2,
                  }}
                />
              </div>
            </div>

            {/* KPIs */}
            <div
              className="grid grid-cols-3"
              style={{ marginTop: 36, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 24, maxWidth: 480 }}
            >
              <div className="relative" style={{ paddingLeft: 0, paddingRight: 18 }}>
                <div
                  className="text-white"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: "-0.028em",
                    lineHeight: 1,
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  <em
                    style={{
                      fontFamily: "'Instrument Serif', Georgia, serif",
                      fontStyle: "italic",
                      fontWeight: 400,
                      color: "#e9a787",
                      fontSize: "1.04em",
                    }}
                  >
                    122
                  </em>
                </div>
                <div className="text-[10px] uppercase font-semibold mt-2" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.22em" }}>
                  Total waitlist
                </div>
              </div>
              <div className="relative" style={{ padding: "0 18px" }}>
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 bottom-1.5"
                  style={{ width: 1, background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.10), transparent)" }}
                />
                <div
                  className="text-white"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: "-0.028em",
                    lineHeight: 1,
                    fontFeatureSettings: '"tnum"',
                  }}
                >
                  38
                </div>
                <div className="text-[10px] uppercase font-semibold mt-2" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.22em" }}>
                  Desks queued
                </div>
              </div>
              <div className="relative" style={{ padding: "0 18px" }}>
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 bottom-1.5"
                  style={{ width: 1, background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.10), transparent)" }}
                />
                <div
                  className="text-white"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: "-0.028em",
                    lineHeight: 1,
                  }}
                >
                  Soon
                </div>
                <div className="text-[10px] uppercase font-semibold mt-2" style={{ color: "rgba(255,255,255,0.45)", letterSpacing: "0.22em" }}>
                  Mainnet launch
                </div>
              </div>
            </div>
          </div>

          <div
            className="relative z-[1] flex justify-between items-center flex-wrap gap-2.5 text-[11.5px]"
            style={{ color: "rgba(255,255,255,0.40)", letterSpacing: "0.04em" }}
          >
            <span>Escrow-protected · On-chain settlement</span>
          </div>
        </section>

        {/* RIGHT — login card. Holds every interactive piece: mode tabs,
            verification panels, form, submit, Google SSO, foot card. */}
        <aside
          className="bg-white flex items-start justify-center relative"
          style={{ padding: "36px 28px 44px" }}
        >
          {/* Hairline between panels (desktop only). */}
          <span
            aria-hidden
            className="hidden lg:block absolute top-0 bottom-0 left-0"
            style={{ width: 1, background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.06), transparent)" }}
          />

          <div className="w-full max-w-[420px] relative lg:mt-11">
            <span
              className="inline-flex items-center gap-2 text-[10.5px] uppercase font-semibold mb-[22px]"
              style={{
                color: "#cc785c",
                letterSpacing: "0.24em",
                background: "#f4e3d9",
                padding: "6px 12px",
                borderRadius: 999,
              }}
            >
              {isSignIn ? "Desk sign-in" : "New desk · sign up"}
            </span>

            <h2
              className="mb-2.5"
              style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: 34,
                letterSpacing: "-0.038em",
                lineHeight: 1.02,
                color: "#1d1d1f",
              }}
            >
              {isSignIn ? (
                <>
                  Sign in to{" "}
                  <em
                    style={{
                      fontFamily: "'Instrument Serif', Georgia, serif",
                      fontStyle: "italic",
                      fontWeight: 400,
                      color: "#cc785c",
                      fontSize: "1.08em",
                      letterSpacing: "-0.022em",
                    }}
                  >
                    run the book.
                  </em>
                </>
              ) : (
                <>
                  Create your{" "}
                  <em
                    style={{
                      fontFamily: "'Instrument Serif', Georgia, serif",
                      fontStyle: "italic",
                      fontWeight: 400,
                      color: "#cc785c",
                      fontSize: "1.08em",
                      letterSpacing: "-0.022em",
                    }}
                  >
                    desk.
                  </em>
                </>
              )}
            </h2>
            <p
              className="text-[14.5px] mb-[30px]"
              style={{ color: "#3a3a3c", lineHeight: 1.6, letterSpacing: "-0.005em" }}
            >
              {isSignIn
                ? "Same login as your user account — switch surfaces any time."
                : "Spin up your operator account. Email verification next, KYB after sign-in."}
            </p>

            {/* Tabs — hidden during the verification gate (switching modes
                there has no effect). */}
            {!auth.pendingVerificationEmail && (
              <div className="flex p-1 rounded-xl mb-5" style={{ background: "rgba(244,227,217,0.5)" }}>
                <button
                  type="button"
                  onClick={() => { auth.setAuthTab("signin"); auth.setLoginError(""); }}
                  className="flex-1 py-2 rounded-lg text-[13px] font-medium transition-all"
                  style={{
                    background: isSignIn ? "#ffffff" : "transparent",
                    color: isSignIn ? "#1d1d1f" : "#6b675f",
                    boxShadow: isSignIn ? "0 1px 2px rgba(60,40,30,0.06)" : "none",
                  }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => { auth.setAuthTab("create"); auth.setLoginError(""); }}
                  className="flex-1 py-2 rounded-lg text-[13px] font-medium transition-all"
                  style={{
                    background: !isSignIn ? "#ffffff" : "transparent",
                    color: !isSignIn ? "#1d1d1f" : "#6b675f",
                    boxShadow: !isSignIn ? "0 1px 2px rgba(60,40,30,0.06)" : "none",
                  }}
                >
                  Create Account
                </button>
              </div>
            )}

            {/* Post-signup verification gate — replaces the form until the
                merchant clicks the email link (or it gets flipped verified
                by the poller in useDashboardAuth). */}
            {auth.pendingVerificationEmail ? (
              auth.pendingVerificationVerified ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-5 py-2"
                >
                  <div className="flex justify-center">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center"
                      style={{ background: "rgba(63,174,106,0.1)" }}
                    >
                      <CheckCircle2 className="w-8 h-8" style={{ color: "#3fae6a" }} />
                    </div>
                  </div>
                  <div className="text-center space-y-2">
                    <p className="text-base font-semibold" style={{ color: "#1d1d1f" }}>
                      Business email verified
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: "#3a3a3c" }}>
                      <span className="font-semibold break-all" style={{ color: "#1d1d1f" }}>
                        {auth.pendingVerificationEmail}
                      </span>{" "}
                      is confirmed. Your merchant account is ready.
                    </p>
                  </div>

                  <div
                    className="rounded-xl px-4 py-3 flex items-start gap-3"
                    style={{ background: "rgba(63,174,106,0.06)", border: "1px solid rgba(63,174,106,0.2)" }}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#3fae6a" }} />
                    <p className="text-[11px] leading-relaxed" style={{ color: "#3a3a3c" }}>
                      A verified business email lets us reach you for compliance checks and protects your account from impersonation.
                    </p>
                  </div>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      auth.clearPendingVerification();
                      auth.setAuthTab("signin");
                    }}
                    className="w-full py-3.5 rounded-xl text-[14.5px] font-semibold flex items-center justify-center gap-2 transition-colors hover:bg-black"
                    style={{ background: "#1d1d1f", color: "#ffffff", letterSpacing: "-0.005em" }}
                  >
                    Continue to sign in
                    <span aria-hidden>→</span>
                  </motion.button>
                </motion.div>
              ) : (
                <div className="space-y-3.5">
                  <div
                    className="rounded-xl p-4 flex gap-3"
                    style={{ background: "rgba(63,174,106,0.06)", border: "1px solid rgba(63,174,106,0.25)" }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(63,174,106,0.15)" }}
                    >
                      <Mail className="w-4 h-4" style={{ color: "#3fae6a" }} />
                    </div>
                    <div className="text-[13px] leading-relaxed" style={{ color: "#1d1d1f" }}>
                      <p>
                        We sent a verification link to{" "}
                        <span className="font-semibold break-all">
                          {auth.pendingVerificationEmail}
                        </span>
                        .
                      </p>
                      <p className="mt-1" style={{ color: "#3a3a3c" }}>
                        Click the link in that email to activate your account. This screen updates automatically as soon as we detect the verification.
                      </p>
                    </div>
                  </div>

                  <p className="text-[12px] flex items-center gap-2" style={{ color: "#6b675f" }}>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#6b675f" }} />
                    Waiting for verification…
                  </p>

                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={auth.resendVerificationEmail}
                    disabled={auth.isResendingVerification || auth.verificationCooldownSeconds > 0}
                    className="w-full py-2.5 rounded-lg text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors hover:border-[#1d1d1f]"
                    style={{ background: "#fdfbf7", border: "1px solid #dcd4c5", color: "#1d1d1f" }}
                  >
                    {auth.isResendingVerification ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending…
                      </>
                    ) : auth.verificationCooldownSeconds > 0 ? (
                      `Resend available in ${auth.verificationCooldownSeconds}s`
                    ) : (
                      "Resend verification email"
                    )}
                  </motion.button>

                  <p className="text-[11px] text-center" style={{ color: "#6b675f" }}>
                    Didn&apos;t get it? Check spam. Links expire after 24 hours.
                  </p>
                </div>
              )
            ) : (
              <>
                {/* Polling-detected verification banner. */}
                {isSignIn && auth.verificationSuccessNotice && (
                  <div
                    className="mb-4 rounded-xl px-4 py-3 flex items-start gap-3"
                    style={{ background: "#eaf8ef", border: "1px solid rgba(63,174,106,0.3)" }}
                  >
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "#3fae6a" }} />
                    <div className="flex-1 text-[13px]" style={{ color: "#1d1d1f" }}>
                      <span className="font-semibold" style={{ color: "#3fae6a" }}>Email verified.</span>{" "}
                      Sign in below to continue.
                    </div>
                    <button
                      type="button"
                      onClick={auth.dismissVerificationSuccess}
                      aria-label="Dismiss"
                      className="text-lg leading-none px-1"
                      style={{ color: "#6b675f" }}
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* Error banners — EMAIL_NOT_VERIFIED variant gets a copper
                    treatment to match the page palette. */}
                {auth.loginError === "EMAIL_NOT_VERIFIED" && !auth.verificationSuccessNotice ? (
                  <div
                    className="mb-4 rounded-xl p-3.5 text-sm space-y-2"
                    style={{ background: "#fef6e4", border: "1px solid rgba(204,120,92,0.3)", color: "#7a4327" }}
                  >
                    <p className="font-medium">Verify your email before signing in.</p>
                    <p className="text-xs" style={{ color: "rgba(122,67,39,0.8)" }}>
                      We just sent a fresh verification link to your inbox. Click it, then come back to sign in.
                    </p>
                    <button
                      type="button"
                      onClick={auth.resendVerificationEmail}
                      disabled={auth.isResendingVerification || auth.verificationCooldownSeconds > 0}
                      className="mt-1 w-full py-2 rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                      style={{ background: "rgba(204,120,92,0.1)", border: "1px solid rgba(204,120,92,0.3)", color: "#7a4327" }}
                    >
                      {auth.isResendingVerification ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
                      ) : auth.verificationCooldownSeconds > 0 ? (
                        `Resend available in ${auth.verificationCooldownSeconds}s`
                      ) : (
                        "Resend verification email"
                      )}
                    </button>
                  </div>
                ) : auth.loginError && !auth.verificationSuccessNotice ? (
                  <div
                    className="mb-4 rounded-xl p-3.5 text-sm"
                    style={{ background: "#fdecea", border: "1px solid rgba(229,72,77,0.3)", color: "#a31b1f" }}
                  >
                    {auth.loginError}
                  </div>
                ) : null}

                <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
                  {!isSignIn && (
                    <div>
                      <label
                        className="block text-[10.5px] uppercase font-semibold mb-2"
                        style={{ color: "#6b675f", letterSpacing: "0.18em" }}
                      >
                        Business Name
                      </label>
                      <input
                        type="text"
                        value={auth.registerForm.businessName}
                        onChange={(e) =>
                          auth.setRegisterForm({ ...auth.registerForm, businessName: e.target.value })
                        }
                        placeholder="Your desk name"
                        maxLength={100}
                        className="w-full rounded-xl px-4 py-[13px] text-[15px] outline-none transition-all bg-[#fdfbf7] focus:bg-white focus:border-[#cc785c] focus:shadow-[0_0_0_4px_rgba(204,120,92,0.12)] text-[#1d1d1f] placeholder:text-[#6b675f]/55 border border-[#dcd4c5]"
                      />
                    </div>
                  )}

                  <div>
                    <label
                      className="block text-[10.5px] uppercase font-semibold mb-2"
                      style={{ color: "#6b675f", letterSpacing: "0.18em" }}
                    >
                      {isSignIn ? "Email or Username" : "Desk email"}
                    </label>
                    <input
                      type={isSignIn ? "text" : "email"}
                      autoComplete={isSignIn ? "username" : "email"}
                      inputMode={isSignIn ? "email" : undefined}
                      value={isSignIn ? auth.loginForm.email : auth.registerForm.email}
                      onChange={(e) =>
                        isSignIn
                          ? auth.setLoginForm({ ...auth.loginForm, email: e.target.value })
                          : auth.setRegisterForm({ ...auth.registerForm, email: e.target.value })
                      }
                      placeholder={isSignIn ? "you@business.com or username" : "desk@business.com"}
                      autoCapitalize="none"
                      autoCorrect="off"
                      maxLength={254}
                      className="w-full rounded-xl px-4 py-[13px] text-[15px] outline-none transition-all bg-[#fdfbf7] focus:bg-white focus:border-[#cc785c] focus:shadow-[0_0_0_4px_rgba(204,120,92,0.12)] text-[#1d1d1f] placeholder:text-[#6b675f]/55 border border-[#dcd4c5]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label
                        className="block text-[10.5px] uppercase font-semibold"
                        style={{ color: "#6b675f", letterSpacing: "0.18em" }}
                      >
                        Password
                      </label>
                      {/* Forgot-password — sign-in only. The reset link
                          is gated to merchants who actually have a
                          password set (SSO-only desks have nothing to
                          reset and the backend rejects). */}
                      {isSignIn && (
                        <Link
                          href="/merchant/forgot-password"
                          className="text-[12px] font-medium transition-colors hover:text-[#cc785c]"
                          style={{ color: "#3a3a3c" }}
                        >
                          Forgot password?
                        </Link>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={isSignIn ? auth.loginForm.password : auth.registerForm.password}
                        onChange={(e) =>
                          isSignIn
                            ? auth.setLoginForm({ ...auth.loginForm, password: e.target.value })
                            : auth.setRegisterForm({ ...auth.registerForm, password: e.target.value })
                        }
                        placeholder={isSignIn ? "••••••••" : "Min 12 characters"}
                        maxLength={100}
                        className="w-full rounded-xl pl-4 pr-11 py-[13px] text-[15px] outline-none transition-all bg-[#fdfbf7] focus:bg-white focus:border-[#cc785c] focus:shadow-[0_0_0_4px_rgba(204,120,92,0.12)] text-[#1d1d1f] placeholder:text-[#6b675f]/55 border border-[#dcd4c5]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors hover:text-[#1d1d1f]"
                        style={{ color: "#6b675f" }}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {!isSignIn && (
                    <div>
                      <label
                        className="block text-[10.5px] uppercase font-semibold mb-2"
                        style={{ color: "#6b675f", letterSpacing: "0.18em" }}
                      >
                        Confirm Password
                      </label>
                      <input
                        type={showPassword ? "text" : "password"}
                        value={auth.registerForm.confirmPassword}
                        onChange={(e) =>
                          auth.setRegisterForm({ ...auth.registerForm, confirmPassword: e.target.value })
                        }
                        placeholder="Min 12 characters"
                        maxLength={100}
                        className="w-full rounded-xl px-4 py-[13px] text-[15px] outline-none transition-all bg-[#fdfbf7] focus:bg-white focus:border-[#cc785c] focus:shadow-[0_0_0_4px_rgba(204,120,92,0.12)] text-[#1d1d1f] placeholder:text-[#6b675f]/55 border border-[#dcd4c5]"
                      />
                    </div>
                  )}

                  <motion.button
                    type="submit"
                    whileTap={{ scale: 0.98 }}
                    disabled={isDisabled}
                    className="w-full py-[14px] rounded-xl text-[14.5px] font-semibold flex items-center justify-center gap-2 transition-all mt-2"
                    style={{
                      background: isDisabled ? "rgba(220,212,197,0.5)" : "#1d1d1f",
                      color: isDisabled ? "rgba(107,103,95,0.7)" : "#ffffff",
                      cursor: isDisabled ? "not-allowed" : "pointer",
                      boxShadow: isDisabled
                        ? "none"
                        : "0 12px 30px -14px rgba(15,15,15,0.50), 0 1px 0 rgba(255,255,255,0.10) inset",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {isSignIn ? "Signing in…" : "Creating…"}
                      </>
                    ) : (
                      <>
                        {isSignIn ? "Login as Merchant" : "Register as Merchant"}
                        <span aria-hidden>→</span>
                      </>
                    )}
                  </motion.button>
                </form>

                {/* Or + Google */}
                <div
                  className="flex items-center gap-3 text-[10px] uppercase font-semibold"
                  style={{ margin: "20px 0", color: "#6b675f", letterSpacing: "0.20em" }}
                >
                  <span className="flex-1 h-px" style={{ background: "#ece6dc" }} />
                  or
                  <span className="flex-1 h-px" style={{ background: "#ece6dc" }} />
                </div>
                <GoogleSignInButton
                  role="merchant"
                  source={isSignIn ? "merchant_login_google" : "merchant_register_google"}
                  theme="light"
                  onSuccess={handleGoogleSuccess}
                  onError={(msg) => auth.setLoginError(msg)}
                  disabled={isLoading}
                />

                <p
                  className="text-center text-[11.5px] mt-5"
                  style={{ color: "#6b675f" }}
                >
                  Run your desk · control spreads · earn on every trade
                </p>

                {/* Foot card — user-app crosslink. Previously a sky-blue
                    promo tile aimed at converting merchants to user mode;
                    here it's a subtle underline link to match the
                    showcase's "Apply to run one" treatment. */}
                <div
                  className="mt-[14px] pt-[14px] text-[12.5px] text-center"
                  style={{ borderTop: "1px solid #ece6dc", color: "#6b675f" }}
                >
                  Just want to trade?{" "}
                  <Link
                    href="/login"
                    className="font-medium transition-colors hover:text-[#cc785c]"
                    style={{ color: "#1d1d1f", borderBottom: "1px solid #dcd4c5" }}
                  >
                    Sign in as User →
                  </Link>
                </div>
              </>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
