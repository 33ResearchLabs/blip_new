"use client";

import { useRef, type PointerEvent } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from "framer-motion";
import { Bell, Gift, UserPlus, Sparkles, ArrowRight } from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
 * RewardsHeroBanner
 * --------------------------------------------------------------------------
 * Premium Web3/FinTech "Refer & Earn" hero for the top of the Rewards page.
 *
 * Recreated from a design reference (not the image itself). Two-column on
 * desktop / tablet (content left, 3D gift illustration right), stacks on
 * mobile. Fully theme-aware: surfaces, text, borders and shadows flow from
 * the scoped `.user-scope` tokens (dark default + `.user-light`), so the
 * dark variant is a dedicated treatment — not a CSS invert. The brand-orange
 * accent (BLIP / marketing palette) carries the reward highlight, the floating
 * coins and the primary CTA in both themes.
 *
 * All copy is prop-driven; sensible defaults mirror the reference.
 * ────────────────────────────────────────────────────────────────────────── */

// Brand accent (BLIP marketing orange) — kept here as constants so the whole
// banner re-tones from one place. Used for the reward highlight, the coins and
// the primary CTA gradient.
const BRAND = {
  light: "#FFB45C",
  base: "#FB8C3B",
  deep: "#F4731E",
  glow: "rgba(251,140,59,0.45)",
} as const;

export interface RewardsHeroBannerProps {
  /** Small uppercase eyebrow above the heading. */
  eyebrow?: string;
  /** Large bold heading. */
  heading?: string;
  /** Short descriptive subtitle under the heading. */
  subtitle?: string;
  /** Highlighted reward — the part the user earns (accent-coloured). */
  youEarn?: string;
  /** Highlighted reward — the part the friend gets (accent-coloured). */
  theyGet?: string;
  /** Primary CTA label. */
  primaryLabel?: string;
  /** Secondary CTA label. Pass `null` to hide the secondary button. */
  secondaryLabel?: string | null;
  onPrimary?: () => void;
  onSecondary?: () => void;
  /** Optional bell (top-right, as in the reference). Omit handler to hide it. */
  onNotificationsClick?: () => void;
  notificationCount?: number;
  /** Extra classes for the outer section (e.g. spacing from the parent). */
  className?: string;
}

// ─── Decorative: a single floating BLIP coin ─────────────────────────────────
// Pure CSS/SVG — no images. Orange disc, embossed rim, bold "B" glyph.
interface CoinProps {
  size: number;
  className?: string;
  /** Per-coin float distance + timing so the cluster never moves in lockstep. */
  floatY?: number;
  duration?: number;
  delay?: number;
  /** Parallax depth (px of travel at the pointer extremes). */
  depth?: number;
  parallaxX: MotionValue<number>;
  parallaxY: MotionValue<number>;
  reduced?: boolean;
}

