'use client';

// /waitlist/dashboard
//
// UI is an exact port of the futureStick repo's Dashboard.tsx (user) and
// MerchantDashboard.tsx (merchant) — Apple-style minimal layout with the
// #cc785c accent, half-circle SVG gauge, pill buttons, rounded-2xl cards,
// 7/5 column split for merchants, 8/4 for users.
//
// Backend wiring is unchanged: all data flows through /api/waitlist/* via
// fetchWithAuth, all task verifications go through the existing modals
// (XFollowVerificationModal, TelegramVerificationModal, TweetCampaignModal).

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, LogOut, Copy, Check, Crown, Send, Repeat2, Users as UsersIcon,
  CheckCircle2, Store, Settings, Menu, ExternalLink, Info,
  Share2, MoreHorizontal, MessageCircle, Trophy, HelpCircle,
  CircleCheck, Target, Award, UserPlus, TrendingUp, ArrowRight,
  BadgeCheck, Sparkles, Rocket, Activity, Star, Sun, Moon, Link2,
} from 'lucide-react';

// Lucide ships the legacy bird-shaped Twitter glyph; X rebranded to the
// stylised wordmark in 2023. Inline the official X logo path so the
// share buttons and the "Follow on X" quest read as current.
function XLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}
import { useWaitlistTheme, useWaitlistTokens } from '@/context/WaitlistThemeContext';
import { formatCount } from '@/lib/format';
import { USER_BLIP_POINTS, MERCHANT_BLIP_POINTS } from '@/lib/waitlist/blipPoints';
import { ReputationCoinBadge } from '@/components/shared/ReputationCoinBadge';
import { readRole, forgetRole, rememberRole, loginPathForRole } from '@/lib/waitlist/roleCache';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import XFollowVerificationModal from '@/components/waitlist/XFollowVerificationModal';
import TelegramVerificationModal from '@/components/waitlist/TelegramVerificationModal';
import TweetCampaignModal from '@/components/waitlist/TweetCampaignModal';
import { Logo } from '@/components/shared/Logo';

type ActorType = 'user' | 'merchant';
type WaitlistStatus = 'waitlisted' | 'active' | 'rejected';
type TaskType = 'TWITTER' | 'TELEGRAM' | 'DISCORD' | 'QUIZ' | 'WHITEPAPER' | 'CUSTOM' | 'ONBOARD_FORM';
type TaskStatus = 'PENDING' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';

interface Task { id: string; task_type: TaskType; status: TaskStatus; points_awarded: number; }
interface PointEntry {
  id: string;
  event: string;
  bonus_points: number;
  total_points: number | null;
  source_ref: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
interface Referral { id: string; referred_type: ActorType; reward_status: 'pending' | 'credited' | 'failed'; reward_amount: number; created_at: string; }
interface BetaRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'contacted';
  expected_trading_amount_usd: string | null;
  requested_at: string;
}

interface WaitlistMe {
  actor: {
    id: string;
    type: ActorType;
    display_name: string | null;
    username: string | null;
    email: string | null;
    wallet_address?: string | null;
    waitlist_status: WaitlistStatus;
    waitlist_joined_at: string | null;
    waitlist_source: string | null;
    blip_points: number;
    referral_code: string | null;
    position_in_line: number | null;
  };
  counterpart: {
    id: string; type: ActorType; waitlist_status: WaitlistStatus;
    blip_points: number; referral_code: string | null;
  } | null;
  tasks: Task[];
  points_history: PointEntry[];
  referrals: Referral[];
  beta_request: BetaRequest | null;
}

interface LeaderboardRow {
  actor_id: string; actor_type: ActorType;
  display_name: string | null; username: string | null;
  blip_points: number;
}

// Theme-aware tokens. The dashboard uses the waitlist-scoped theme provider
// (see /waitlist/layout.tsx) so the light/dark toggle here only affects
// pages under /waitlist/* and never touches the rest of the app.
const ACCENT = '#cc785c';
const useThemeTokens = useWaitlistTokens;

// Back-compat string tokens (kept dark-only for any component that hasn't
// been migrated to useThemeTokens yet; remove once everything uses the hook).
const surface = 'bg-[#0f0f0f]';
const border = 'border-white/[0.06]';
const txt = 'text-white';
const muted = 'text-white/60';
const sub = 'text-white/40';
const hov = 'hover:bg-white/5';
const inputBg = 'bg-white/5';
const divider = 'border-white/[0.06]';
const accentBg = 'bg-white';
const cardShadow = '';

// Live Google Form — same link as MerchantDashboard.tsx so the two
// surfaces stay in sync (the previous forms.gle slug returned 404).
const ONBOARD_FORM_URL = 'https://forms.gle/UyfhpcMdq8BSTQSZA';

export default function WaitlistDashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<WaitlistMe | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Beta-access "Send Request" modal — only used by merchants (gated below).
  const [betaModalOpen, setBetaModalOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // fetchWithAuth transparently calls /api/auth/refresh on a 401 and
      // retries the original request once — so a routine 15-min access-token
      // expiry no longer dumps the user back to the login page.
      const [meRes, lbRes] = await Promise.all([
        fetchWithAuth('/api/waitlist/me'),
        fetchWithAuth('/api/waitlist/leaderboard?limit=10'),
      ]);
      if (meRes.status === 401) {
        const dest = loginPathForRole(readRole());
        router.push(`${dest}?expired=1`);
        return;
      }

      const meText = await meRes.text();
      let meData: { success?: boolean; data?: WaitlistMe; error?: string } | null = null;
      try { meData = JSON.parse(meText); } catch {/* not JSON */}
      if (!meData) {
        setError(`Server returned non-JSON (HTTP ${meRes.status}). Apply database/migrations/131_waitlist.sql.`);
        return;
      }
      if (!meData.success || !meData.data) {
        setError(meData.error ?? `Request failed (HTTP ${meRes.status})`);
        return;
      }
      setMe(meData.data);
      rememberRole(meData.data.actor.type);

      try {
        const lb = JSON.parse(await lbRes.text());
        if (lb?.success) setLeaderboard(lb.data.leaderboard);
      } catch {/* leaderboard optional */}
    } catch (err) {
      console.error(err);
      setError('Network error — could not reach the server');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  // Logout flow is two-step: the navbar button opens a confirmation modal,
  // and confirmLogout does the real work. Prevents a stray click from
  // dropping the session.
  function handleLogout() {
    setLogoutConfirmOpen(true);
  }

  async function confirmLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    // Capture role BEFORE clearing it — needed to pick the right post-logout
    // destination. Prefer the loaded actor type; fall back to the cache.
    const role = me?.actor.type ?? readRole();
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    forgetRole();
    router.push(loginPathForRole(role));
  }

  if (loading) {
    return <div className="min-h-screen bg-[#FAF8F5] dark:bg-black flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-black/40 dark:text-white/40" /></div>;
  }
  if (error || !me) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] dark:bg-black flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="text-red-500 text-sm mb-4">{error ?? 'Could not load dashboard'}</p>
          <button onClick={() => router.push('/waitlist/login')}
            className="text-xs font-semibold uppercase tracking-[0.14em] text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white underline">
            Back to login
          </button>
        </div>
      </div>
    );
  }

  const { actor, counterpart } = me;
  const isMerchant = actor.type === 'merchant';
  const blipPoints = actor.blip_points + (counterpart?.blip_points ?? 0);

  // Per-actor reward values.
  const POINTS = isMerchant ? {
    TWITTER:  MERCHANT_BLIP_POINTS.TWITTER,
    TELEGRAM: MERCHANT_BLIP_POINTS.TELEGRAM,
    RETWEET:  MERCHANT_BLIP_POINTS.RETWEET,
    REFERRAL: MERCHANT_BLIP_POINTS.REFERRAL,
  } : {
    TWITTER:  USER_BLIP_POINTS.TASK_DEFAULT,
    TELEGRAM: USER_BLIP_POINTS.TASK_DEFAULT,
    RETWEET:  USER_BLIP_POINTS.TASK_DEFAULT,
    REFERRAL: USER_BLIP_POINTS.REFERRAL,
  };

  const referralCount = me.referrals.length;
  // Quest count includes the referral quest when the user has at least one
  // referral (matches the synthetic-existing logic in the quest map below).
  const verifiedTaskCount = me.tasks.filter((t) => t.status === 'VERIFIED').length;
  const questsCompleted = verifiedTaskCount + (referralCount > 0 ? 1 : 0);
  // Merchant beta-access "Send Request" requires the three social quests
  // (X follow, Telegram join, retweet) to be verified first — the banner
  // copy promises this gate, the button needs to honour it.
  const verifiedTaskTypes = new Set(
    me.tasks.filter((t) => t.status === 'VERIFIED').map((t) => t.task_type),
  );
  const socialQuestsDone =
    verifiedTaskTypes.has('TWITTER') &&
    verifiedTaskTypes.has('TELEGRAM') &&
    verifiedTaskTypes.has('CUSTOM');
  const totalEarnedFromQuestsAndRef = me.tasks.filter((t) => t.status === 'VERIFIED').reduce((s, t) => s + (t.points_awarded || 0), 0)
    + me.referrals.filter((r) => r.reward_status === 'credited').reduce((s, r) => s + r.reward_amount, 0);
  const pendingPoints = me.referrals.filter((r) => r.reward_status === 'pending').length * (isMerchant ? MERCHANT_BLIP_POINTS.REFERRAL : USER_BLIP_POINTS.REFERRAL);

  const referralCode = actor.referral_code ?? '';
  // Route the referral link straight to the signup form matching the
  // referrer's actor type. The bare /waitlist redirector rewrites to
  // /waitlist/user, so a merchant sharing /waitlist?ref=X would land
  // invitees on the user signup form — muddying attribution.
  const referralSignupPath = isMerchant ? '/waitlist/merchant' : '/waitlist/user';
  const referralLink = typeof window !== 'undefined' && referralCode
    ? `${window.location.origin}${referralSignupPath}?ref=${referralCode}`
    : '';
  const referralUnit = isMerchant ? MERCHANT_BLIP_POINTS.REFERRAL : USER_BLIP_POINTS.REFERRAL;

  async function copyToClipboard(value: string, which: 'code' | 'link') {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      if (which === 'code') { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      else { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000); }
    } catch {/* ignore */}
  }

  const quests: Array<{
    id: TaskType; title: string; reward: number;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
  }> = [
    { id: 'TWITTER',    title: 'Follow Us on Twitter',  reward: POINTS.TWITTER,  icon: XLogo,
      description: 'Follow @blip_money on X to stay updated and earn points.' },
    { id: 'TELEGRAM',   title: 'Follow Us on Telegram', reward: POINTS.TELEGRAM, icon: UsersIcon,
      description: 'Join our Telegram channel and verify membership.' },
    { id: 'CUSTOM',     title: 'Retweet a Post',        reward: POINTS.RETWEET,  icon: Repeat2,
      description: 'Post about Blip Market on X with the campaign message.' },
    { id: 'WHITEPAPER', title: 'Share Referral Link',   reward: POINTS.REFERRAL, icon: Send,
      description: `Invite ${isMerchant ? 'merchants' : 'friends'} with your referral link to earn BLIP.` },
  ];

  const hasBothSegments = !!counterpart;

  return (
    <div className="min-h-screen bg-[#FAF8F5] dark:bg-black text-black dark:text-white font-sans antialiased overflow-x-hidden">
      <Navbar
        balance={blipPoints}
        onLogout={handleLogout}
        onShowHistory={() => setHistoryOpen(true)}
        actor={actor}
      />

      <main id="dash-top" className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 pb-24 md:pb-4 relative z-10 lg:min-h-[calc(100vh-64px)] lg:flex lg:flex-col">
        {/* Mobile-only app shell — Founding Merchant hero + Your Overview +
            Your Journey, stacked above the standard cards. Hidden on lg+
            where the full grid layout takes over. No bottom tab bar. */}
        <MobileWaitlistHeader
          me={me}
          blipPoints={blipPoints}
          questsCompleted={questsCompleted}
          referralCount={referralCount}
          isMerchant={isMerchant}
        />

        {isMerchant ? (
          <MerchantLayout
            me={me}
            blipPoints={blipPoints}
            referralCount={referralCount}
            verifiedTaskCount={verifiedTaskCount}
            questsCompleted={questsCompleted}
            socialQuestsDone={socialQuestsDone}
            totalEarnedFromQuestsAndRef={totalEarnedFromQuestsAndRef}
            pendingPoints={pendingPoints}
            referralCode={referralCode}
            referralLink={referralLink}
            referralUnit={referralUnit}
            quests={quests}
            leaderboard={leaderboard}
            copied={copied}
            copiedLink={copiedLink}
            onCopyCode={() => copyToClipboard(referralCode, 'code')}
            onCopyLink={() => copyToClipboard(referralLink, 'link')}
            onShowHistory={() => setHistoryOpen(true)}
            onOpenReferral={() => setReferralOpen(true)}
            onOpenHow={() => setHowOpen(true)}
            onOpenBeta={() => setBetaModalOpen(true)}
            onReload={load}
            hasBothSegments={hasBothSegments}
            onOpenUpgrade={() => setUpgradeOpen(true)}
          />
        ) : (
          <UserLayout
            me={me}
            blipPoints={blipPoints}
            referralCount={referralCount}
            referralCode={referralCode}
            referralLink={referralLink}
            referralUnit={referralUnit}
            quests={quests}
            leaderboard={leaderboard}
            copied={copied}
            copiedLink={copiedLink}
            onCopyCode={() => copyToClipboard(referralCode, 'code')}
            onCopyLink={() => copyToClipboard(referralLink, 'link')}
            onShowHistory={() => setHistoryOpen(true)}
            onOpenReferral={() => setReferralOpen(true)}
            onOpenHow={() => setHowOpen(true)}
            onReload={load}
            hasBothSegments={hasBothSegments}
            onOpenUpgrade={() => setUpgradeOpen(true)}
          />
        )}
      </main>

      {/* Mobile bottom tab bar — only for the richer merchant layout */}
      {isMerchant && (
        <nav
          aria-label="Dashboard"
          className={`md:hidden fixed inset-x-0 bottom-0 z-40 ${surface} border-t ${border}`}
          style={{
            paddingBottom: 'max(env(safe-area-inset-bottom), 8px)',
            backdropFilter: 'saturate(140%) blur(14px)',
            WebkitBackdropFilter: 'saturate(140%) blur(14px)',
            boxShadow: '0 -8px 24px -8px rgba(0,0,0,0.5)',
          }}
        >
          <div className="grid grid-cols-5 px-2 pt-1.5">
            {[
              { label: 'Home', Icon: Activity, href: '#dash-top' },
              { label: 'Refer', Icon: Share2, action: () => setReferralOpen(true) },
              { label: 'Quests', Icon: Star, href: '#social-quests' },
              { label: 'Progress', Icon: CheckCircle2, href: '#dash-progress' },
              { label: 'History', Icon: TrendingUp, action: () => setHistoryOpen(true) },
            ].map(({ label, Icon, href, action }) => {
              const cls = `flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg text-[10px] font-semibold tracking-tight ${muted} hover:${txt} transition-colors`;
              if (action) {
                return (
                  <button key={label} type="button" onClick={action} className={cls}>
                    <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                    <span>{label}</span>
                  </button>
                );
              }
              return (
                <a key={label} href={href} className={cls}>
                  <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                  <span>{label}</span>
                </a>
              );
            })}
          </div>
        </nav>
      )}

      {historyOpen && <HistoryModal history={me.points_history} onClose={() => setHistoryOpen(false)} />}
      {upgradeOpen && (
        <UpgradeModal actorType={actor.type}
          onClose={() => setUpgradeOpen(false)}
          onSuccess={() => { setUpgradeOpen(false); void load(); }} />
      )}
      {referralOpen && (
        <ReferralModal code={referralCode} link={referralLink}
          onClose={() => setReferralOpen(false)}
          onCopy={() => copyToClipboard(referralLink, 'link')} copied={copiedLink} />
      )}
      {howOpen && <HowItWorksModal onClose={() => setHowOpen(false)} referralUnit={referralUnit} />}
      {logoutConfirmOpen && (
        <LogoutConfirmModal
          role={actor.type}
          loading={loggingOut}
          onCancel={() => setLogoutConfirmOpen(false)}
          onConfirm={() => void confirmLogout()}
        />
      )}
      {betaModalOpen && (
        <BetaRequestModal
          onClose={() => setBetaModalOpen(false)}
          onSuccess={() => { setBetaModalOpen(false); void load(); }}
        />
      )}
    </div>
  );
}

