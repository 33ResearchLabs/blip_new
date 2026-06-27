"use client";

import { motion } from "framer-motion";
import { Gift, UserPlus, ArrowRight } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * RewardsHeroBanner
 * --------------------------------------------------------------------------
 * Compact "Refer & Earn" promo card for the Rewards page. The page title and
 * notification bell live OUTSIDE this card (in the screen header); this card
 * carries the pitch: subtitle, the reward highlight and the CTAs.
 *
 * Fully theme-aware — surfaces / text / borders flow from the scoped
 * `.user-scope` tokens (dark default + `.user-light`), so the dark variant is
 * a dedicated treatment, not a CSS invert. The reward text is monochrome and
 * the primary CTA uses the app's `bg-white`/`text-black` flip pattern (white
 * pill in dark, dark pill in light). All copy is prop-driven.
 * ────────────────────────────────────────────────────────────────────────── */

export interface RewardsHeroBannerProps {
  /** Short descriptive lead line. */
  subtitle?: string;
  /** Highlighted reward — the part the user earns. */
  youEarn?: string;
  /** Highlighted reward — the part the friend gets. */
  theyGet?: string;
  /** Primary CTA label. */
  primaryLabel?: string;
  /** Secondary CTA label. Pass `null` to hide the secondary button. */
  secondaryLabel?: string | null;
  onPrimary?: () => void;
  onSecondary?: () => void;
  /** Extra classes for the outer section (e.g. spacing from the parent). */
  className?: string;
}

export const RewardsHeroBanner = ({
  subtitle = "Invite friends. Earn more.",
  youEarn = "You earn 20%",
  theyGet = "They get 10% off",
  primaryLabel = "Invite Friends",
  secondaryLabel = "How it works",
  onPrimary,
  onSecondary,
  className = "",
}: RewardsHeroBannerProps) => {
  return (
    <motion.section
      aria-label="Refer and earn"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-[24px] border border-border-subtle bg-surface-card p-6 sm:p-7 ${className}`}
      style={{
        boxShadow:
          "0 24px 50px -30px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* ── Ambient background: soft brand wash + dotted texture ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-90 [.user-light_&]:opacity-70"
          style={{
            background:
              "radial-gradient(120% 120% at 92% 8%, rgba(251,140,59,0.18) 0%, rgba(251,140,59,0.04) 40%, transparent 66%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            color: "var(--color-text-primary)",
          }}
        />
      </div>

      <div className="relative z-10">
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="text-[14px] font-medium text-text-secondary sm:text-[15px]"
        >
          {subtitle}
        </motion.p>

        {/* Reward highlight — monochrome */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12 }}
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[16px] font-extrabold tracking-[-0.01em] text-text-primary sm:text-[18px]"
        >
          <span>{youEarn}</span>
          <span aria-hidden="true" className="text-text-quaternary">
            •
          </span>
          <span>{theyGet}</span>
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18 }}
          className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center"
        >
          {/* Primary CTA — monochrome pill. The scoped `.user-light` override
              (`.bg-white.text-black`) flips this to a dark pill with white text
              in light mode; dark mode keeps the white pill. */}
          <motion.button
            type="button"
            onClick={onPrimary}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3.5 text-[14px] font-bold text-black shadow-[0_16px_34px_-16px_rgba(0,0,0,0.55)]"
          >
            <UserPlus className="h-[18px] w-[18px]" strokeWidth={2.2} />
            {primaryLabel}
            <ArrowRight
              className="h-[16px] w-[16px] transition-transform duration-300 group-hover:translate-x-0.5"
              strokeWidth={2.4}
            />
          </motion.button>

          {secondaryLabel && (
            <motion.button
              type="button"
              onClick={onSecondary}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-border-medium bg-surface-raised/70 px-5 py-3.5 text-[14px] font-bold text-text-primary backdrop-blur-md transition-colors hover:bg-surface-hover"
            >
              <Gift className="h-[17px] w-[17px] text-text-secondary" strokeWidth={2} />
              {secondaryLabel}
            </motion.button>
          )}
        </motion.div>
      </div>
    </motion.section>
  );
};

export default RewardsHeroBanner;