const Coin = ({
  size,
  className = "",
  floatY = 8,
  duration = 4,
  delay = 0,
  depth = 0,
  parallaxX,
  parallaxY,
  reduced = false,
}: CoinProps) => {
  // Each coin reads the shared pointer signal at its own depth.
  const tx = useTransform(parallaxX, (v: number) => v * depth);
  const ty = useTransform(parallaxY, (v: number) => v * depth);

  return (
    <motion.div
      aria-hidden="true"
      className={`absolute ${className}`}
      style={{ width: size, height: size, x: tx, y: ty }}
    >
      <motion.div
        className="w-full h-full"
        animate={reduced ? undefined : { y: [0, -floatY, 0], rotate: [0, 2.5, 0] }}
        transition={
          reduced
            ? undefined
            : { duration, delay, repeat: Infinity, ease: "easeInOut" }
        }
      >
        <div
          className="relative w-full h-full rounded-full flex items-center justify-center"
          style={{
            background: `radial-gradient(120% 120% at 30% 22%, ${BRAND.light} 0%, ${BRAND.base} 46%, ${BRAND.deep} 100%)`,
            boxShadow: `0 ${size * 0.16}px ${size * 0.36}px -${size * 0.12}px ${BRAND.glow}, inset 0 1.5px 2px rgba(255,255,255,0.55), inset 0 -2px 4px rgba(120,50,0,0.45)`,
          }}
        >
          {/* inner rim */}
          <div className="absolute inset-[12%] rounded-full border border-white/30" />
          <span
            className="font-extrabold leading-none select-none"
            style={{
              fontSize: size * 0.5,
              color: "rgba(60,24,0,0.92)",
              textShadow: "0 1px 0 rgba(255,255,255,0.35)",
            }}
          >
            B
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ─── Decorative: the 3D gift box ─────────────────────────────────────────────
const GiftBox = ({ reduced }: { reduced: boolean }) => (
  <motion.div
    aria-hidden="true"
    className="relative w-[150px] h-[150px] sm:w-[170px] sm:h-[170px]"
    animate={reduced ? undefined : { y: [0, -10, 0] }}
    transition={
      reduced ? undefined : { duration: 5, repeat: Infinity, ease: "easeInOut" }
    }
  >
    {/* contact shadow */}
    <div
      className="absolute left-1/2 bottom-1 h-4 w-[70%] -translate-x-1/2 rounded-[50%] blur-md"
      style={{ background: "rgba(0,0,0,0.35)" }}
    />
    {/* box body */}
    <div
      className="absolute left-1/2 bottom-[14%] h-[58%] w-[68%] -translate-x-1/2 rounded-[18px]"
      style={{
        background:
          "linear-gradient(150deg, #3a3f47 0%, #23262c 55%, #15171b 100%)",
        boxShadow:
          "inset 0 2px 0 rgba(255,255,255,0.10), inset 0 -10px 22px rgba(0,0,0,0.5), 0 22px 40px -18px rgba(0,0,0,0.6)",
      }}
    />
    {/* lid */}
    <div
      className="absolute left-1/2 top-[20%] h-[24%] w-[80%] -translate-x-1/2 rounded-[14px]"
      style={{
        background:
          "linear-gradient(150deg, #474c55 0%, #2b2f36 60%, #1c1f24 100%)",
        boxShadow:
          "inset 0 2px 0 rgba(255,255,255,0.14), 0 10px 18px -8px rgba(0,0,0,0.55)",
      }}
    />
    {/* vertical ribbon */}
    <div
      className="absolute left-1/2 top-[20%] h-[52%] w-[16%] -translate-x-1/2 rounded-sm"
      style={{
        background: `linear-gradient(180deg, ${BRAND.light}, ${BRAND.deep})`,
        boxShadow: `0 0 18px -2px ${BRAND.glow}`,
      }}
    />
    {/* horizontal ribbon */}
    <div
      className="absolute left-[10%] top-[30%] h-[14%] w-[80%] rounded-sm"
      style={{
        background: `linear-gradient(90deg, ${BRAND.deep}, ${BRAND.base}, ${BRAND.deep})`,
      }}
    />
    {/* bow — two looped lobes via SVG for clean curves */}
    <svg
      className="absolute left-1/2 top-[2%] h-[26%] w-[58%] -translate-x-1/2"
      viewBox="0 0 100 50"
      fill="none"
    >
      <defs>
        <linearGradient id="bowGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND.light} />
          <stop offset="1" stopColor={BRAND.deep} />
        </linearGradient>
      </defs>
      <path
        d="M50 38 C30 38 8 30 12 14 C15 4 34 6 44 24 C47 30 50 34 50 38Z"
        fill="url(#bowGrad)"
      />
      <path
        d="M50 38 C70 38 92 30 88 14 C85 4 66 6 56 24 C53 30 50 34 50 38Z"
        fill="url(#bowGrad)"
      />
      <circle cx="50" cy="36" r="6" fill={BRAND.base} />
    </svg>
  </motion.div>
);

// ─── Hero ────────────────────────────────────────────────────────────────────
export const RewardsHeroBanner = ({
  eyebrow = "Rewards",
  heading = "Refer & Earn",
  subtitle = "Invite friends. Earn more.",
  youEarn = "You earn 20%",
  theyGet = "They get 10% off",
  primaryLabel = "Invite Friends",
  secondaryLabel = "How it works",
  onPrimary,
  onSecondary,
  onNotificationsClick,
  notificationCount = 0,
  className = "",
}: RewardsHeroBannerProps) => {
  const reduced = useReducedMotion() ?? false;

  // Shared pointer signal → subtle parallax across the illustration layers.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const px = useSpring(pointerX, { stiffness: 120, damping: 22, mass: 0.4 });
  const py = useSpring(pointerY, { stiffness: 120, damping: 22, mass: 0.4 });
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    pointerX.set((e.clientX - r.left) / r.width - 0.5);
    pointerY.set((e.clientY - r.top) / r.height - 0.5);
  };
  const resetPointer = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  // Parallax layers — hoisted so the hooks run unconditionally at top level.
  const haloX = useTransform(px, (v) => v * 8);
  const haloY = useTransform(py, (v) => v * 8);
  const boxX = useTransform(px, (v) => v * 14);
  const boxY = useTransform(py, (v) => v * 14);

  return (
    <motion.section
      aria-labelledby="rewards-hero-heading"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={`relative overflow-hidden rounded-[28px] border border-border-subtle bg-surface-card ${className}`}
      style={{
        boxShadow:
          "0 30px 60px -32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* ── Ambient background: soft brand gradient + blurred blobs ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {/* base wash — warmer/brighter in dark, whisper-soft on cream */}
        <div
          className="absolute inset-0 opacity-90 [.user-light_&]:opacity-70"
          style={{
            background:
              "radial-gradient(130% 120% at 88% 12%, rgba(251,140,59,0.20) 0%, rgba(251,140,59,0.05) 38%, transparent 64%)",
          }}
        />
        {/* glow blob behind the gift */}
        <div
          className="absolute -right-10 top-2 h-56 w-56 rounded-full blur-3xl opacity-70 [.user-light_&]:opacity-40"
          style={{ background: BRAND.glow }}
        />
        {/* cool counter-blob for depth */}
        <div
          className="absolute -left-16 -bottom-16 h-56 w-56 rounded-full blur-3xl opacity-40 [.user-light_&]:opacity-25"
          style={{ background: "rgba(96,165,250,0.25)" }}
        />
        {/* faint dotted grid for texture */}
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

      {/* ── Optional notification bell (top-right, mirrors the reference) ── */}
      {onNotificationsClick && (
        <motion.button
          whileTap={{ scale: 0.92 }}
          whileHover={{ y: -1 }}
          onClick={onNotificationsClick}
          aria-label={
            notificationCount > 0
              ? `Notifications, ${notificationCount} unread`
              : "Notifications"
          }
          className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-[14px] border border-border-subtle bg-surface-raised/80 backdrop-blur-md transition-colors hover:bg-surface-hover"
        >
          <Bell className="h-[18px] w-[18px] text-text-primary" strokeWidth={2} />
          {notificationCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full border-2 border-surface-card px-1"
              style={{ background: BRAND.deep }}
            >
              <span className="text-[8px] font-extrabold leading-none text-white">
                {notificationCount > 9 ? "9+" : notificationCount}
              </span>
            </span>
          )}
        </motion.button>
      )}

      {/* ── Two-column layout: content + illustration ── */}
      <div className="relative z-10 grid grid-cols-1 items-center gap-6 p-6 sm:p-8 md:grid-cols-[1.1fr_0.9fr] md:gap-4 lg:p-10">
        {/* ── Left: content ── */}
        <div className="min-w-0">
          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-raised/70 px-3 py-1 backdrop-blur-sm"
          >
            <Sparkles className="h-3 w-3" style={{ color: BRAND.base }} strokeWidth={2.2} />
            <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-text-tertiary">
              {eyebrow}
            </span>
          </motion.span>

          <motion.h2
            id="rewards-hero-heading"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="mt-4 text-[34px] font-extrabold leading-[1.04] tracking-[-0.03em] text-text-primary sm:text-[42px] lg:text-[48px]"
          >
            {heading}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16 }}
            className="mt-2.5 max-w-sm text-[14px] font-medium leading-relaxed text-text-secondary sm:text-[15px]"
          >
            {subtitle}
          </motion.p>

          {/* Reward highlight */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.22 }}
            className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-extrabold tracking-[-0.01em] text-text-primary sm:text-[16px]"
          >
            <span>{youEarn}</span>
            <span aria-hidden="true" className="text-text-quaternary">
              •
            </span>
            <span>{theyGet}</span>
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.28 }}
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            {/* Primary CTA — monochrome pill. The scoped `.user-light`
                override (`.bg-white.text-black`) flips this to a dark pill with
                white text in light mode; dark mode keeps the white pill. */}
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

        {/* ── Right: illustration ── */}
        <div
          ref={ref}
          onPointerMove={handlePointerMove}
          onPointerLeave={resetPointer}
          className="relative mx-auto flex h-[200px] w-full max-w-[320px] items-center justify-center sm:h-[230px] md:h-[250px]"
        >
          {/* halo ring behind the gift */}
          <motion.div
            aria-hidden="true"
            className="absolute h-[200px] w-[200px] rounded-full border border-border-subtle"
            animate={reduced ? undefined : { rotate: 360 }}
            transition={
              reduced ? undefined : { duration: 50, repeat: Infinity, ease: "linear" }
            }
            style={{ x: haloX, y: haloY }}
          />

          {/* gift box (center, deepest parallax) */}
          <motion.div className="relative z-10" style={{ x: boxX, y: boxY }}>
            <GiftBox reduced={reduced} />
          </motion.div>

          {/* floating coins */}
          <Coin
            size={56}
            className="left-0 bottom-6 z-20"
            floatY={10}
            duration={4.2}
            delay={0}
            depth={34}
            parallaxX={px}
            parallaxY={py}
            reduced={reduced}
          />
          <Coin
            size={40}
            className="right-2 bottom-2 z-20"
            floatY={8}
            duration={3.6}
            delay={0.4}
            depth={26}
            parallaxX={px}
            parallaxY={py}
            reduced={reduced}
          />
          <Coin
            size={30}
            className="right-6 top-4 z-0 opacity-90"
            floatY={7}
            duration={5}
            delay={0.8}
            depth={18}
            parallaxX={px}
            parallaxY={py}
            reduced={reduced}
          />

          {/* confetti — small decorative shapes */}
          {[
            { c: BRAND.base, t: "8%", l: "16%", s: 7, r: 18 },
            { c: "#60a5fa", t: "20%", l: "78%", s: 6, r: -22 },
            { c: BRAND.light, t: "70%", l: "8%", s: 5, r: 30 },
            { c: "#34d399", t: "14%", l: "52%", s: 5, r: 12 },
          ].map((d, i) => (
            <motion.span
              key={i}
              aria-hidden="true"
              className="absolute rounded-[2px]"
              style={{
                top: d.t,
                left: d.l,
                width: d.s,
                height: d.s,
                background: d.c,
                rotate: `${d.r}deg`,
              }}
              animate={
                reduced ? undefined : { y: [0, -9, 0], opacity: [0.5, 1, 0.5] }
              }
              transition={
                reduced
                  ? undefined
                  : {
                      duration: 3 + i * 0.5,
                      delay: i * 0.3,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }
              }
            />
          ))}
        </div>
      </div>
    </motion.section>
  );
};

export default RewardsHeroBanner;