// ── Mobile-only header — reproduces the Blip Market mobile app shell:
// a dark "Founding Merchant / Member" hero, a 3-up "Your Overview" stat
// strip, and a "Your Journey" step timeline. Rendered with lg:hidden so
// it only appears on phones/tablets and never duplicates the desktop
// grid. The bottom tab bar from the mockup is intentionally omitted.
function MobileWaitlistHeader({
  me, blipPoints, questsCompleted, referralCount, isMerchant,
}: {
  me: WaitlistMe;
  blipPoints: number;
  questsCompleted: number;
  referralCount: number;
  isMerchant: boolean;
}) {
  const t = useThemeTokens();

  // Step timeline — mirror ProgressStepsCard's source logic exactly so the
  // mobile "Your Journey" and the desktop "Your Progress & Steps" can never
  // disagree about what's complete.
  const hasVerified = (type: TaskType) => me.tasks.some((tk) => tk.task_type === type && tk.status === 'VERIFIED');
  const allSocialDone = hasVerified('TWITTER') && hasVerified('TELEGRAM') && hasVerified('CUSTOM');
  const onboardDone = hasVerified('ONBOARD_FORM');
  const referredEnough = referralCount >= 3;
  const betaState = me.beta_request?.status ?? null;

  const rawSteps: Array<{ id: number; title: string; desc: string; done: boolean; badge?: string }> = [
    { id: 1, title: 'Sign Up', desc: 'Welcome to Blip waitlist.', done: true },
    { id: 2, title: 'Complete Community Quests', desc: 'Do social quests and earn points.', done: allSocialDone },
    {
      id: 3,
      title: isMerchant ? 'Invite 3 Merchants' : 'Refer 3 Friends',
      desc: isMerchant ? 'Refer merchants and earn 1,000 pts each.' : 'Refer friends and earn points each.',
      done: referredEnough,
      badge: `${Math.min(referralCount, 3)}/3`,
    },
    ...(isMerchant
      ? [
          { id: 4, title: 'Join Merchant Onboard Program', desc: 'Submit the Google Form and earn 500 pts.', done: onboardDone },
          { id: 5, title: 'Request P2P Beta Access', desc: 'Get early access to the Blip P2P App.', done: betaState === 'approved' },
        ]
      : []),
  ];

  let firstUnfinished = false;
  const steps = rawSteps.map((s) => {
    let status: 'done' | 'active' | 'locked';
    if (s.done) status = 'done';
    else if (!firstUnfinished) { status = 'active'; firstUnfinished = true; }
    else status = 'locked';
    return { ...s, status };
  });
  const completedCount = steps.filter((s) => s.status === 'done').length;

  const eyebrow = isMerchant ? 'Founding Merchant Program' : 'Founding Member Program';
  const headlineLead = isMerchant ? 'Become a Founding Merchant on ' : 'Join the Founding Members of ';
  const headlineSub = isMerchant
    ? 'Join early. Earn BLIP points. Build reputation. Get beta access.'
    : 'Join early. Earn BLIP points. Climb the leaderboard. Get beta access.';

  const connectorColor = t.d ? 'bg-white/10' : 'bg-black/10';
  const checkBg = t.d ? 'bg-white' : 'bg-black';
  const checkText = t.d ? 'text-black' : 'text-white';

  return (
    <div className="lg:hidden mb-5">
      {/* Dark full-bleed band — continues the navbar's black behind the hero
          and extends below it so the Overview card can overlap, creating the
          premium layered effect from the mockup. */}
      <div
        className="-mx-4 md:-mx-6 -mt-3 md:-mt-4 px-4 md:px-6 pt-3 md:pt-4 pb-32"
        style={{ background: '#000000' }}
      >
      {/* Founding Merchant hero — premium-dark brand card with a soft orange
          glow, regardless of the page theme. */}
      <div
        className="rounded-[26px] overflow-hidden relative"
        style={{
          background:
            'radial-gradient(135% 95% at 84% 26%, rgba(204,120,92,0.32) 0%, rgba(204,120,92,0.08) 38%, rgba(0,0,0,0) 66%), #070707',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 26px 64px -30px rgba(204,120,92,0.5)',
        }}
      >
        <div className="relative flex items-center min-h-[272px]">
          <div className="flex-1 min-w-0 p-7 pr-1 flex flex-col justify-center gap-4">
            <span
              className="inline-flex w-fit items-center px-3.5 py-1.5 rounded-full text-[12px] font-semibold tracking-tight"
              style={{ background: '#ffffff', color: ACCENT }}
            >
              {eyebrow}
            </span>
            <h2 className="text-[31px] font-bold leading-[1.08] tracking-[-0.015em] text-white">
              {headlineLead}
              <span style={{ color: ACCENT }}>Blip Market.</span>
            </h2>
            <p className="text-[13.5px] text-white/55 leading-[1.55] max-w-[15rem]">
              {headlineSub}
            </p>
          </div>
          <div className="relative w-[42%] max-w-[180px] shrink-0 flex items-center justify-center pr-3">
            <BlipMarketStall className="w-full h-auto" />
          </div>
        </div>
      </div>
      </div>

      {/* Your Overview — pulled up to overlap the dark band above (top sits on
          the dark area, the rest extends onto the light page background). */}
      <div className={`relative z-10 -mt-24 ${t.surface} border ${t.border} ${t.cardShadow} rounded-[22px] p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.22)]`}>
        <h3 className={`text-[19px] font-bold ${t.txt} tracking-tight mb-5`}>Your Overview</h3>
        <div className="grid grid-cols-3 gap-3">
          <MobileOverviewStat icon={<Target className={`w-6 h-6 ${t.txt}`} strokeWidth={2} />} value={blipPoints} label="BLIP Points" />
          <MobileOverviewStat icon={<BadgeCheck className={`w-6 h-6 ${t.txt}`} strokeWidth={2} />} value={questsCompleted} label="Completed Quests" hint="of 4" />
          <MobileOverviewStat icon={<UsersIcon className={`w-6 h-6 ${t.txt}`} strokeWidth={2} />} value={referralCount} label="Referrals" hint="of 3" />
        </div>
      </div>

      {/* Your Journey — step timeline. */}
      <div className={`mt-5 ${t.surface} border ${t.border} ${t.cardShadow} rounded-[22px] p-6`}>
        <div className="flex items-center justify-between mb-5">
          <h3 className={`text-[19px] font-bold ${t.txt} tracking-tight`}>Your Journey</h3>
          <span className={`text-[12px] font-medium ${t.muted}`}>
            {completedCount} of {steps.length} steps completed
          </span>
        </div>
        <div className="space-y-5">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const isDone = step.status === 'done';
            const isActive = step.status === 'active';
            return (
              <div key={step.id} className="relative flex items-start gap-4">
                {!isLast && (
                  <div className={`absolute left-[13px] top-8 h-[calc(100%+4px)] w-px ${connectorColor}`} />
                )}
                <div className="shrink-0">
                  {isDone ? (
                    <div className={`w-7 h-7 rounded-full ${checkBg} flex items-center justify-center`}>
                      <Check className={`w-[14px] h-[14px] ${checkText}`} strokeWidth={3} />
                    </div>
                  ) : isActive ? (
                    <div className="relative w-7 h-7">
                      <svg viewBox="0 0 28 28" className="w-7 h-7 -rotate-90">
                        <circle cx="14" cy="14" r="12" fill="none" stroke="rgba(204,120,92,0.22)" strokeWidth="2.5" />
                        <circle
                          cx="14" cy="14" r="12" fill="none" stroke={ACCENT} strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeDasharray={`${0.34 * 2 * Math.PI * 12} ${2 * Math.PI * 12}`}
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="w-[7px] h-[7px] rounded-full" style={{ background: ACCENT }} />
                      </span>
                    </div>
                  ) : (
                    <div className={`w-7 h-7 rounded-full border ${t.border} flex items-center justify-center`}>
                      <span className={`text-[11px] font-semibold ${t.sub} tabular-nums`}>
                        {step.id}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[14.5px] font-semibold ${t.txt} tracking-tight`}>{step.title}</p>
                    {step.badge && !isDone && (
                      <span className={`text-[11px] font-semibold ${t.muted} border ${t.border} rounded-full px-2.5 py-0.5 tabular-nums shrink-0`}>
                        {step.badge}
                      </span>
                    )}
                  </div>
                  <p className={`text-[12.5px] ${t.muted} leading-snug mt-1`}>{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Single stat cell inside the mobile "Your Overview" strip. Icon-on-top,
// vertically centred, generous height to match the reference proportions.
function MobileOverviewStat({
  icon, value, label, hint,
}: { icon: React.ReactNode; value: number; label: string; hint?: string }) {
  const t = useThemeTokens();
  const fill = t.d ? 'bg-[rgba(255,255,255,0.03)]' : 'bg-[rgba(0,0,0,0.015)]';
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-2.5 px-2 py-6 ${fill} border ${t.border} rounded-2xl`}>
      <div className="h-6 flex items-center justify-center">{icon}</div>
      <p className={`text-[27px] font-bold ${t.txt} leading-none tabular-nums`}>{formatCount(value)}</p>
      <div className="space-y-0.5">
        <p className={`text-[12px] font-semibold ${t.txt} leading-tight`}>{label}</p>
        {hint && <p className="text-[12px] font-semibold leading-tight" style={{ color: ACCENT }}>{hint}</p>}
      </div>
    </div>
  );
}

// ── BlipMarketStall — inline-SVG storefront illustration for the mobile
// hero. Orange-themed 3D-style market stall with an awning, a glowing
// counter window, a "BLIP" coin and a soft glow, standing in for a raster
// 3D render (drop a real asset in /public and swap to <img> if available).
function BlipMarketStall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden role="img">
      <defs>
        <linearGradient id="bmRoof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7a64e" />
          <stop offset="1" stopColor="#cf6a37" />
        </linearGradient>
        <linearGradient id="bmBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7e3417" />
          <stop offset="1" stopColor="#2c1209" />
        </linearGradient>
        <linearGradient id="bmCoin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd27a" />
          <stop offset="1" stopColor="#d98a32" />
        </linearGradient>
        <radialGradient id="bmGlow" cx="0.5" cy="0.42" r="0.55">
          <stop offset="0" stopColor="#f7a64e" stopOpacity="0.45" />
          <stop offset="1" stopColor="#f7a64e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="bmWindow" cx="0.5" cy="1" r="0.9">
          <stop offset="0" stopColor="#ffb155" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffb155" stopOpacity="0" />
        </radialGradient>
        <clipPath id="bmRoofClip">
          <path d="M44 88 L60 54 H140 L156 88 Z" />
        </clipPath>
      </defs>

      {/* ambient glow */}
      <ellipse cx="100" cy="96" rx="92" ry="92" fill="url(#bmGlow)" />

      {/* ground shadow */}
      <ellipse cx="100" cy="172" rx="58" ry="10" fill="#1c0c06" opacity="0.7" />

      {/* posts */}
      <rect x="53" y="86" width="7" height="84" rx="3" fill="#5e3019" />
      <rect x="140" y="86" width="7" height="84" rx="3" fill="#5e3019" />

      {/* stall body */}
      <rect x="57" y="96" width="86" height="72" rx="7" fill="url(#bmBody)" />
      {/* counter window */}
      <rect x="71" y="106" width="58" height="44" rx="6" fill="#150702" />
      <rect x="71" y="118" width="58" height="32" rx="6" fill="url(#bmWindow)" />
      {/* counter ledge */}
      <rect x="64" y="150" width="72" height="9" rx="4" fill="#6e3318" />

      {/* awning */}
      <g clipPath="url(#bmRoofClip)">
        <rect x="44" y="54" width="112" height="34" fill="url(#bmRoof)" />
        {[52, 70, 88, 106, 124, 142].map((x) => (
          <rect key={x} x={x} y="54" width="9" height="34" fill="#bb592c" opacity="0.55" />
        ))}
      </g>
      {/* scalloped valance */}
      {[52, 70, 88, 106, 124, 142].map((cx) => (
        <circle key={cx} cx={cx} cy="88" r="7" fill="url(#bmRoof)" />
      ))}
      {/* ridge highlight */}
      <path d="M44 88 L60 54 H140 L156 88" fill="none" stroke="#ffd9a8" strokeWidth="1.5" opacity="0.5" strokeLinejoin="round" />

      {/* BLIP coin */}
      <ellipse cx="98" cy="152" rx="21" ry="21" fill="url(#bmCoin)" stroke="#b9701f" strokeWidth="2" />
      <ellipse cx="98" cy="152" rx="15" ry="15" fill="none" stroke="#ffe7b8" strokeWidth="1.5" opacity="0.6" />
      <text x="98" y="157" textAnchor="middle" fontSize="11.5" fontWeight="700" fill="#7a3e0a" fontFamily="ui-sans-serif, system-ui, sans-serif">BLIP</text>

      {/* sparkles */}
      <path d="M158 60 l2.4 5.6 5.6 2.4 -5.6 2.4 -2.4 5.6 -2.4 -5.6 -5.6 -2.4 5.6 -2.4 z" fill="#ffd27a" opacity="0.85" />
      <path d="M150 92 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6 z" fill="#ffba62" opacity="0.7" />
    </svg>
  );
}

