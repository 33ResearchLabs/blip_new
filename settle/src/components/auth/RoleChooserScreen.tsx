"use client";

/**
 * RoleChooserScreen — the "Choose your portal" splash.
 *
 * Standalone version of the welcome chooser previously embedded inside
 * `LandingPage`. Rendered at `/login` so the marketing landing at `/` can
 * stay clean. Picking "User" deep-links into `/?welcome=skip&tab=signin`
 * (the auth form view inside `LandingPage`), picking "Merchant" goes to
 * `/merchant/login?tab=signin`.
 *
 * Carries no auth-state props — clicking a tile is a pure navigation; the
 * downstream route owns the form + session setup.
 */

import { motion } from "framer-motion";
import { ArrowRight, Store, User } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/shared/Logo";
import { usePwaContext } from "@/hooks/usePwaContext";

export function RoleChooserScreen() {
  // Hide the merchant tile when running as the User PWA — merchant routes
  // are blocked by PwaAppGuard anyway, so the tile would be a dead-end.
  const pwa = usePwaContext();
  const hideMerchantLinks = pwa.standalone && pwa.app === "user";

  return (
    <div
      className="relative flex-1 w-full h-dvh flex flex-col items-center justify-center px-6 py-10 sm:py-16 overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(120,119,198,0.18), transparent 60%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(56,189,248,0.14), transparent 60%), radial-gradient(ellipse 60% 50% at 0% 100%, rgba(168,247,98,0.12), transparent 60%), #0B0F14",
      }}
    >
      {/* Conic mesh gradient */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "conic-gradient(from 180deg at 50% 50%, rgba(168,247,98,0.08) 0deg, rgba(56,189,248,0.10) 90deg, rgba(120,119,198,0.10) 180deg, rgba(244,114,182,0.06) 270deg, rgba(168,247,98,0.08) 360deg)",
          filter: "blur(80px)",
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
      />

      {/* Noise overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.025] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: -6, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mb-2"
      >
        <Logo onDark />
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.6 }}
        className="relative z-10 text-[11px] font-medium tracking-[0.3em] uppercase text-white/40 mb-8 sm:mb-12"
      >
        Choose your portal
      </motion.p>

      <div
        className={`relative z-10 w-full max-w-[720px] grid gap-4 ${
          hideMerchantLinks ? "grid-cols-1 max-w-[360px]" : "grid-cols-1 sm:grid-cols-2"
        }`}
      >
        {(
          [
            {
              // User tile drops the visitor straight onto the auth form
              // inside LandingPage at `/`. Going through /login would
              // bounce them back to this chooser — infinite loop.
              href: "/?welcome=skip&tab=signin",
              label: "User",
              sub: "Buy & sell crypto",
              Icon: User,
              glow: "rgba(168,247,98,0.55)",
              delay: 0.35,
            },
            ...(hideMerchantLinks
              ? []
              : [
                  {
                    href: "/merchant/login?tab=signin",
                    label: "Merchant",
                    sub: "Run a P2P desk",
                    Icon: Store,
                    glow: "rgba(120,119,198,0.55)",
                    delay: 0.45,
                  },
                ]),
          ] as const
        ).map(({ href, label, sub, Icon, glow, delay }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <Link href={href} className="group block">
              <motion.div
                whileHover={{ y: -6 }}
                whileTap={{ scale: 0.985 }}
                transition={{ type: "spring", stiffness: 280, damping: 22 }}
                className="relative rounded-[22px] p-[1.5px] overflow-hidden"
                style={{
                  background:
                    "linear-gradient(140deg, rgba(255,255,255,0.35), rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.25) 100%)",
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -inset-px rounded-[22px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    background: `radial-gradient(circle at 50% 0%, ${glow}, transparent 65%)`,
                    filter: "blur(20px)",
                  }}
                />

                <div
                  className="relative rounded-[21px] p-5 sm:p-7 backdrop-blur-2xl"
                  style={{
                    background:
                      "linear-gradient(160deg, rgba(28,28,32,0.92), rgba(18,18,22,0.85) 60%)",
                    boxShadow:
                      "inset 0 1px 0 rgba(255,255,255,0.12), 0 30px 60px -20px rgba(0,0,0,0.6)",
                  }}
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-1/2 -left-1/2 w-[200%] h-[200%] opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                    style={{
                      background:
                        "conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(255,255,255,0.10) 60deg, transparent 120deg)",
                      animation: "spin 6s linear infinite",
                    }}
                  />

                  <div className="relative flex items-start justify-between">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center backdrop-blur-md"
                      style={{
                        background:
                          "linear-gradient(140deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
                        boxShadow:
                          "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.2)",
                      }}
                    >
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <motion.div
                      className="w-9 h-9 rounded-full flex items-center justify-center border border-border-subtle bg-white/[0.04]"
                      whileHover={{ rotate: -45 }}
                      transition={{ type: "spring", stiffness: 260, damping: 16 }}
                    >
                      <ArrowRight className="w-4 h-4 text-white" />
                    </motion.div>
                  </div>

                  <div className="relative mt-6 sm:mt-10">
                    <p className="text-[10px] font-medium tracking-[0.25em] uppercase text-white/40 mb-1.5">
                      Continue as
                    </p>
                    <p className="text-[24px] sm:text-[28px] font-semibold leading-none tracking-[-0.03em] text-white">
                      {label}
                    </p>
                    <p className="text-[12px] sm:text-[13px] mt-2 text-white/55 font-light">
                      {sub}
                    </p>
                  </div>
                </div>
              </motion.div>
            </Link>
          </motion.div>
        ))}
      </div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.6 }}
        className="relative z-10 mt-8 sm:mt-12 text-[10px] font-mono tracking-[0.2em] text-white/40 flex items-center gap-3"
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
        ESCROW-PROTECTED · ON-CHAIN SETTLEMENT
      </motion.p>
    </div>
  );
}
