"use client";

// Public counterparty profile body — rendered inside ProfileSheet (full-screen on
// mobile, centered modal on desktop). Works for both user and merchant subjects.
// Themed via the shared SURFACES tokens so it reads in user + merchant scopes and
// light/dark. Data comes from GET /api/profile/[entityType]/[id] (ProfileData).

// import { useState } from "react"; // Follow button hidden (see below)
import { motion } from "framer-motion";
import {
  ChevronLeft,
  BadgeCheck,
  Award,
  Calendar,
  Info,
  ChevronRight,
  ShieldCheck,
  Phone,
  Mail,
  ScanFace,
  Star,
  TrendingUp,
  Activity,
  Clock,
  MessageCircle,
  Flag,
  ArrowRight,
  Shield,
  FileWarning,
  Gauge,
  Check,
  // UserPlus, // Follow button hidden (see below)
} from "lucide-react";
import { formatFiat, formatCount, formatPercentage } from "@/lib/format";
import type { SurfaceTokens } from "@/components/shared/limits/types";
import type { ProfileData, TrustBand, RiskLevel } from "./types";

interface Props {
  data: ProfileData;
  surfaces: SurfaceTokens;
  /** Desktop modal shows a close X; mobile page shows a back arrow. */
  onClose: () => void;
  onMessage?: () => void;
  onStartTrade?: () => void;
  onReport?: () => void;
}

const BAND_COLOR: Record<TrustBand, string> = {
  Bad: "text-red-500",
  Fair: "text-orange-500",
  Good: "text-green-500",
  Excellent: "text-emerald-600",
};

const RISK_COLOR: Record<RiskLevel, string> = {
  Low: "text-accent",
  Medium: "text-orange-500",
  High: "text-red-500",
};

