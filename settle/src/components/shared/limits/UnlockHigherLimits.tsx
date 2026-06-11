"use client";

import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Smartphone,
  ScanFace,
  Coins,
  TrendingUp,
  Trophy,
  Check,
  ArrowRight,
} from "lucide-react";
import { PhoneVerificationSheet } from "@/components/user/PhoneVerificationSheet";
import { LivenessCheckSheet } from "@/components/user/LivenessCheckSheet";
import {
  ACTION_BTN,
  ACTION_ICON,
  type LimitsMe,
  type LimitsVariant,
  type SurfaceTokens,
  type XVerif,
} from "./types";

interface Props {
  variant: LimitsVariant;
  data: LimitsMe | null;
  xVerif: XVerif | null;
  surfaces: SurfaceTokens;
  /** Refetch limits (caps move after a verification completes). */
  onRefetch: () => void;
  onOpenStake: () => void;
  onOpenX: () => void;
}

type Tone = "green" | "violet" | "amber" | "blue";

function Row({
  icon,
  tone,
  title,
  desc,
  surfaces,
  action,
  badge,
}: {
  icon: ReactNode;
  tone: Tone;
  title: string;
  desc: string;
  surfaces: SurfaceTokens;
  action: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3.5 p-3.5 rounded-2xl border border-border-subtle ${surfaces.inset}`}
    >
      <div
        className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${ACTION_ICON[tone]}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[14px] font-bold text-text-primary leading-tight">
            {title}
          </p>
          {badge}
        </div>
        <p className="text-[12px] text-text-tertiary leading-snug mt-0.5">
          {desc}
        </p>
      </div>
      <div className="shrink-0 flex justify-end items-center min-w-[120px]">
        {action}
      </div>
    </div>
  );
}

function ComingSoonButton() {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className="inline-flex items-center justify-center w-[120px] h-10 rounded-xl text-[12px] font-bold bg-text-primary/[0.06] text-text-tertiary border border-border-subtle cursor-not-allowed whitespace-nowrap"
    >
      Coming Soon
    </button>
  );
}

function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
      <Check className="w-3.5 h-3.5" />
      Verified
    </span>
  );
}

function ActionButton({
  tone,
  label,
  onClick,
}: {
  tone: Tone;
  label: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 w-[120px] h-10 rounded-xl text-[13px] font-bold transition-colors ${ACTION_BTN[tone]}`}
    >
      {label}
      <ArrowRight className="w-4 h-4" />
    </motion.button>
  );
}

export function UnlockHigherLimits({
  variant,
  data,
  xVerif,
  surfaces,
  onRefetch,
  onOpenStake,
  onOpenX,
}: Props) {
  const [showPhone, setShowPhone] = useState(false);
  const [showLiveness, setShowLiveness] = useState(false);

  const phoneVerified = !!data?.verifications?.phone;
  const livenessVerified = !!data?.verifications?.liveness;
  const xVerified = !!data?.verifications?.x;
  const repTier = data?.reputation?.tier ?? data?.effective?.reputationTier ?? null;
  const repMult = Number(
    data?.reputation?.multiplier ?? data?.effective?.reputationMultiplier ?? 1,
  );

  const traderDesc =
    repTier && repMult > 1
      ? `${cap(repTier)} tier active — ${formatMult(repMult)} higher limits. Trade more to climb.`
      : "Trade actively to unlock up to 3x higher limits.";

  return (
    <div className={`rounded-[20px] p-5 border border-border-subtle ${surfaces.card}`}>
      <h3 className="text-[15px] font-bold text-text-primary mb-4">
        Unlock Higher Limits
      </h3>

      <div className="space-y-2.5">
        {/* Verify Phone */}
        <Row
          icon={<Smartphone className="w-5 h-5" />}
          tone="green"
          title="Verify Phone Number"
          desc="Verify your phone to raise your daily limit."
          surfaces={surfaces}
          action={
            phoneVerified ? (
              <VerifiedBadge />
            ) : (
              <ActionButton
                tone="green"
                label="Verify"
                onClick={() => setShowPhone(true)}
              />
            )
          }
        />

        {/* Verify Liveness */}
        <Row
          icon={<ScanFace className="w-5 h-5" />}
          tone="violet"
          title="Verify Liveness"
          desc="Complete a quick liveness check to unlock higher limits."
          surfaces={surfaces}
          action={
            livenessVerified ? (
              <VerifiedBadge />
            ) : (
              <ActionButton
                tone="violet"
                label="Verify"
                onClick={() => setShowLiveness(true)}
              />
            )
          }
        />

        {/* Stake to Increase Limits */}
        <Row
          icon={<Coins className="w-5 h-5" />}
          tone="amber"
          title="Stake to Increase Limits"
          desc="Stake BLIP points for a chance to increase your limit up to 10x."
          surfaces={surfaces}
          action={
            <ActionButton tone="amber" label="Stake" onClick={onOpenStake} />
          }
        />

        {/* Important Trader Program */}
        <Row
          icon={<TrendingUp className="w-5 h-5" />}
          tone="blue"
          title="Important Trader Program"
          desc={traderDesc}
          surfaces={surfaces}
          action={<ComingSoonButton />}
        />

        {/* Keep X / Twitter social verification */}
        <Row
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="w-4 h-4"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
            </svg>
          }
          tone="green"
          title="Verify X Account"
          desc={
            xVerif
              ? `Verified as @${xVerif.x_username}.`
              : "Follow @blip_money on X and confirm your handle."
          }
          surfaces={surfaces}
          action={
            xVerified ? (
              <div className="flex items-center gap-2.5">
                <VerifiedBadge />
                <button
                  onClick={onOpenX}
                  className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              <ActionButton tone="green" label="Verify" onClick={onOpenX} />
            )
          }
        />

        {/* Tip callout */}
        <div className="flex items-start gap-3 p-3.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07]">
          <div className="w-9 h-9 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-emerald-500">Tip</p>
            <p className="text-[12px] text-text-tertiary leading-snug">
              Trade successfully and maintain good account activity to increase
              your limits faster.
            </p>
          </div>
        </div>
      </div>

      {/* Verification sheets. PhoneVerificationSheet is built with the user
          app's `.user-scope` design tokens (bg-surface-*, bg-accent), so in the
          merchant app it must be wrapped in `.user-scope` to theme correctly —
          otherwise its surfaces/buttons render unstyled. We only wrap for the
          merchant variant; the user app already provides `.user-scope` (and may
          be in light mode, which an unconditional wrapper would override). */}
      <ScopeWrap enabled={variant === "merchant"}>
        <PhoneVerificationSheet
          open={showPhone}
          onClose={() => setShowPhone(false)}
          confirmEndpoint={
            variant === "merchant"
              ? "/api/merchant/phone/firebase-confirm"
              : undefined
          }
          reason="Verify your phone to raise your trading limits."
          onVerified={() => {
            setShowPhone(false);
            onRefetch();
          }}
        />

        {/* Liveness — /api/auth/liveness is actor-aware (user + merchant). */}
        <LivenessCheckSheet
          open={showLiveness}
          onClose={() => setShowLiveness(false)}
          onVerified={() => {
            setShowLiveness(false);
            onRefetch();
          }}
        />
      </ScopeWrap>
    </div>
  );
}

/** Wraps children in `.user-scope` (user app design tokens) when `enabled`. */
function ScopeWrap({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return enabled ? <div className="user-scope">{children}</div> : <>{children}</>;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatMult(m: number): string {
  // 2 → "2×", 1.5 → "1.5×"
  return `${Number.isInteger(m) ? m : m.toFixed(1)}×`;
}