// ── Layout: merchant — 7/5 split with sub-cols on the right (mirrors
// MerchantDashboard.tsx). The right column splits into A (Progress +
// Leaderboard) and B (Your Progress & Steps + P2P banner).
function MerchantLayout(props: {
  me: WaitlistMe;
  blipPoints: number;
  referralCount: number;
  verifiedTaskCount: number;
  questsCompleted: number;
  socialQuestsDone: boolean;
  totalEarnedFromQuestsAndRef: number;
  pendingPoints: number;
  referralCode: string;
  referralLink: string;
  referralUnit: number;
  quests: ReadonlyArray<{ id: TaskType; title: string; reward: number; icon: React.ComponentType<{ className?: string }>; description: string }>;
  leaderboard: LeaderboardRow[];
  copied: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onShowHistory: () => void;
  onOpenReferral: () => void;
  onOpenHow: () => void;
  onOpenBeta: () => void;
  onReload: () => void;
  hasBothSegments: boolean;
  onOpenUpgrade: () => void;
}) {
  const {
    me, blipPoints, referralCount, questsCompleted, socialQuestsDone,
    totalEarnedFromQuestsAndRef, pendingPoints,
    referralCode, referralLink, referralUnit, quests, leaderboard,
    copied, copiedLink, onCopyCode, onCopyLink, onShowHistory, onOpenReferral, onOpenHow,
    onOpenBeta, onReload, hasBothSegments, onOpenUpgrade,
  } = props;

  const onboardTask = me.tasks.find((t) => t.task_type === 'ONBOARD_FORM');
  const onboardDone = onboardTask?.status === 'VERIFIED';

  const t = useThemeTokens();

  return (
    <>
      {/* Top row: Hero (6) | Referral Code (3) | Real-Time Activity (3).
          On mobile, Hero + Referral Code collapse into MobileReferralCard. */}
      <MobileReferralCard
        referralCode={referralCode}
        referralLink={referralLink}
        referralUnit={referralUnit}
        copied={copied}
        copiedLink={copiedLink}
        onCopyCode={onCopyCode}
        onCopyLink={onCopyLink}
        onOpenReferral={onOpenReferral}
        onOpenHow={onOpenHow}
        isMerchant
      />
      <div className="hidden lg:grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3 lg:items-stretch">
        <div className="lg:col-span-6">
          <HeroCard
            referralUnit={referralUnit}
            onOpenReferral={onOpenReferral}
            onOpenHow={onOpenHow}
          />
        </div>
        <div className="lg:col-span-3">
          <ReferralCodeCard
            referralCode={referralCode}
            referralLink={referralLink}
            referralUnit={referralUnit}
            copied={copied}
            copiedLink={copiedLink}
            onCopyCode={onCopyCode}
            onCopyLink={onCopyLink}
            onOpenReferral={onOpenReferral}
            isMerchant
          />
        </div>
        <div className="hidden lg:block lg:col-span-3">
          <RealTimeActivityCard leaderboard={leaderboard} />
        </div>
      </div>

      {/* Below the top row: LEFT (Onboard + Stats + Quests + P2P)
          | MIDDLE (Progress + Leaderboard) | RIGHT (Steps) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3 lg:items-stretch">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-6 flex flex-col gap-3">
          {/* Merchant Onboarding CTA */}
          <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-4 md:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${onboardDone ? 'opacity-70' : ''}`}>
            <div className="flex items-center gap-3.5 min-w-0">
              <div className={`w-11 h-11 rounded-xl ${t.inputBg} border ${t.border} flex items-center justify-center shrink-0`}>
                <Store className={`w-[18px] h-[18px] ${t.txt}`} strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <p className={`text-[14px] font-semibold ${t.txt} tracking-tight`}>Join Merchant On Board Program</p>
                  {/* <span
                    className="text-[11px] font-semibold tracking-tight px-2 py-0.5 rounded-full"
                    style={{ background: 'rgba(204,120,92,0.10)', color: ACCENT }}
                  >
                    +500 BLIP
                  </span> */}
                </div>
                <p className={`text-[12px] ${t.muted} leading-snug`}>
                  Submit this Google Form to join our merchant onboarding program and earn 500 pts.
                </p>
              </div>
            </div>
            {onboardDone ? (
              <span className="inline-flex items-center gap-1.5 px-4 py-2 text-[12px] font-semibold text-emerald-500 whitespace-nowrap shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" /> Redeemed
              </span>
            ) : (
              <a
                href={ONBOARD_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={`${t.accentBg} ${t.accentText} px-5 py-3 rounded-full text-[12px] font-semibold tracking-tight hover:-translate-y-[1px] active:scale-[0.99] transition shadow-[0_8px_22px_-10px_rgba(0,0,0,0.35)] flex items-center gap-2 shrink-0`}
              >
                Submit Form
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Your Referral Stats — hidden on mobile (the mobile "Your
              Overview" card above already shows these figures). */}
          <div className={`hidden lg:block ${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-4 md:p-5`}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: ACCENT }} />
              <span className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub}`}>
                Your Referral Stats
              </span>
            </div>
            <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-0 lg:divide-x ${t.divider}`}>
              <StatCell icon={<Target className={`w-4 h-4 lg:w-5 lg:h-5 ${t.txt}`} />} value={referralCount} unit="" label="Total Referrals" hint="All time" position="first" />
              <StatCell icon={<BadgeCheck className={`w-4 h-4 lg:w-5 lg:h-5 ${t.txt}`} />} value={questsCompleted} unit="" label="Completed Quests" hint={`${questsCompleted} of 4`} />
              <StatCell icon={<UserPlus className={`w-4 h-4 lg:w-5 lg:h-5 ${t.txt}`} />} value={totalEarnedFromQuestsAndRef} unit="pts" label="Total Points Earned" hint="From quests + referrals" />
              <StatCell icon={<Sparkles className={`w-4 h-4 lg:w-5 lg:h-5 ${t.txt}`} />} value={pendingPoints} unit="pts" label="Pending Points" hint="Not yet credited" position="last" />
            </div>
          </div>

          {/* Social Quests */}
          <div id="social-quests">
            <div className="mb-4">
              <div className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub} mb-1`}>
                Social Quests
              </div>
              <h2 className={`text-[18px] font-semibold tracking-tight ${t.txt}`}>
                Earn points by{' '}
                <span style={{ color: ACCENT, fontStyle: 'italic' }}>completing quests.</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {quests.map((q) => {
                const existing = q.id === 'WHITEPAPER' && referralCount > 0
                  ? {
                      id: 'referral-synth',
                      task_type: 'WHITEPAPER' as TaskType,
                      status: 'VERIFIED' as TaskStatus,
                      points_awarded: totalEarnedFromQuestsAndRef,
                    }
                  : me.tasks.find((tk) => tk.task_type === q.id);
                return (
                  <QuestCard key={q.id} quest={q}
                    existing={existing}
                    onUpdate={onReload} onShareReferral={onOpenReferral} />
                );
              })}
            </div>
          </div>

          {/* Beta-access section below the quests. Desktop keeps the compact
              P2P banner; mobile gets the richer Merchant Beta Program card. */}
          <div className="hidden lg:block">
            <P2PTestBanner
              betaRequest={me.beta_request}
              socialQuestsDone={socialQuestsDone}
              onSendRequest={onOpenBeta}
            />
          </div>
          <MerchantBetaProgramCard
            betaRequest={me.beta_request}
            socialQuestsDone={socialQuestsDone}
            onSendRequest={onOpenBeta}
          />

          {!hasBothSegments && (
            <UpgradeCTA isMerchant onOpenUpgrade={onOpenUpgrade} />
          )}
        </div>

        {/* MIDDLE COLUMN */}
        <div className="lg:col-span-3 flex flex-col gap-3 min-w-0">
          <ProgressGauge blipPoints={blipPoints} onShowHistory={onShowHistory} />
          <LeaderboardCard leaderboard={leaderboard} onShowHistory={onShowHistory} compact />
        </div>

        {/* RIGHT COLUMN — hidden on mobile (the mobile "Your Journey" card
            above already covers the step timeline). */}
        <div className="hidden lg:flex lg:col-span-3 flex-col gap-3 min-w-0">
          <ProgressStepsCard
            me={props.me}
            referralCount={referralCount}
            isMerchant
          />
        </div>
      </div>
    </>
  );
}