function monthYear(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function relativeTime(iso: string | null, isOnline: boolean): string {
  if (isOnline) return "Active now";
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Active just now";
  if (m < 60) return `Active ${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Active ${h}h ago`;
  const days = Math.floor(h / 24);
  return `Active ${days}d ago`;
}

export function CounterpartyProfile({
  data,
  surfaces,
  onClose,
  onMessage,
  onStartTrade,
  onReport,
}: Props) {
  // Follow is hidden for now (no follow backend yet) — see commented button below.
  // const [following, setFollowing] = useState(false);
  const card = `rounded-[20px] border border-border-subtle ${surfaces.card}`;
  const active = relativeTime(data.lastActive, data.isOnline);

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0">
        <button
          onClick={onClose}
          aria-label="Back"
          className={`w-9 h-9 rounded-[14px] flex items-center justify-center border border-border-subtle ${surfaces.chip}`}
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <p className="text-[15px] font-bold text-text-primary">Profile</p>
        <div className="w-9 h-9" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 pb-4 space-y-3">
        {/* Identity */}
        <div className="flex items-start gap-4 pt-1">
          <div className="relative shrink-0">
            {data.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.avatarUrl}
                alt={data.name}
                className="w-16 h-16 rounded-full object-cover border border-border-subtle"
              />
            ) : (
              <div className={`w-16 h-16 rounded-full flex items-center justify-center text-[22px] font-extrabold text-text-secondary border border-border-subtle ${surfaces.chip}`}>
                {data.name.charAt(0).toUpperCase()}
              </div>
            )}
            {data.isOnline && (
              <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-accent border-2 border-[var(--background)]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="text-[20px] font-extrabold text-text-primary truncate">{data.name}</h1>
              {data.verified && <BadgeCheck className="w-4 h-4 text-blue-500 shrink-0" />}
            </div>
            {data.username && (
              <p className="text-[13px] text-text-tertiary">@{data.username}</p>
            )}
            <span className="flex w-fit items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full text-[11px] font-bold bg-accent/10 text-accent border border-accent/20">
              <Award className="w-3.5 h-3.5" />
              {data.tierLabel}
            </span>
            <p className="text-[11px] text-text-tertiary mt-2 flex items-center gap-1.5 flex-wrap">
              <Calendar className="w-3 h-3" />
              Member since {monthYear(data.memberSince)}
              {active && (
                <>
                  <span className="w-1 h-1 rounded-full bg-text-tertiary" />
                  <span className={data.isOnline ? "text-accent" : ""}>{active}</span>
                </>
              )}
            </p>
          </div>
          {/* Follow — hidden until a follow backend exists.
          <button
            onClick={() => setFollowing((f) => !f)}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-[12px] font-bold border transition-colors ${
              following
                ? `border-border-subtle text-text-secondary ${surfaces.chip}`
                : "border-border-medium text-text-primary"
            }`}
          >
            {following ? <Check className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
            {following ? "Following" : "Follow"}
          </button>
          */}
        </div>

        {/* Trust Score */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-bold text-text-primary inline-flex items-center gap-1.5">
              Trust Score <Info className="w-3.5 h-3.5 text-text-tertiary" />
            </p>
            {/* "What is this?" link — commented out */}
            {/* <span className="text-[12px] text-text-tertiary inline-flex items-center gap-1">
              What is this? <ChevronRight className="w-3.5 h-3.5" />
            </span> */}
          </div>
          {/* Numeric score (e.g. 40 / 100) intentionally hidden — show only the band. */}
          <div className="text-center mt-3">
            <p className={`text-[28px] font-extrabold leading-none ${BAND_COLOR[data.trust.band]}`}>
              {data.trust.band}
            </p>
          </div>
          {/* Band bar + marker */}
          <div className="relative mt-4 h-2 rounded-full overflow-hidden flex">
            <span className="flex-1 bg-red-500" />
            <span className="flex-1 bg-orange-500" />
            <span className="flex-1 bg-green-400" />
            <span className="flex-1 bg-emerald-600" />
            <span
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-text-primary border-2 border-[var(--background)]"
              style={{ left: `${data.trust.score}%` }}
            />
          </div>
          <div className="grid grid-cols-4 mt-2 text-center">
            {(["Bad 0-25", "Fair 26-50", "Good 51-75", "Excellent 76-100"] as const).map((b) => {
              const [label, range] = b.split(" ");
              return (
                <div key={b}>
                  <p className={`text-[11px] font-bold ${BAND_COLOR[label as TrustBand]}`}>{label}</p>
                  <p className="text-[10px] text-text-tertiary">{range}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Verification + Trading Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={`${card} p-5`}>
            <h3 className="text-[14px] font-bold text-text-primary mb-3">Verification</h3>
            <div className="space-y-2.5">
              <VerifRow icon={<Phone className="w-4 h-4" />} label="Phone Verified" ok={data.verifications.phone} />
              <VerifRow icon={<Mail className="w-4 h-4" />} label="Email Verified" ok={data.verifications.email} />
              <VerifRow icon={<ScanFace className="w-4 h-4" />} label="Liveness Verified" ok={data.verifications.liveness} />
              <VerifRow icon={<XLogo />} label="X (Twitter) Verified" ok={data.verifications.x} />
            </div>
            <div className={`mt-3 flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-border-subtle ${surfaces.inset}`}>
              <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
              <p className="text-[12px] text-text-secondary flex-1">
                Security: <span className="font-bold text-text-primary">{data.verifications.securityLevel}</span>
              </p>
              {/* <ChevronRight className="w-4 h-4 text-text-tertiary" /> */}
            </div>
          </div>

          <div className={`${card} p-5`}>
            <h3 className="text-[14px] font-bold text-text-primary mb-3">Trading Stats</h3>
            <div className="space-y-2.5">
              <StatRow icon={<TrendingUp className="w-4 h-4" />} label="Total Trades" value={formatCount(data.stats.totalTrades)} />
              <StatRow icon={<Activity className="w-4 h-4" />} label="Success Rate" value={formatPercentage(data.stats.successRate)} valueClass="text-accent" />
              <StatRow icon={<Gauge className="w-4 h-4" />} label="Trade Volume" value={formatFiat(data.stats.volumeUsd, "USD")} />
              <StatRow icon={<Clock className="w-4 h-4" />} label="Avg. Trade Size" value={formatFiat(data.stats.avgTradeUsd, "USD")} />
            </div>
            {/* <div className="mt-3 flex items-center justify-between text-[12px] text-text-secondary pt-2 border-t border-border-subtle">
              <span>View All Stats</span>
              <ChevronRight className="w-4 h-4 text-text-tertiary" />
            </div> */}
          </div>
        </div>

        {/* Recent Reviews */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[14px] font-bold text-text-primary">
              Recent Reviews <span className="text-text-tertiary font-medium">({formatCount(data.reviews.count)})</span>
            </h3>
            {data.reviews.count > 0 && (
              <span className="text-[12px] text-accent font-semibold">See All</span>
            )}
          </div>
          {data.reviews.recent.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-text-tertiary">No reviews yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {data.reviews.recent.slice(0, 2).map((r) => (
                <div key={r.id} className={`rounded-xl p-3.5 border border-border-subtle ${surfaces.inset}`}>
                  <div className="flex items-center gap-0.5 mb-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`w-3.5 h-3.5 ${i < Math.round(r.rating) ? "text-accent fill-accent" : "text-text-quaternary"}`}
                      />
                    ))}
                  </div>
                  {r.text && <p className="text-[12px] text-text-secondary leading-snug">{r.text}</p>}
                  <p className="text-[11px] text-text-tertiary mt-1.5">
                    {r.authorName} · {relativeReview(r.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Risk Overview */}
        <div className={`${card} p-5`}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-bold text-text-primary">Risk Overview</p>
              <p className={`text-[13px] font-bold ${RISK_COLOR[data.risk.level]}`}>
                {data.risk.level} Risk
                <span className="text-text-tertiary font-normal text-[11px]"> · safe to trade with</span>
              </p>
            </div>
            {/* <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" /> */}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <RiskStat icon={<ShieldCheck className="w-4 h-4" />} label={data.risk.activeDisputes === 0 ? "No active disputes" : `${data.risk.activeDisputes} active disputes`} />
            <RiskStat icon={<FileWarning className="w-4 h-4" />} label={data.risk.fraudReports === 0 ? "No fraud reports" : `${data.risk.fraudReports} fraud reports`} />
            <RiskStat icon={<Activity className="w-4 h-4" />} label={`${formatPercentage(data.risk.successRate)} success rate`} />
            <RiskStat icon={<Calendar className="w-4 h-4" />} label={`${formatCount(data.risk.accountAgeDays)}+ days account age`} />
          </div>
        </div>

        {/* Limits & Tier */}
        <div className={`${card} p-5`}>
          <div className="flex items-center  mb-3">
            <h3 className="text-[14px] font-bold text-text-primary">Limits &amp; Tier</h3>
            {/* <span className="text-[12px] text-accent font-semibold">View Limits</span> */}
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-accent/10 text-accent border border-accent/20">
            <Award className="w-3.5 h-3.5" />
            {data.limits.tierLabel}
          </span>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <p className="text-[11px] text-text-tertiary">Daily Limit</p>
              <p className="text-[18px] font-extrabold text-text-primary">{formatFiat(data.limits.dailyUsd, "USD")}</p>
            </div>
            <div>
              <p className="text-[11px] text-text-tertiary">Per Trade Limit</p>
              <p className="text-[18px] font-extrabold text-text-primary">{formatFiat(data.limits.perTradeUsd, "USD")}</p>
            </div>
          </div>
        </div>

        {/* Social */}
        {(data.social.x || data.social.telegram || data.social.discord) && (
          <div className={`${card} p-5`}>
            <h3 className="text-[14px] font-bold text-text-primary mb-3">Social</h3>
            <div className="grid grid-cols-3 gap-3">
              {data.social.x && <SocialItem icon={<XLogo />} label="X (Twitter)" handle={`@${data.social.x.handle}`} verified={data.social.x.verified} />}
              {data.social.telegram && <SocialItem icon={<TelegramLogo />} label="Telegram" handle={`@${data.social.telegram.handle}`} verified={data.social.telegram.verified} />}
              {data.social.discord && <SocialItem icon={<DiscordLogo />} label="Discord" handle={data.social.discord.handle} verified={data.social.discord.verified} />}
            </div>
          </div>
        )}
      </div>

      {/* Bottom actions — each button renders only when its handler is wired.
          Contexts that pass no handlers (e.g. the merchant pending panel, where
          the order isn't accepted yet) get no action bar at all. Message appears
          only after a trade exists, so it's wired post-accept, not here. */}
      {(onMessage || onStartTrade || onReport) && (
        <div className={`shrink-0 flex items-center gap-3 px-5 py-4 border-t border-border-subtle ${surfaces.card}`}>
          {onMessage && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onMessage}
              className={`flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-xl text-[13px] font-bold border border-border-subtle text-text-primary ${surfaces.chip} ${surfaces.hover} transition-colors`}
            >
              <MessageCircle className="w-4 h-4" />
              Message
            </motion.button>
          )}
          {onStartTrade && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onStartTrade}
              className="flex-[1.4] inline-flex items-center justify-center gap-2 h-12 rounded-xl text-[13px] font-bold bg-accent text-accent-text hover:opacity-90 transition-opacity"
            >
              Start Trade
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          )}
          {onReport && (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={onReport}
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 rounded-xl text-[13px] font-bold border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <Flag className="w-4 h-4" />
              Report
            </motion.button>
          )}
        </div>
      )}
    </div>
  );
}

function relativeReview(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86_400_000);
  if (d < 1) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function VerifRow({ icon, label, ok }: { icon: React.ReactNode; label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${ok ? "bg-accent/10 text-accent" : "bg-text-primary/[0.05] text-text-tertiary"}`}>
        {icon}
      </span>
      <span className="text-[13px] text-text-secondary flex-1 whitespace-nowrap">{label}</span>
      {ok ? (
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-accent/10 text-accent inline-flex items-center gap-1 shrink-0">
          <Check className="w-3 h-3" /> Verified
        </span>
      ) : (
        <span className="text-[11px] font-medium text-text-tertiary shrink-0">Not verified</span>
      )}
    </div>
  );
}

function StatRow({ icon, label, value, valueClass }: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-7 h-7 rounded-full bg-text-primary/[0.05] text-text-tertiary flex items-center justify-center shrink-0">{icon}</span>
      <span className="text-[13px] text-text-secondary flex-1">{label}</span>
      <span className={`text-[13px] font-bold ${valueClass ?? "text-text-primary"}`}>{value}</span>
    </div>
  );
}

function RiskStat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-1.5">
      <span className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center">{icon}</span>
      <span className="text-[10px] text-text-tertiary leading-snug">{label}</span>
    </div>
  );
}

function SocialItem({ icon, label, handle, verified }: { icon: React.ReactNode; label: string; handle: string; verified: boolean }) {
  return (
    <div className="flex flex-col items-center text-center gap-1">
      <span className="w-9 h-9 rounded-full bg-text-primary/[0.05] text-text-secondary flex items-center justify-center">{icon}</span>
      <p className="text-[11px] font-semibold text-text-primary">{label}</p>
      <p className="text-[10px] text-text-tertiary truncate max-w-full">{handle}</p>
      {verified && (
        <span className="text-[10px] text-accent font-semibold inline-flex items-center gap-0.5">
          <Check className="w-2.5 h-2.5" /> Verified
        </span>
      )}
    </div>
  );
}

function XLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-3.5 h-3.5">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

function TelegramLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function DiscordLogo() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-4 h-4">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