// ── Layout: user — simpler 8/4 split (mirrors Dashboard.tsx)
function UserLayout(props: {
  me: WaitlistMe;
  blipPoints: number;
  referralCount: number;
  referralCode: string;
  referralLink: string;
  referralUnit: number;
  quests: ReadonlyArray<{ id: TaskType; title: string; reward: number; icon: React.ComponentType<{ className?: string }>; description: string }>;
  leaderboard: LeaderboardRow[];
  copied: boolean;
  copiedLink: boolean;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onShowHistory: () => void;
  onOpenReferral: () => void;
  onOpenHow: () => void;
  onReload: () => void;
  hasBothSegments: boolean;
  onOpenUpgrade: () => void;
}) {
  const {
    me, blipPoints, referralCount, referralCode, referralLink, referralUnit, quests, leaderboard,
    copied, copiedLink, onCopyCode, onCopyLink, onShowHistory, onOpenReferral, onOpenHow,
    onReload, hasBothSegments, onOpenUpgrade,
  } = props;

  const t = useThemeTokens();
  const totalEarnedFromQuestsAndRef = me.tasks.filter((tk) => tk.status === 'VERIFIED').reduce((s, tk) => s + (tk.points_awarded || 0), 0)
    + me.referrals.filter((r) => r.reward_status === 'credited').reduce((s, r) => s + r.reward_amount, 0);

  return (
    <>
      {/* Top row: Hero (6) | Referral Code (3) | Real-Time Activity (3).
          On mobile, Hero + Referral Code collapse into MobileReferralCard. */}
      <MobileReferralCard
        referralCode={referralCode}
        referralLink={referralLink}
        referralUnit={referralUnit}
        copied={copied}
        copiedLink={copiedLink}
        onCopyCode={onCopyCode}
        onCopyLink={onCopyLink}
        onOpenReferral={onOpenReferral}
        onOpenHow={onOpenHow}
        isMerchant={false}
      />
      <div className="hidden lg:grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3 lg:items-stretch">
        <div className="lg:col-span-6">
          <HeroCard
            referralUnit={referralUnit}
            onOpenReferral={onOpenReferral}
            onOpenHow={onOpenHow}
          />
        </div>
        <div className="lg:col-span-3">
          <ReferralCodeCard
            referralCode={referralCode}
            referralLink={referralLink}
            referralUnit={referralUnit}
            copied={copied}
            copiedLink={copiedLink}
            onCopyCode={onCopyCode}
            onCopyLink={onCopyLink}
            onOpenReferral={onOpenReferral}
            isMerchant={false}
          />
        </div>
        <div className="hidden lg:block lg:col-span-3">
          <RealTimeActivityCard leaderboard={leaderboard} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3 lg:items-stretch">
        {/* LEFT — Quests + Invite */}
        <div className="lg:col-span-8 flex flex-col gap-3">
          <div id="social-quests">
            <div className="mb-4">
              <div className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub} mb-1`}>
                Social Quests
              </div>
              <h2 className={`text-[18px] font-semibold tracking-tight ${t.txt}`}>
                Earn points by{' '}
                <span style={{ color: ACCENT, fontStyle: 'italic' }}>completing quests.</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {quests.map((q) => {
                const existing = q.id === 'WHITEPAPER' && referralCount > 0
                  ? {
                      id: 'referral-synth',
                      task_type: 'WHITEPAPER' as TaskType,
                      status: 'VERIFIED' as TaskStatus,
                      points_awarded: totalEarnedFromQuestsAndRef,
                    }
                  : me.tasks.find((tk) => tk.task_type === q.id);
                return (
                  <QuestCard key={q.id} quest={q}
                    existing={existing}
                    onUpdate={onReload} onShareReferral={onOpenReferral} />
                );
              })}
            </div>
          </div>

          {/* Invite Friends */}
          <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${t.inputBg} border ${t.border} flex items-center justify-center shrink-0`}>
                <UsersIcon className={`w-5 h-5 ${t.txt}`} />
              </div>
              <div>
                <p className={`text-sm font-semibold ${t.txt}`}>Invite Friends. Earn More.</p>
                <p className={`text-[11px] ${t.muted} leading-relaxed`}>
                  Earn {formatCount(USER_BLIP_POINTS.REFERRAL)} pts per user signup — {formatCount(MERCHANT_BLIP_POINTS.REFERRAL)} pts if they join as a merchant.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 w-full md:w-auto">
              <div>
                <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${t.sub}`}>Your Referrals</p>
                <p className={`text-lg font-semibold ${t.txt} leading-tight`}>{referralCount}</p>
              </div>
              <button
                onClick={onOpenReferral}
                className={`${t.inputBg} border ${t.border} rounded-full px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${t.txt} ${t.hov} transition`}
              >
                View Referrals
              </button>
            </div>
          </div>

          {!hasBothSegments && (
            <UpgradeCTA isMerchant={false} onOpenUpgrade={onOpenUpgrade} />
          )}
        </div>

        {/* RIGHT — Progress + Leaderboard */}
        <div className="lg:col-span-4 flex flex-col gap-3">
          <ProgressGauge blipPoints={blipPoints} onShowHistory={onShowHistory} />
          <LeaderboardCard leaderboard={leaderboard} onShowHistory={onShowHistory} />
        </div>
      </div>
    </>
  );
}

// ── Mobile referral card — merges the Hero + Referral-Code surfaces into
// a single premium, centred card (lg:hidden). On lg+ the original
// HeroCard + ReferralCodeCard split layout takes over. Pure presentation:
// every action reuses the same handlers as the desktop cards.
function MobileReferralCard({
  referralCode, referralLink, referralUnit, copied, copiedLink,
  onCopyCode, onCopyLink, onOpenReferral, onOpenHow, isMerchant,
}: {
  referralCode: string; referralLink: string; referralUnit: number;
  copied: boolean; copiedLink: boolean;
  onCopyCode: () => void; onCopyLink: () => void;
  onOpenReferral: () => void; onOpenHow: () => void; isMerchant: boolean;
}) {
  const t = useThemeTokens();
  const tweetText = `Join Blip Market with my referral code ${referralCode}! ${referralLink}`;
  const codeTint = t.d ? 'rgba(204,120,92,0.07)' : 'rgba(204,120,92,0.045)';

  return (
    <div className={`lg:hidden ${t.surface} border ${t.border} ${t.cardShadow} rounded-[24px] p-6 shadow-sm mb-3`}>
      {/* Header — circular icon, title, description (centred) */}
      <div className="flex flex-col items-center text-center gap-3.5">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(204,120,92,0.12)' }}
        >
          <UserPlus className="w-6 h-6" style={{ color: ACCENT }} />
        </div>
        <h2 className="text-[30px] font-bold leading-[1.08] tracking-tight">
          <span className={t.txt}>Refer Friends. </span>
          <span style={{ color: ACCENT }}>Earn More.</span>
        </h2>
        <p className={`text-[14px] ${t.muted} leading-relaxed max-w-[21rem]`}>
          Invite your friends to Blip Market and earn{' '}
          <span className={`font-semibold ${t.txt}`}>{formatCount(referralUnit)} pts</span> for each
          successful referral. There&apos;s no limit to how much you can earn.
        </p>
      </div>

      {/* Action buttons — equal-width, side-by-side */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        <button
          onClick={onOpenReferral}
          className={`${t.accentBg} ${t.accentText} h-12 rounded-xl text-[11px] font-semibold uppercase tracking-[0.08em] flex items-center justify-center gap-2 active:scale-[0.98] transition whitespace-nowrap`}
        >
          <Share2 className="w-3.5 h-3.5 shrink-0" />
          Share Code
        </button>
        <button
          onClick={onOpenHow}
          className={`${t.inputBg} border ${t.border} ${t.txt} h-12 rounded-xl text-[11px] font-semibold uppercase tracking-[0.08em] flex items-center justify-center gap-2 ${t.hov} transition whitespace-nowrap`}
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          How It Works
        </button>
      </div>

      {/* Divider */}
      <div className={`border-t ${t.divider} my-6`} />

      {/* Referral code */}
      <span className={`block text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub} mb-3`}>
        Your Referral Code
      </span>
      <div
        className="flex items-center justify-between rounded-xl px-4 py-4 border"
        style={{ borderColor: `${ACCENT}55`, background: codeTint }}
      >
        <span className={`text-[24px] font-bold ${t.txt} tracking-[0.06em] truncate`}>
          {referralCode || '—'}
        </span>
        <button
          onClick={onCopyCode}
          className="p-2.5 rounded-lg shrink-0 ml-2"
          style={{ background: 'rgba(204,120,92,0.12)' }}
          aria-label="Copy referral code"
        >
          {copied
            ? <Check className="w-[18px] h-[18px] text-emerald-500" />
            : <Copy className="w-[18px] h-[18px]" style={{ color: ACCENT }} />}
        </button>
      </div>
      <p className={`text-[13px] ${t.muted} leading-relaxed mt-3`}>
        {isMerchant
          ? <>Share your code or link and earn <span className={`font-semibold ${t.txt}`}>{formatCount(referralUnit)} pts</span> for each successful referral.</>
          : <>Earn <span className={`font-semibold ${t.txt}`}>{formatCount(USER_BLIP_POINTS.REFERRAL)} pts</span> per user signup or <span className={`font-semibold ${t.txt}`}>{formatCount(MERCHANT_BLIP_POINTS.REFERRAL)} pts</span> per merchant signup.</>}
      </p>

      {/* Or share your link */}
      <div className="flex items-center gap-3 my-6">
        <div className={`h-px flex-1 border-t ${t.divider}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${t.sub}`}>
          Or share your link
        </span>
        <div className={`h-px flex-1 border-t ${t.divider}`} />
      </div>

      {/* Referral link */}
      <div className={`flex items-center gap-2.5 ${t.inputBg} border ${t.border} rounded-xl px-4 py-3.5`}>
        <Link2 className={`w-4 h-4 ${t.muted} shrink-0`} />
        <span className={`text-[12.5px] ${t.muted} truncate flex-1`}>{referralLink || '—'}</span>
        <button
          onClick={onCopyLink}
          className={`p-1.5 rounded ${t.hov} transition shrink-0`}
          aria-label="Copy referral link"
        >
          {copiedLink
            ? <Check className="w-4 h-4 text-emerald-500" />
            : <Copy className={`w-4 h-4 ${t.muted}`} />}
        </button>
      </div>

      {/* Social share buttons */}
      <div className="grid grid-cols-3 gap-2.5 mt-4">
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${t.inputBg} border ${t.border} rounded-xl py-3 text-[12px] font-semibold ${t.txt} flex items-center justify-center gap-2 ${t.hov} transition`}
        >
          <XLogo className="w-3.5 h-3.5" />
          <span>Twitter</span>
        </a>
        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Blip Market with my referral!')}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${t.inputBg} border ${t.border} rounded-xl py-3 text-[12px] font-semibold ${t.txt} flex items-center justify-center gap-2 ${t.hov} transition`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Telegram</span>
        </a>
        <button
          onClick={onOpenReferral}
          className={`${t.inputBg} border ${t.border} rounded-xl py-3 text-[12px] font-semibold ${t.txt} flex items-center justify-center gap-2 ${t.hov} transition`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
          <span>More</span>
        </button>
      </div>
    </div>
  );
}

// ── Hero card — split layout with text on the left, ring illustration on
// the right (image lives in /public/refer-friends-hero.png). The inline
// stats from the previous version are dropped — they're now in the
// dedicated "Your Referral Stats" 4-col strip below.
function HeroCard({
  referralUnit, onOpenReferral, onOpenHow,
}: {
  referralUnit: number;
  onOpenReferral: () => void;
  onOpenHow: () => void;
}) {
  const t = useThemeTokens();
  return (
    <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl overflow-hidden relative h-full`}>
      <div className="grid grid-cols-1 md:grid-cols-[1.25fr_1fr] h-full">
        <div className="p-6 md:p-8 flex flex-col items-center justify-center text-center gap-5">
          <h2 className="text-[26px] md:text-[31px] font-semibold leading-[1.15] tracking-tight">
            <span className={t.txt}>Refer Friends.</span>
            <br />
            <span style={{ color: ACCENT }}>Earn More.</span>
          </h2>
          <p className={`text-[13.5px] ${t.muted} max-w-md leading-[1.7]`}>
            Invite your friends to Blip Market and earn{' '}
            <span className={`font-semibold ${t.txt}`}>{formatCount(referralUnit)} pts</span> for each
            successful referral. There&apos;s no limit to how much you can earn.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onOpenReferral}
              className={`border border-[${ACCENT}]/60 ${t.accentBg} ${t.accentText} px-5 py-2 rounded-lg text-[11.5px] font-semibold uppercase tracking-[0.16em] hover:opacity-90 active:scale-[0.98] transition flex items-center gap-2`}
              style={{ borderColor: `${ACCENT}99` }}
            >
              <Share2 className="w-3.5 h-3.5" />
              Share Your Code
            </button>
            <button
              onClick={onOpenHow}
              className={`${t.inputBg} border ${t.border} ${t.txt} px-8 py-2 rounded-lg text-[11.5px] font-semibold uppercase tracking-[0.16em] ${t.hov} transition flex items-center gap-2 `}
            >
              How It Works
              <Info className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="hidden md:block relative overflow-hidden" style={{ background: '#FAF8F5' }}>
          {/* Plain <img> instead of next/image — the Image optimizer
              was producing a double-encoded /_next/image?url=/_next/image?url=…
              src on production (Next 16 + Vercel image proxy edge case),
              which 404'd and left only the alt text visible. The hero
              image lives in /public so the browser fetches it directly. */}
          <img
            src="/refer-friends-hero.jpg"
            alt="Refer friends and earn rewards"
            className="absolute inset-0 w-full h-full object-cover"
            loading="eager"
          />
        </div>
      </div>
    </div>
  );
}

// ── Real-Time Activity panel — sits in the top-right of the merchant
// dashboard, showing a live feed of recent waitlist events. Mixes the
// signed-in user's own activity (so they can see themselves rewarded)
// with a rotating mock pool of ~100 community events so the panel feels
// alive even on a fresh deploy. Visible rows reshuffle every 9 seconds.

// Mock pool — wide spread of names (individuals + merchant entities)
// and point amounts up to 7,500 so the feed shows a believable mix of
// micro-rewards (quests, referrals) and milestone payouts.
const MOCK_ACTIVITY_NAMES: ReadonlyArray<string> = [
  'Aisha K.', 'Marcus L.', 'Sofia R.', 'Diego P.', 'Yuki T.', 'Liam W.',
  'Priya N.', 'Noah B.', 'Maya S.', 'Ethan C.', 'Zara F.', 'Hugo M.',
  'Camila V.', 'Felix D.', 'Ines O.', 'Omar J.', 'Lena G.', 'Caleb H.',
  'Anika P.', 'Theo Q.', 'Isla R.', 'Mateo S.', 'Nadia T.', 'Bruno U.',
  'Sana Y.', 'Ryo K.', 'Adaeze O.', 'Tariq B.', 'Mira L.', 'Jonah F.',
  'Beatriz N.', 'Idris M.', 'Vera C.', 'Sefa E.', 'Liana D.', 'Kai R.',
  'Amara J.', 'Ravi T.', 'Selin A.', 'Otto B.', 'Anya S.', 'Rohan P.',
  'Esme K.', 'Kofi A.', 'Hana M.', 'Pablo R.', 'Yara H.', 'Dmitri Z.',
  'Iris L.', 'Quentin F.',
  'Nova Merchants', 'Titan Merchants', 'Beacon Finance', 'Orion Pay',
  'Lumen Settle', 'Atlas Exchange', 'Helio Cash', 'Vega FX',
  'Spectra OTC', 'Polaris Hub', 'Bridge & Co.', 'Continental Forex',
  'Mercato Pay', 'Sahara Stables', 'Northgate Rails', 'Tidewater Crypto',
  'Goldline Settle', 'Harbor Liquidity', 'Reverb Pay', 'Cascade FX',
  'Anchor Stablecoins', 'Pioneer Merchant', 'Mainline Wires', 'Bazaar Pay',
  'Citadel Settlement', 'Driftwood Brokers', 'Echelon Pay', 'Frontier Cash',
];

const MOCK_ACTIVITY_TEMPLATES: ReadonlyArray<{
  action: string;
  points: number | null;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  // Micro-rewards
  { action: 'Earned from Referral',          points: 50,    icon: Store      },
  { action: 'Completed Social Quest',        points: 100,   icon: Award      },
  { action: 'Joined Waitlist',               points: 50,    icon: UserPlus   },
  { action: 'Followed @blip_money on X',     points: 100,   icon: Award      },
  { action: 'Joined Telegram Community',     points: 100,   icon: Award      },
  { action: 'Retweeted Campaign',            points: 150,   icon: Award      },
  { action: 'Verified Email',                points: 200,   icon: BadgeCheck },
  // Mid-tier
  { action: 'Completed KYC Verification',    points: 250,   icon: BadgeCheck },
  { action: 'First Settlement Completed',    points: 500,   icon: Trophy     },
  { action: 'Earned Referral Bonus',         points: 500,   icon: Store      },
  { action: 'Onboarded a Merchant',          points: 750,   icon: Store      },
  { action: 'Unlocked Founder Badge',        points: 1000,  icon: Trophy     },
  // Big payouts — what the user asked to see
  { action: 'Reached 2,500 Points Tier',     points: null,  icon: Trophy     },
  { action: 'Tier Up: Reached 5,000 Points', points: null,  icon: Trophy     },
  { action: 'Top-100 Bonus Awarded',         points: 2500,  icon: Award      },
  { action: 'Founding Merchant Bonus',       points: 5000,  icon: Trophy     },
  { action: 'Leaderboard #10 Bonus',         points: 5000,  icon: Trophy     },
  { action: 'Liquidity Provider Bonus',      points: 7500,  icon: Trophy     },
  { action: 'Settled $10K in Orders',        points: 5000,  icon: Trophy     },
];

const TIME_LABELS: ReadonlyArray<string> = [
  'just now', '8 sec ago', '24 sec ago', '47 sec ago',
  '1 min ago', '2 min ago', '3 min ago', '5 min ago',
  '7 min ago', '11 min ago', '14 min ago',
];

interface ActivityRow {
  id: string;
  name: string;
  action: string;
  points: number | null;
  icon: React.ComponentType<{ className?: string }>;
  time: string;
  highlight?: boolean;
}

// Pull six pseudo-random rows from the mock pool. The signed-in user
// is intentionally NOT pinned into the feed — it's a community pulse,
// not a personal history. (User's own earnings live in the BLIP points
// total + reward history modal.)
function buildActivityRows(seed: number): ActivityRow[] {
  // Mulberry32-style deterministic pick keyed off `seed` so the same
  // seed always produces the same shuffle (predictable for tests, fresh
  // for each interval tick).
  let s = seed | 0;
  const rand = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rows: ActivityRow[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < 6; i++) {
    let name = MOCK_ACTIVITY_NAMES[Math.floor(rand() * MOCK_ACTIVITY_NAMES.length)];
    let guard = 0;
    while (usedNames.has(name) && guard++ < 12) {
      name = MOCK_ACTIVITY_NAMES[Math.floor(rand() * MOCK_ACTIVITY_NAMES.length)];
    }
    usedNames.add(name);

    const tpl = MOCK_ACTIVITY_TEMPLATES[Math.floor(rand() * MOCK_ACTIVITY_TEMPLATES.length)];
    const time = TIME_LABELS[i] ?? TIME_LABELS[TIME_LABELS.length - 1];

    rows.push({
      id: `m${seed}-${i}`,
      name,
      action: tpl.action,
      points: tpl.points,
      icon: tpl.icon,
      time,
    });
  }
  return rows;
}

function RealTimeActivityCard({
  leaderboard,
}: {
  leaderboard: LeaderboardRow[];
}) {
  const t = useThemeTokens();
  // `leaderboard` is preserved on the prop signature so existing call
  // sites keep compiling, but the feed pulls from a mock community
  // pool so the panel feels alive on a fresh deploy.
  void leaderboard;

  const [seed, setSeed] = React.useState(() => Math.floor(Math.random() * 0xffffffff));
  React.useEffect(() => {
    // 3.5-minute rotation — slow enough that users don't see the feed
    // constantly churning while they read, fresh enough that it still
    // reads as "live" on the next visit.
    const id = setInterval(() => {
      setSeed(Math.floor(Math.random() * 0xffffffff));
    }, 210_000);
    return () => clearInterval(id);
  }, []);

  const rows = React.useMemo(() => buildActivityRows(seed), [seed]);

  return (
    <div
      id="dash-activity"
      className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl overflow-hidden flex flex-col h-full`}
    >
      <div className={`px-5 py-3 border-b ${t.divider} flex items-center justify-between`}>
        <span className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub}`}>
          Real-Time Activity
        </span>
        <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-tight ${t.sub}`}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: `${ACCENT}99` }} />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: ACCENT }} />
          </span>
          Live
        </span>
      </div>

      <div className="py-1 max-h-[320px] overflow-y-auto flex-1">
        {rows.map((a) => {
          const Icon = a.icon;
          return (
            <div
              key={a.id}
              className={`flex items-center justify-between px-5 py-2.5 ${t.hov} transition`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${t.inputBg} border ${t.border}`}>
                  <Icon className={`w-[15px] h-[15px] ${t.muted}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold ${t.txt} truncate tracking-tight`}>
                    {a.name}
                  </p>
                  <p className={`text-[11.5px] ${t.muted} truncate leading-snug`}>
                    {a.action}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0 ml-3 flex flex-col items-end gap-0.5">
                {a.points !== null && (
                  <span
                    className="text-[11px] font-semibold tracking-tight px-2 py-0.5 rounded-full tabular-nums"
                    style={{ background: 'rgba(204,120,92,0.10)', color: ACCENT }}
                  >
                    +{a.points.toLocaleString('en-US')} pts
                  </span>
                )}
                <span className={`text-[10.5px] ${t.sub} leading-tight tabular-nums`}>
                  {a.time}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className={`w-full px-5 py-3 border-t ${t.divider} flex items-center justify-between text-[12px] font-semibold ${t.txt} hover:opacity-70 transition`}
      >
        View all activity
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Referral Code card — clickable card, opens ReferralModal on click. ─
function ReferralCodeCard({
  referralCode, referralLink, referralUnit, copied, copiedLink, onCopyCode, onCopyLink, onOpenReferral, isMerchant,
}: {
  referralCode: string; referralLink: string; referralUnit: number;
  copied: boolean; copiedLink: boolean;
  onCopyCode: () => void; onCopyLink: () => void; onOpenReferral: () => void;
  isMerchant: boolean;
}) {
  const t = useThemeTokens();
  const tweetText = `Join Blip Market with my referral code ${referralCode}! ${referralLink}`;
  return (
    <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-6 flex flex-col gap-4 h-full`}>
      <span className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub}`}>
        Your Referral Code
      </span>

      <div className={`flex items-center justify-between ${t.inputBg} border rounded-lg px-4 py-3.5`}
        style={{ borderColor: `${ACCENT}66` }}>
        <span className={`text-[20px] md:text-[22px] font-semibold ${t.txt} tracking-[0.08em]`}>
          {referralCode || '—'}
        </span>
        <button
          onClick={onCopyCode}
          className="p-2 rounded-md transition shrink-0"
          style={{ background: 'rgba(204,120,92,0.10)' }}
          aria-label="Copy referral code"
        >
          {copied
            ? <Check className="w-4 h-4 text-emerald-500" />
            : <Copy className="w-4 h-4" style={{ color: ACCENT }} />}
        </button>
      </div>

      <p className={`text-[12.5px] ${t.muted} leading-relaxed`}>
        {isMerchant
          ? <>Share your code or link and earn <span className={`font-semibold ${t.txt}`}>{formatCount(referralUnit)} pts</span> for each successful referral.</>
          : <>Earn <span className={`font-semibold ${t.txt}`}>{formatCount(USER_BLIP_POINTS.REFERRAL)} pts</span> per user signup or <span className={`font-semibold ${t.txt}`}>{formatCount(MERCHANT_BLIP_POINTS.REFERRAL)} pts</span> per merchant signup.</>}
      </p>

      {/* mt-auto pushes the divider + link + share-buttons block to the
          bottom of the card so the h-full stretch doesn't leave dead
          space at the bottom. Result: when the card is taller than its
          natural content height (because the neighboring Real-Time
          Activity panel sets the row height), the extra space lands
          between the body paragraph and the divider, not at the very
          bottom. */}
      <div className="mt-auto flex items-center gap-3">
        <div className={`h-px flex-1 border-t ${t.divider}`} />
        <span className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${t.sub}`}>
          Or share your link
        </span>
        <div className={`h-px flex-1 border-t ${t.divider}`} />
      </div>

      <div className={`flex items-center justify-between ${t.inputBg} border ${t.border} rounded-lg px-3.5 py-2.5`}>
        <span className={`text-[12px] ${t.muted} truncate mr-2`}>{referralLink || '—'}</span>
        <button
          onClick={onCopyLink}
          className={`p-1.5 rounded ${t.hov} transition shrink-0`}
          aria-label="Copy referral link"
        >
          {copiedLink
            ? <Check className="w-4 h-4 text-emerald-500" />
            : <Copy className={`w-4 h-4 ${t.muted}`} />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${t.inputBg} border ${t.border} rounded-lg px-3 py-2.5 text-[12px] font-semibold ${t.txt} flex items-center justify-center gap-2 ${t.hov} transition`}
        >
          <XLogo className="w-3.5 h-3.5" />
          <span>Twitter</span>
        </a>
        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join Blip Market with my referral!')}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${t.inputBg} border ${t.border} rounded-lg px-3 py-2.5 text-[12px] font-semibold ${t.txt} flex items-center justify-center gap-2 ${t.hov} transition`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>Telegram</span>
        </a>
        <button
          onClick={onOpenReferral}
          className={`${t.inputBg} border ${t.border} rounded-lg px-3 py-2.5 text-[12px] font-semibold ${t.txt} flex items-center justify-center gap-2 ${t.hov} transition`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
          <span>More</span>
        </button>
      </div>
    </div>
  );
}

// ── Progress gauge — half-circle SVG (no recharts). Source: MerchantDashboard.tsx
// lines 1866–1985.
function ProgressGauge({ blipPoints, onShowHistory }: { blipPoints: number; onShowHistory: () => void }) {
  const t = useThemeTokens();
  const milestones = [100, 250, 500, 1000, 2500];
  const next = milestones.find((m) => m > blipPoints) ?? milestones[milestones.length - 1];
  const prev = [0, ...milestones].filter((m) => m <= blipPoints).pop() ?? 0;
  const span = Math.max(1, next - prev);
  const progress = Math.min(1, Math.max(0, (blipPoints - prev) / span));
  const R = 58;
  const CIRC = Math.PI * R;
  const TRACK = t.d ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';

  return (
    <div id="dash-progress" className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-5`}>
      <div className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub} mb-4`}>
        Your Progress
      </div>

      <div className="flex flex-col items-center mb-5">
        <div className="relative w-[180px] h-[100px]">
          <svg viewBox="0 0 140 80" className="w-full h-full overflow-visible" aria-hidden>
            <path
              d="M 12 72 A 58 58 0 0 1 128 72"
              fill="none"
              stroke={TRACK}
              strokeWidth="6"
              strokeLinecap="round"
            />
            <path
              d="M 12 72 A 58 58 0 0 1 128 72"
              fill="none"
              stroke={ACCENT}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${progress * CIRC} ${CIRC}`}
              style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.16,1,0.3,1)' }}
            />
          </svg>
          <div className="absolute inset-x-0 bottom-1 flex flex-col items-center">
            <p
              className={`${t.txt} tabular-nums leading-none`}
              style={{ fontSize: '30px', fontWeight: 600, letterSpacing: '-0.03em' }}
            >
              {formatCount(blipPoints)}
            </p>
            <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${t.sub} mt-1`}>
              Total Points
            </p>
          </div>
        </div>
        {/* <p className={`text-[11.5px] ${t.muted} mt-2`}>
          Next milestone: <span className="font-semibold" style={{ color: ACCENT }}>{formatCount(next)} pts</span>
        </p> */}
        <button onClick={onShowHistory} className={`text-[10px] font-semibold ${t.muted} hover:${t.txt} transition-colors`}>
          All Points
        </button>
      </div>

      <ReputationCoinBadge variant="card" className="my-2" />

      <div className={`pt-3 border-t ${t.divider} space-y-2.5`}>
        {milestones.map((m) => {
          const achieved = blipPoints >= m;
          const isNext = m === next && !achieved;
          return (
            <div key={m} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span
                  className="inline-block w-[7px] h-[7px] rounded-full"
                  style={{
                    background: achieved ? ACCENT : isNext ? 'transparent' : (t.d ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'),
                    border: isNext ? `1.5px solid ${ACCENT}` : 'none',
                  }}
                />
                <span className={`text-[12.5px] font-semibold ${achieved ? t.txt : t.muted} tabular-nums tracking-tight`}>
                  {formatCount(m)} pts
                </span>
              </div>
              {achieved && <Check className={`w-3.5 h-3.5 ${t.txt}`} strokeWidth={2.5} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Leaderboard card. Source: Dashboard.tsx 1543–1604 (and MerchantDashboard
// equivalent at 1987–2058).
function LeaderboardCard({
  leaderboard, onShowHistory, compact = false,
}: { leaderboard: LeaderboardRow[]; onShowHistory: () => void; compact?: boolean }) {
  const t = useThemeTokens();
  const avatarBg = t.d ? 'from-white to-white/70' : 'from-black to-black/70';
  const avatarText = t.d ? 'text-black' : 'text-white';
  return (
    <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0`}>
      <div className={`px-4 py-2.5 border-b ${t.divider} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Trophy className={`w-3.5 h-3.5 ${t.txt}`} />
          <span className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub}`}>
            Leaderboard
          </span>
        </div>
        <button onClick={onShowHistory} className={`text-[10px] font-semibold ${t.muted} hover:${t.txt} transition-colors`}>
          View All
        </button>
      </div>
      <div className={`px-1.5 py-1 ${compact ? 'max-h-[260px]' : 'max-h-[260px]'} overflow-y-auto flex-1`}>
        {leaderboard.length === 0 ? (
          <div className={`text-center py-8 text-xs ${t.sub}`}>No one on the board yet. Be the first!</div>
        ) : (
          leaderboard.slice(0, compact ? 5 : 10).map((row, i) => {
            const rank = i + 1;
            const name = row.display_name || row.username || '—';
            return (
              <div key={`${row.actor_type}:${row.actor_id}`}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg ${t.hov} cursor-pointer`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-4 shrink-0 flex items-center justify-center">
                    {rank <= 3
                      ? <Crown className={`w-3.5 h-3.5 ${t.txt}`} />
                      : <span className={`text-[11px] font-semibold ${t.sub}`}>{rank}</span>}
                  </span>
                  <div className={`w-5 h-5 rounded-full bg-gradient-to-tr ${avatarBg} flex items-center justify-center ${avatarText} text-[8px] font-semibold uppercase shrink-0`}>
                    {name[0]}
                  </div>
                  <span className={`text-[11px] font-semibold ${t.txt} truncate`}>{name}</span>
                  <CircleCheck className={`w-3 h-3 ${t.sub} shrink-0`} />
                </div>
                <span className={`text-[11px] font-semibold ${t.txt} shrink-0 tabular-nums`}>{formatCount(row.blip_points)} pts</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Progress Steps card (Sub-col B). Mirrors the "Your Progress & Steps"
// timeline from MerchantDashboard.tsx with an animated active dot and
// a connector line.
function ProgressStepsCard({
  me, referralCount, isMerchant,
}: { me: WaitlistMe; referralCount: number; isMerchant: boolean }) {
  const t = useThemeTokens();
  const hasVerified = (type: TaskType) => me.tasks.some((tk) => tk.task_type === type && tk.status === 'VERIFIED');
  const allSocialDone = hasVerified('TWITTER') && hasVerified('TELEGRAM') && hasVerified('CUSTOM');
  const onboardDone = hasVerified('ONBOARD_FORM');
  const referredEnough = referralCount >= 3;
  const betaState = me.beta_request?.status ?? null;

  type Status = 'done' | 'active' | 'locked';

  const rawSteps: Array<{ id: number; title: string; desc: string; done: boolean }> = [
    { id: 1, title: 'Sign up', desc: 'Welcome to the Blip waitlist.', done: true },
    { id: 2, title: 'Complete Social Quests', desc: 'Twitter, Telegram, and retweet quests.', done: allSocialDone },
    { id: 3, title: 'Refer 3 friends', desc: `${referralCount} of 3 referrals so far.`, done: referredEnough },
    ...(isMerchant
      ? [
          { id: 4, title: 'Join Merchant Onboard Program', desc: 'Submit the Google Form (+500 pts).', done: onboardDone },
          { id: 5, title: 'Request P2P App Test access', desc: betaState ? `Status: ${betaState}` : 'Send a request for beta access.', done: betaState === 'approved' },
        ]
      : []),
  ];

  let firstUnfinished = false;
  const steps = rawSteps.map((s) => {
    let status: Status;
    if (s.done) status = 'done';
    else if (!firstUnfinished) { status = 'active'; firstUnfinished = true; }
    else status = 'locked';
    return { ...s, status };
  });

  const checkBg = t.d ? 'bg-white' : 'bg-black';
  const checkText = t.d ? 'text-black' : 'text-white';
  const connectorColor = t.d ? 'bg-white/10' : 'bg-black/10';

  return (
    <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0`}>
      <div className={`px-4 py-2.5 border-b ${t.divider}`}>
        <span className={`text-[10.5px] font-semibold uppercase tracking-[0.2em] ${t.sub}`}>
          Your Progress &amp; Steps
        </span>
      </div>
      <div className="p-5 space-y-4">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const isDone = step.status === 'done';
          const isActive = step.status === 'active';
          return (
            <div key={step.id} className="relative flex items-start gap-3.5">
              {!isLast && (
                <div className={`absolute left-[10px] top-6 h-[calc(100%+8px)] w-px ${connectorColor}`} />
              )}
              <div className="shrink-0 pt-0.5">
                {isDone ? (
                  <div className={`w-[20px] h-[20px] rounded-full ${checkBg} flex items-center justify-center`}>
                    <Check className={`w-[11px] h-[11px] ${checkText}`} strokeWidth={3} />
                  </div>
                ) : isActive ? (
                  <div className="relative w-[20px] h-[20px] rounded-full flex items-center justify-center">
                    <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'rgba(204,120,92,0.20)' }} />
                    <span className="relative w-[8px] h-[8px] rounded-full" style={{ background: ACCENT }} />
                  </div>
                ) : (
                  <div className={`w-[20px] h-[20px] rounded-full border ${t.border} flex items-center justify-center`}>
                    <span className={`text-[10px] font-semibold ${t.sub}`} style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                      {step.id}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[13px] font-semibold ${t.txt} tracking-tight`}>{step.title}</p>
                <p className={`text-[11.5px] ${t.muted} leading-snug mt-0.5`}>{step.desc}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Merchant P2P beta banner. Source: MerchantDashboard.tsx 1704–1755.
// Button state mirrors the actor's latest BetaRequest row. Shown on
// desktop (lg+) — mobile uses the richer MerchantBetaProgramCard below.
function P2PTestBanner({
  betaRequest, socialQuestsDone, onSendRequest,
}: {
  betaRequest: BetaRequest | null;
  socialQuestsDone: boolean;
  onSendRequest: () => void;
}) {
  const t = useThemeTokens();
  const status = betaRequest?.status ?? null;
  const isOpen = status === 'pending' || status === 'contacted';
  const isApproved = status === 'approved';
  // Honour the inline "Complete Social Quests to unlock" copy: the
  // Send Request CTA only becomes pressable once the three social
  // quests (X follow, Telegram join, retweet) are verified.
  const locked = !socialQuestsDone && status == null;

  let buttonText = 'Send Request';
  if (locked) buttonText = 'Complete Quests';
  else if (status === 'pending') buttonText = 'Request Sent';
  else if (status === 'contacted') buttonText = "We've Been In Touch";
  else if (isApproved) buttonText = 'Approved ✓';
  const disabled = locked || isOpen || isApproved;

  return (
    <div className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl overflow-hidden`}>
      <div className={`px-4 py-2.5 flex items-center justify-between border-b ${t.divider}`}>
        <div className="flex items-center gap-2">
          <Rocket className={`w-3.5 h-3.5 ${t.txt}`} />
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${t.txt}`}>
            Merchant Beta
          </span>
          <span className="px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 rounded-full">
            On Mainnet
          </span>
        </div>
      </div>
      <div className="px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <h4 className={`text-xs font-semibold ${t.txt} leading-tight`}>
            Request for Merchant P2P App Test
          </h4>
          <p className={`text-[10px] ${t.muted} mt-1 leading-relaxed`}>
            Complete Social Quests to{' '}
            <span className={t.d ? 'text-white/80' : 'text-black/80'}>unlock the ability to send your request</span>
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={disabled ? undefined : onSendRequest}
          className={`px-4 py-2 text-[11px] font-semibold rounded-full transition-colors shrink-0 ${
            isApproved
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 cursor-default'
              : isOpen || locked
                ? `${t.inputBg} border ${t.border} ${t.sub} cursor-not-allowed`
                : `${t.accentBg} ${t.accentText} hover:opacity-90`
          }`}
        >
          {buttonText}
        </button>
      </div>
    </div>
  );
}

// ── Merchant Beta Program card — richer beta-access section shown below
// the social quests on mobile only (lg:hidden). Same gating/state logic as
// P2PTestBanner (quests must be verified before the request unlocks).
function MerchantBetaProgramCard({
  betaRequest, socialQuestsDone, onSendRequest,
}: {
  betaRequest: BetaRequest | null;
  socialQuestsDone: boolean;
  onSendRequest: () => void;
}) {
  const t = useThemeTokens();
  const status = betaRequest?.status ?? null;
  const isOpen = status === 'pending' || status === 'contacted';
  const isApproved = status === 'approved';
  const locked = !socialQuestsDone && status == null;

  let buttonText = 'Request Beta Access';
  if (locked) buttonText = 'Complete Quests to Unlock';
  else if (status === 'pending') buttonText = 'Request Sent';
  else if (status === 'contacted') buttonText = "We've Been In Touch";
  else if (isApproved) buttonText = 'Approved ✓';
  const disabled = locked || isOpen || isApproved;

  const benefits = [
    'Early access to P2P App',
    'Founding Merchant badge',
    'Priority support',
    'Future rewards and incentives',
  ];

  return (
    <div className={`lg:hidden ${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-5`}>
      <div className="flex items-center gap-2.5 mb-1.5">
        <h3 className={`text-[18px] font-semibold ${t.txt} tracking-tight`}>Merchant Beta Program</h3>
        <span className="px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-500 border border-emerald-500/20 rounded-full">
          On Mainnet
        </span>
      </div>
      <p className={`text-[13px] ${t.muted} mb-4 leading-relaxed`}>
        Become one of the first merchants on Blip Market.
      </p>
      <ul className="space-y-2.5 mb-5">
        {benefits.map((b) => (
          <li key={b} className="flex items-center gap-2.5">
            <CircleCheck className="w-[18px] h-[18px] text-emerald-500 shrink-0" />
            <span className={`text-[13.5px] ${t.txt}`}>{b}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : onSendRequest}
        className={`w-full px-6 py-3.5 rounded-full text-[14px] font-semibold tracking-tight flex items-center justify-center gap-2 transition ${
          isApproved
            ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 cursor-default'
            : isOpen || locked
              ? `${t.inputBg} border ${t.border} ${t.sub} cursor-not-allowed`
              : `${t.accentBg} ${t.accentText} hover:-translate-y-[1px] active:scale-[0.99] shadow-[0_8px_22px_-10px_rgba(0,0,0,0.35)]`
        }`}
      >
        {buttonText}
        {!disabled && <ArrowRight className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ── Upgrade CTA — shown only when the actor is missing the other segment
// (e.g. user without merchant signup, or vice-versa).
function UpgradeCTA({ isMerchant, onOpenUpgrade }: { isMerchant: boolean; onOpenUpgrade: () => void }) {
  const t = useThemeTokens();
  return (
    <button onClick={onOpenUpgrade}
      className={`${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-4 flex items-center justify-between gap-3 text-left ${t.hov} transition`}>
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full ${t.inputBg} border ${t.border} flex items-center justify-center shrink-0`}>
          {isMerchant ? <UsersIcon className={`w-5 h-5 ${t.txt}`} /> : <Store className={`w-5 h-5 ${t.txt}`} />}
        </div>
        <div>
          <p className={`text-sm font-semibold ${t.txt}`}>
            {isMerchant ? 'Also a trader? Join as user.' : 'Run a business? Become a merchant.'}
          </p>
          <p className={`text-[11px] ${t.muted} leading-relaxed`}>
            {isMerchant
              ? `+${formatCount(USER_BLIP_POINTS.REGISTER)} BLIP, one click, same login.`
              : `+${formatCount(MERCHANT_BLIP_POINTS.REGISTER)} BLIP + merchant quests.`}
          </p>
        </div>
      </div>
      <span className={`${t.accentBg} ${t.accentText} px-4 py-2 rounded-full text-[11px] font-semibold uppercase tracking-[0.14em] hover:opacity-90 transition`}>
        {isMerchant ? 'Join as user' : 'Become merchant'} →
      </span>
    </button>
  );
}

// ── Stat cell — used inside the "Your Referral Stats" 4-col grid. On
// mobile this is a standalone card; on md+ it sits inside a divide-x row
// with no background.
function StatCell({
  icon, value, unit, label, hint, position,
}: {
  icon: React.ReactNode; value: number; unit: string; label: string; hint: string;
  position?: 'first' | 'last';
}) {
  const t = useThemeTokens();
  const lgPadding = position === 'first' ? 'lg:first:pl-0' : position === 'last' ? 'lg:last:pr-0' : '';
  // Icon-on-top stack at every breakpoint. The icon-left horizontal
  // variant we tried at lg was breaking when long labels like "Total
  // Points Earned" wrapped — the icon stayed centered while the right
  // column grew taller, making the four cells look misaligned. A
  // consistent vertical stack keeps every cell the same shape; the
  // parent grid's lg:divide-x still produces the horizontal strip.
  // Mobile fill uses arbitrary rgba so the global `bg-white/X` remap
  // can't override the desktop `lg:bg-transparent`.
  const mobileFill = t.d
    ? 'bg-[rgba(255,255,255,0.04)]'
    : 'bg-[rgba(0,0,0,0.025)]';
  return (
    <div
      className={`flex flex-col items-start gap-2.5 p-3 lg:p-0 lg:px-5 lg:py-1 ${mobileFill} border ${t.border} rounded-lg lg:bg-transparent lg:border-0 lg:rounded-none ${lgPadding}`}
    >
      <div className={`w-10 h-10 rounded-lg ${t.surface} border ${t.border} flex items-center justify-center shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className={`text-2xl font-semibold ${t.txt} leading-tight tabular-nums whitespace-nowrap`}>
          {formatCount(value)}{unit && <span className={`text-xs font-semibold ml-1 ${t.muted}`}>{unit}</span>}
        </p>
        <p className={`text-[12px] font-semibold ${t.txt} leading-tight mt-1.5`}>{label}</p>
        <p className={`text-[10.5px] ${t.sub} leading-snug mt-0.5`}>{hint}</p>
      </div>
    </div>
  );
}

// ── Quest card. Source: MerchantDashboard.tsx 1641–1700 (pill button,
// rounded-2xl, w-9 h-9 rounded-xl icon container, accent reward chip).
function QuestCard({ quest, existing, onUpdate, onShareReferral }: {
  quest: { id: TaskType; title: string; reward: number; icon: React.ComponentType<{ className?: string }>; description: string };
  existing: Task | undefined;
  onUpdate: () => void;
  onShareReferral: () => void;
}) {
  const t = useThemeTokens();
  const isDone = existing?.status === 'VERIFIED';
  const [modalOpen, setModalOpen] = useState(false);

  async function ensureTaskId(): Promise<string | null> {
    if (existing?.id) return existing.id;
    try {
      const res = await fetchWithAuth('/api/waitlist/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_type: quest.id }),
      });
      const data = await res.json();
      return data?.success ? (data.data.task.id as string) : null;
    } catch { return null; }
  }

  function handleStart() {
    if (quest.id === 'WHITEPAPER') { onShareReferral(); return; }
    setModalOpen(true);
  }

  const QuestIcon = quest.icon;

  const rewardPill = (
    <span
      className="text-[11px] font-semibold tracking-tight whitespace-nowrap px-2 py-0.5 rounded-full shrink-0"
      style={{ background: 'rgba(204,120,92,0.10)', color: ACCENT }}
    >
      +{formatCount(quest.reward)} BLIP
    </span>
  );

  return (
    <>
      {/* Mobile: compact horizontal card (icon · content · action on one
          axis). Matches the reference layout. md+ keeps the vertical card. */}
      <div className={`md:hidden ${t.surface} border ${t.border} rounded-2xl p-3 flex items-center gap-3 shadow-sm ${isDone ? 'opacity-80' : ''}`}>
        <div className={`w-11 h-11 rounded-xl ${t.inputBg} border ${t.border} flex items-center justify-center shrink-0`}>
          <QuestIcon className={`w-[18px] h-[18px] ${t.txt}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`text-[14px] font-semibold ${t.txt} tracking-tight truncate`}>{quest.title}</h3>
            {rewardPill}
          </div>
          <p className={`text-[12px] ${t.muted} leading-snug truncate mt-0.5`}>{quest.description}</p>
        </div>
        {isDone ? (
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-500 shrink-0">
            <CheckCircle2 className="w-4 h-4" /> Completed
          </div>
        ) : (
          <button onClick={handleStart}
            className={`${t.accentBg} ${t.accentText} px-5 py-2 rounded-full text-[13px] font-semibold tracking-tight active:scale-[0.98] transition shrink-0`}>
            Start
          </button>
        )}
      </div>

      <div className={`hidden md:flex ${t.surface} border ${t.border} ${t.cardShadow} rounded-2xl p-4 flex-col ${isDone ? 'opacity-70' : ''}`}>
        <div className="flex items-start justify-between mb-3">
          <div className={`w-9 h-9 rounded-xl ${t.inputBg} border ${t.border} flex items-center justify-center`}>
            <QuestIcon className={`w-4 h-4 ${t.txt}`} />
          </div>
          {rewardPill}
        </div>
        <div className="mb-4 flex-1 min-w-0">
          <h3 className={`text-[15.5px] font-semibold ${t.txt} mb-1 tracking-tight leading-tight break-words`}>{quest.title}</h3>
          <p className={`text-[13.5px] ${t.muted} leading-snug break-words`}>{quest.description}</p>
        </div>
        <div className={`mt-auto flex ${isDone ? 'justify-end' : 'justify-start'}`}>
          {isDone ? (
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-500">
              <CheckCircle2 className="w-4 h-4" /> Redeemed
            </div>
          ) : (
            <button onClick={handleStart}
              className={`${t.accentBg} ${t.accentText} px-6 py-3 rounded-full text-[13.5px] font-semibold tracking-tight hover:-translate-y-[1px] active:scale-[0.99] transition shadow-[0_6px_18px_-8px_rgba(0,0,0,0.35)]`}>
              Start →
            </button>
          )}
        </div>
      </div>

      {quest.id === 'TWITTER' && (
        <XFollowVerificationModal isOpen={modalOpen} onClose={() => setModalOpen(false)}
          onSuccess={onUpdate} rewardPoints={quest.reward}
          taskId={existing?.id ?? null} ensureTaskId={ensureTaskId} />
      )}
      {quest.id === 'TELEGRAM' && (
        <TelegramVerificationModal isOpen={modalOpen} onClose={() => setModalOpen(false)}
          onSuccess={onUpdate} rewardPoints={quest.reward}
          taskId={existing?.id ?? null} ensureTaskId={ensureTaskId} />
      )}
      {quest.id === 'CUSTOM' && (
        <TweetCampaignModal isOpen={modalOpen} onClose={() => setModalOpen(false)}
          onSuccess={onUpdate} rewardPoints={quest.reward}
          taskId={existing?.id ?? null} ensureTaskId={ensureTaskId} />
      )}
    </>
  );
}

// ── Navbar. No theme toggle (dark-only) and no wallet pill (no Solana
// adapter in this app context — see CLAUDE.md). Protocol Balance pill +
// settings + menu only.
function Navbar({ balance, onLogout, onShowHistory, actor }: {
  balance: number; onLogout: () => void; onShowHistory: () => void;
  actor: WaitlistMe['actor'];
}) {
  const t = useThemeTokens();
  const { toggle } = useWaitlistTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  function toggleTheme() {
    toggle();
  }

  // Navbar is theme-locked to black — matches the waitlist auth navbar
  // (WaitlistAuthNavbar) so the brand surface is consistent across the
  // pre-login and post-login waitlist surfaces. Inline styles bypass the
  // globals.css text-white rewrite that breaks token-based color in light
  // theme. Theme toggle still works for the rest of the page below.
  const navTextColor = { color: '#ffffff' };
  const navBtnStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
  };
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: '#000000',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6 md:gap-10">
          <Logo href="/waitlist" onDark />
          <nav className="hidden md:flex items-center gap-1 text-[13px] font-semibold">
            <button className="relative px-3 py-1.5 font-semibold" style={navTextColor}>
              Dashboard
              <span
                className="absolute left-2 right-2 -bottom-[22px] h-[2px]"
                style={{ background: '#ffffff' }}
              />
            </button>
          </nav>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-9 h-9 rounded-md flex items-center justify-center transition hover:opacity-90"
            style={navBtnStyle}
            aria-label={`Switch to ${t.d ? 'light' : 'dark'} theme`}
          >
            {t.d
              ? <Sun className="w-4 h-4" style={navTextColor} />
              : <Moon className="w-4 h-4" style={navTextColor} />}
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="w-9 h-9 rounded-md flex items-center justify-center transition hover:opacity-90"
              style={navBtnStyle}
              aria-label="Menu"
            >
              <Menu className="w-4 h-4" style={navTextColor} />
            </button>
            {menuOpen && (
              <div className={`absolute right-0 mt-2 w-60 ${t.surface} border ${t.border} rounded-xl shadow-xl overflow-hidden z-50`}>
                <div className={`px-4 py-3 border-b ${t.divider}`}>
                  <p className={`text-xs font-semibold ${t.txt} truncate`}>{(actor.email ?? '').split('@')[0] || actor.display_name || 'Account'}</p>
                  <p className={`text-[10px] ${t.sub} truncate`}>{actor.email}</p>
                </div>
                <button
                  type="button"
                  onClick={onShowHistory}
                  className={`w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold ${t.txt} ${t.hov} transition-colors`}
                >
                  <span>Protocol Balance</span>
                  <span className="tabular-nums">{formatCount(balance)} pts</span>
                </button>
                <button onClick={onLogout}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-red-500 ${t.hov} transition-colors border-t ${t.divider}`}>
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onLogout}
          className="flex md:hidden w-9 h-9 rounded-md items-center justify-center"
          style={navBtnStyle}
          aria-label="Logout"
        >
          <LogOut className="w-4 h-4" style={navTextColor} />
        </button>
      </div>
    </header>
  );
}

// ── Beta-access request modal ─────────────────────────────────────────
// Prompts the merchant for an expected monthly trading volume (USD) and
// POSTs to /api/waitlist/beta-request. The server snapshots the rest of
// the profile (email/name/country) so this form stays a single field.
function BetaRequestModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { surface, border, txt, sub, hov, inputBg, accentBg, accentText } = useThemeTokens();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [submitting, onClose]);

  async function submit() {
    if (submitting) return;
    setError(null);
    const parsed = Number(amount.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a positive monthly trading amount in USD.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetchWithAuth('/api/waitlist/beta-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_trading_amount_usd: parsed }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error ?? 'Request failed. Please try again.');
        return;
      }
      onSuccess();
    } catch (err) {
      console.error('[beta-request] submit failed', err);
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-request-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={() => { if (!submitting) onClose(); }}
    >
      <div
        className={`${surface} border ${border} rounded-2xl shadow-2xl w-full max-w-md p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="beta-request-title" className={`text-base font-semibold ${txt} mb-1`}>
          Request P2P App Test Access
        </h3>
        <p className={`text-xs ${sub} mb-5 leading-relaxed`}>
          Tell us how much volume you plan to trade each month. We&apos;ll review
          your request and reach out via your account email.
        </p>
        <label className={`block text-[11px] font-semibold uppercase tracking-[0.14em] ${sub} mb-2`}>
          Expected Monthly Trading Amount (USD)
        </label>
        <div className="relative mb-1">
          <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-sm ${sub}`}>$</span>
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="50,000"
            maxLength={14}
            disabled={submitting}
            className={`w-full pl-8 pr-4 py-2.5 ${inputBg} border ${border} rounded-xl text-sm ${txt} placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50`}
          />
        </div>
        <p className={`text-[10px] ${sub} mb-4`}>USD equivalent. Approximate is fine.</p>

        {error && (
          <div className="mb-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={`flex-1 py-3 rounded-full border ${border} ${inputBg} text-xs font-semibold ${txt} ${hov} transition-colors disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className={`flex-1 py-3 rounded-full ${accentBg} ${accentText} text-xs font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5`}
          >
            {submitting ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending…</>
            ) : (
              'Send Request'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Logout confirmation modal ─────────────────────────────────────────
function LogoutConfirmModal({
  role, loading, onCancel, onConfirm,
}: {
  role: 'user' | 'merchant';
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [loading, onCancel]);

  const { surface, border, txt, sub, hov, inputBg } = useThemeTokens();
  const roleLabel = role === 'merchant' ? 'Merchant' : 'User';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="logout-confirm-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={() => { if (!loading) onCancel(); }}
    >
      <div
        className={`${surface} border ${border} rounded-2xl shadow-2xl w-full max-w-sm p-6`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center shrink-0">
            <LogOut className="w-5 h-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 id="logout-confirm-title" className={`text-base font-semibold ${txt}`}>
              Log out of {roleLabel} waitlist?
            </h3>
            <p className={`text-xs ${sub} mt-1 leading-relaxed`}>
              You&apos;ll need to sign in again to see your referral code,
              points, and leaderboard position.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className={`flex-1 py-3 rounded-full border ${border} ${inputBg} text-xs font-semibold ${txt} ${hov} transition-colors disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 rounded-full bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {loading ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Logging out…</>
            ) : (
              'Log out'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modals (history, referral, how-it-works, upgrade) ─────────────────
function HistoryModal({ history, onClose }: { history: PointEntry[]; onClose: () => void }) {
  const { surface, border, txt, muted, sub, divider } = useThemeTokens();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className={`relative w-full max-w-md ${surface} border ${border} rounded-2xl overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className={`px-5 py-4 border-b ${divider} flex items-center justify-between`}>
          <div>
            <h3 className={`text-sm font-semibold ${txt}`}>Points History</h3>
            <p className={`text-[10px] ${sub} mt-0.5`}>Every BLIP credit on your account</p>
          </div>
          <button onClick={onClose} className={`text-xs ${muted} hover:${txt}`}>Close</button>
        </div>
        <ul className={`max-h-[60vh] overflow-y-auto divide-y ${divider}`}>
          {history.length === 0 && (
            <li className={`px-5 py-8 text-xs ${sub} text-center`}>
              No entries yet — complete a quest to start earning BLIP.
            </li>
          )}
          {history.map((h) => {
            const { title, subtitle } = describeEntry(h);
            const isDebit = h.bonus_points < 0;
            return (
              <li key={h.id} className="px-5 py-3 flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className={`${txt} font-semibold truncate`}>{title}</div>
                  {subtitle && (
                    <div className={`${muted} mt-0.5 truncate`}>{subtitle}</div>
                  )}
                  <div className={`${sub} mt-1 text-[10px]`} title={new Date(h.created_at).toLocaleString('en-US')}>
                    {relativeTime(h.created_at)}
                  </div>
                </div>
                <div className={`font-semibold tabular-nums shrink-0 ${isDebit ? 'text-red-500' : 'text-emerald-500'}`}>
                  {isDebit ? '' : '+'}{formatCount(h.bonus_points)}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function ReferralModal({ code, link, onClose, onCopy, copied }: {
  code: string; link: string; onClose: () => void; onCopy: () => void; copied: boolean;
}) {
  const { surface, border, txt, muted, sub, hov, inputBg, accentBg, accentText } = useThemeTokens();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className={`relative w-full max-w-md ${surface} border ${border} rounded-2xl p-6`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-lg font-semibold mb-1 ${txt}`}>Share your referral</h3>
        <p className={`text-xs ${muted} mb-5`}>Send this link to friends. Both sides earn BLIP when they sign up.</p>
        <div className="mb-3">
          <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${sub} mb-1.5`}>Your code</div>
          <div className={`${inputBg} border ${border} rounded-md px-3 py-2.5 font-semibold text-base tracking-[0.08em] ${txt}`}>{code || '—'}</div>
        </div>
        <div className="mb-5">
          <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${sub} mb-1.5`}>Your link</div>
          <div className={`${inputBg} border ${border} rounded-md px-3 py-2.5 font-mono text-xs break-all ${txt}`}>{link || '—'}</div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className={`flex-1 py-3 rounded-full border ${border} text-[11px] font-semibold uppercase tracking-[0.12em] ${txt} ${hov}`}>Close</button>
          <button onClick={onCopy} className={`flex-1 py-3 rounded-full ${accentBg} ${accentText} text-[11px] font-semibold uppercase tracking-[0.12em] hover:opacity-90 flex items-center justify-center gap-1.5`}>
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Link</>}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4">
          <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join me on @blip_money — use my referral code ${code || ''}: ${link}`)}`}
            target="_blank" rel="noopener noreferrer"
            className={`flex items-center justify-center gap-1.5 ${inputBg} border ${border} rounded-full px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.10em] ${txt} ${hov} transition`}>
            <XLogo className="w-3.5 h-3.5" /> X
          </a>
          <a href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me on Blip Market')}`}
            target="_blank" rel="noopener noreferrer"
            className={`flex items-center justify-center gap-1.5 ${inputBg} border ${border} rounded-full px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.10em] ${txt} ${hov} transition`}>
            <MessageCircle className="w-3.5 h-3.5" /> Telegram
          </a>
          {/* <button onClick={onCopy}
            className={`flex items-center justify-center gap-1.5 ${inputBg} border ${border} rounded-full px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.10em] ${txt} ${hov} transition`}>
            <MoreHorizontal className="w-3.5 h-3.5" /> More
          </button> */}
        </div>
      </div>
    </div>
  );
}

function HowItWorksModal({ onClose, referralUnit }: { onClose: () => void; referralUnit: number }) {
  const { surface, border, txt, muted, accentBg, accentText } = useThemeTokens();
  const steps = [
    { title: 'Share your code',    desc: 'Copy your referral code or link and send it to friends.' },
    { title: 'They sign up',       desc: `Friends sign up at app.blip.money/waitlist using your code.` },
    { title: 'They get verified',  desc: 'Once they confirm their email, the referral is locked in.' },
    { title: 'You earn BLIP',      desc: `${formatCount(referralUnit)} BLIP land in your account — no limit.` },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className={`relative w-full max-w-md ${surface} border ${border} rounded-2xl p-6`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-lg font-semibold mb-1 ${txt}`}>How referrals work</h3>
        <p className={`text-xs ${muted} mb-5`}>Four simple steps.</p>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                style={{ background: 'rgba(204,120,92,0.15)', color: ACCENT, border: `1px solid rgba(204,120,92,0.30)` }}
              >
                {i + 1}
              </div>
              <div>
                <p className={`text-sm font-semibold ${txt}`}>{s.title}</p>
                <p className={`text-xs ${muted}`}>{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <button onClick={onClose} className={`mt-6 w-full py-3 rounded-full ${accentBg} ${accentText} text-[11px] font-semibold uppercase tracking-[0.12em] hover:opacity-90`}>
          Got it
        </button>
      </div>
    </div>
  );
}

function UpgradeModal({ actorType, onClose, onSuccess }: {
  actorType: ActorType; onClose: () => void; onSuccess: () => void;
}) {
  const { surface, border, txt, muted, hov, inputBg, accentBg, accentText } = useThemeTokens();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('p2p_trader');
  const [volume, setVolume] = useState('');
  const [country, setCountry] = useState('');

  async function submit() {
    setError(null); setSubmitting(true);
    try {
      const endpoint = actorType === 'user' ? '/api/waitlist/upgrade-to-merchant' : '/api/waitlist/upgrade-to-user';
      const body = actorType === 'user'
        ? { business_name: businessName.trim(), business_category: category,
            expected_monthly_volume_usd: volume ? Number(volume.replace(/[^\d.]/g, '')) : null,
            country_code: country.trim().toUpperCase() || null }
        : {};
      const res = await fetchWithAuth(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error ?? 'Upgrade failed'); return; }
      onSuccess();
    } catch (err) { console.error(err); setError('Network error'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className={`relative w-full max-w-md ${surface} border ${border} rounded-2xl p-6`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-lg font-semibold mb-1 ${txt}`}>
          {actorType === 'user' ? 'Become a merchant' : 'Also join as user'}
        </h3>
        <p className={`text-xs ${muted} mb-5`}>
          {actorType === 'user'
            ? `+${formatCount(MERCHANT_BLIP_POINTS.REGISTER)} BLIP and merchant quests unlock.`
            : `+${formatCount(USER_BLIP_POINTS.REGISTER)} BLIP. One click — no new credentials.`}
        </p>
        {actorType === 'user' && (
          <div className="space-y-3 mb-4">
            <input type="text" placeholder="Business name" value={businessName}
              onChange={(e) => setBusinessName(e.target.value)} maxLength={100} required
              className={`w-full ${inputBg} border ${border} rounded-md px-3 py-2 text-sm focus:outline-none ${txt}`} />
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className={`w-full ${inputBg} border ${border} rounded-md px-3 py-2 text-sm ${txt}`}>
              <option value="p2p_trader">P2P Trader</option>
              <option value="otc_desk">OTC Desk</option>
              <option value="exchange">Exchange</option>
              <option value="payments_processor">Payments processor</option>
              <option value="remittance">Remittance</option>
              <option value="other">Other</option>
            </select>
            <input type="text" inputMode="numeric" placeholder="Expected monthly volume (USD)"
              value={volume} onChange={(e) => setVolume(e.target.value)} maxLength={14}
              className={`w-full ${inputBg} border ${border} rounded-md px-3 py-2 text-sm font-mono ${txt}`} />
            <input type="text" placeholder="Country code (e.g. IN)" value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={8}
              className={`w-full ${inputBg} border ${border} rounded-md px-3 py-2 text-sm font-mono uppercase ${txt}`} />
          </div>
        )}
        {error && <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded p-3 mb-3">{error}</div>}
        <div className="flex gap-3">
          <button onClick={onClose}
            className={`flex-1 py-3 rounded-full border ${border} text-[11px] font-semibold uppercase tracking-[0.12em] ${txt} ${hov}`}>
            Cancel
          </button>
          <button onClick={submit}
            disabled={submitting || (actorType === 'user' && !businessName.trim())}
            className={`flex-1 py-3 rounded-full ${accentBg} ${accentText} text-[11px] font-semibold uppercase tracking-[0.12em] hover:opacity-90 disabled:opacity-50`}>
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Map a raw blip_point_log row to a human-readable title + subtitle so the
// history modal answers "what is this 500-point line FOR?" at a glance.
// Falls back to a sensible title if we ever record an event type we
// haven't taught this function about.
function describeEntry(entry: PointEntry): { title: string; subtitle: string | null } {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const taskType = typeof meta.task_type === 'string' ? meta.task_type : null;
  const reason = typeof meta.reason === 'string' ? meta.reason : null;
  const sref = entry.source_ref ?? null;

  switch (entry.event) {
    case 'REGISTER':
      return { title: 'Joined the Blip waitlist', subtitle: 'Welcome bonus on signup' };
    case 'MERCHANT_REGISTER':
      return { title: 'Joined as a merchant', subtitle: 'Welcome bonus on merchant signup' };

    case 'TASK_VERIFIED': {
      switch (taskType) {
        case 'TWITTER':      return { title: 'Followed @blip_money on Twitter',  subtitle: 'Social quest verified' };
        case 'TELEGRAM':     return { title: 'Joined our Telegram channel',      subtitle: 'Social quest verified' };
        case 'DISCORD':      return { title: 'Joined our Discord server',        subtitle: 'Social quest verified' };
        case 'CUSTOM':       return { title: 'Retweeted the Blip campaign',      subtitle: 'Social quest verified' };
        case 'ONBOARD_FORM': return { title: 'Submitted Merchant Onboarding form', subtitle: 'Beta program signup' };
        case 'QUIZ':         return { title: 'Completed a knowledge quiz',       subtitle: 'Quiz verified' };
        case 'WHITEPAPER':   return { title: 'Read the whitepaper',              subtitle: 'Whitepaper quest verified' };
        default:             return { title: 'Task verified', subtitle: taskType ? `Task type: ${taskType}` : null };
      }
    }

    case 'TWITTER_FOLLOW':  return { title: 'Followed @blip_money on Twitter',  subtitle: 'Social quest verified' };
    case 'TELEGRAM_JOIN':   return { title: 'Joined our Telegram channel',      subtitle: 'Social quest verified' };
    case 'DISCORD_JOIN':    return { title: 'Joined our Discord server',        subtitle: 'Social quest verified' };
    case 'RETWEET':         return { title: 'Retweeted the Blip campaign',      subtitle: 'Social quest verified' };
    case 'WHITEPAPER_READ': return { title: 'Read the whitepaper',              subtitle: 'Whitepaper quest verified' };
    case 'CROSS_BORDER_SWAP': return { title: 'Cross-border swap completed',    subtitle: null };

    case 'REFERRAL_BONUS_EARNED':
      return { title: 'Friend joined using your referral code', subtitle: 'Referral bonus credited' };
    case 'REFERRAL_BONUS_RECEIVED':
      return { title: 'You signed up via a referral', subtitle: 'Referral welcome bonus' };

    case 'MERCHANT_ONBOARD_FORM':
      return { title: 'Submitted Merchant Onboarding form', subtitle: 'Beta program signup' };

    case 'MANUAL_CREDIT': {
      // The same event powers several flows. Disambiguate via source_ref
      // (idempotency anchor) and metadata.reason so users see a meaningful
      // label instead of a generic "Manual Credit".
      if (sref === 'signup_starter' || reason === 'signup_starter_coin_grant') {
        return { title: 'Welcome bonus', subtitle: 'Starter Blip Points on account creation' };
      }
      if (reason) {
        return { title: 'Bonus credit', subtitle: reason };
      }
      if (sref?.startsWith('legacy_backfill')) {
        return { title: 'Account migration credit', subtitle: 'Backfilled from legacy reputation system' };
      }
      return { title: 'Bonus credit', subtitle: sref ? `Source: ${sref}` : 'Adjustment by support team' };
    }

    case 'MANUAL_DEBIT':
      return { title: 'Adjustment', subtitle: reason ?? 'Manual deduction by support team' };

    case 'FIRST_TRADE':            return { title: 'Completed your first trade',         subtitle: 'First-trade bonus' };
    case 'TRADE_COMPLETED':        return { title: 'Trade completed',                    subtitle: typeof meta.order_id === 'string' ? `Order ${meta.order_id.slice(0, 8)}…` : null };
    case 'VOLUME_BONUS':           return { title: 'Volume milestone reached',           subtitle: null };
    case 'STREAK_7':               return { title: '7-day trading streak',               subtitle: 'Weekly streak bonus' };
    case 'STREAK_30':              return { title: '30-day trading streak',              subtitle: 'Monthly streak bonus' };
    case 'DISPUTE_FREE_MONTH':     return { title: 'Dispute-free month',                 subtitle: 'Monthly clean record bonus' };
    case 'FIVE_STAR_RECEIVED':     return { title: 'Received a 5-star review',           subtitle: 'Counterparty rated you 5 stars' };
    case 'REFERRAL_TRADE_CREDITED': return { title: 'Your referral made their first trade', subtitle: 'Referral activation bonus' };
    case 'KYC_COMPLETED':          return { title: 'KYC verification completed',         subtitle: 'Identity verification bonus' };

    case 'COIN_LOCK':              return { title: 'Points locked',                      subtitle: 'Held for anti-abuse review or signup hold' };
    case 'COIN_UNLOCK':            return { title: 'Points unlocked',                    subtitle: 'Hold released — points now spendable' };
    case 'COIN_VOID':              return { title: 'Points voided',                      subtitle: reason ?? 'Anti-abuse review' };
    case 'LIMIT_BUMP_BURN':        return { title: 'Trade limit upgraded',               subtitle: typeof meta.tier === 'string' ? `${meta.tier} tier unlocked` : 'Points burned for higher limits' };
    case 'PERK_BURN':              return { title: 'Perk purchased',                     subtitle: typeof meta.perk === 'string' ? meta.perk : 'Points burned for a perk' };

    default:
      // Unknown event — fall back to a Title Case rendering of the raw
      // name. Better than rendering empty for events we haven't catalogued.
      return {
        title: entry.event.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
        subtitle: null,
      };
  }
}

// Short "20 hours ago" style timestamps for the modal. Falls back to an
// explicit en-US date once the entry is older than 7 days so the list
// stays scannable without dates running off the right edge.
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString('en-US');
  const s = Math.floor(ms / 1000);
  if (s < 45)                return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)                return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24)                return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 7)                 return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}
