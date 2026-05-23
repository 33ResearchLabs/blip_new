'use client';

// /waitlist/dashboard
//
// Rebuilt to match the futureStick screenshot 1:1.
//   - Navbar: ⚡ Blip money + Dashboard tab + Protocol Balance pill + Wallet
//     pill + settings + menu.
//   - Hero: "Refer Friends. Earn More." (orange "Earn More."), SHARE YOUR
//     CODE + HOW IT WORKS buttons, 3D orange-glow illustration on the right.
//   - "Join Merchant On Board Program" banner with +500 BLIP badge and
//     SUBMIT GOOGLE FORM button.
//   - "YOUR REFERRAL STATS" card with 4 stats (referrals, quests, total
//     points earned, pending points).
//   - Social Quests grid (Twitter / Telegram / Retweet / Share Referral),
//     each opening the matching ported verification modal.
//   - Merchant Beta bottom banner with Send Request button.
//   - Right column: referral code card (with share link + X / Telegram /
//     More buttons), progress gauge (recharts semi-circle), leaderboard.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, LogOut, Copy, Check, Crown, Twitter, Send, Repeat2, Users as UsersIcon,
  CheckCircle2, Store, Settings, Menu, ExternalLink, FileText,
  Plus, Lock, Share2, MoreHorizontal, MessageCircle, Trophy, HelpCircle,
  CircleCheck, Target, Award, Hourglass, UserPlus,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
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
interface PointEntry { id: string; event: string; bonus_points: number; total_points: number | null; created_at: string; }
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

// Dark-theme tokens (match futureStick d=true branch).
const surface = 'bg-[#0f0f0f]';
const border = 'border-white/[0.06]';
const txt = 'text-white';
const muted = 'text-white/60';
const sub = 'text-white/40';
const hov = 'hover:bg-white/5';
const inputBg = 'bg-white/5';
const divider = 'border-white/[0.06]';

// Live Google Form (verified HTTP 200; resolves to docs.google.com/forms/...).
// Same link futureStick's MerchantDashboard.tsx uses, so the two surfaces
// stay in sync. The previous URL (forms.gle/blipmoney-merchant-onboard)
// was a placeholder slug that returned 404.
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
  // Kept here so the button + modal share state without prop-drilling.
  const [betaModalOpen, setBetaModalOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // fetchWithAuth transparently calls /api/auth/refresh on a 401 and
      // retries the original request once. Switching off raw fetch here
      // means a routine 15-min access-token expiry no longer dumps the
      // user back to the login page — they only land on login if the
      // refresh cookie itself is dead (true session expiry).
      const [meRes, lbRes] = await Promise.all([
        fetchWithAuth('/api/waitlist/me'),
        fetchWithAuth('/api/waitlist/leaderboard?limit=10'),
      ]);
      if (meRes.status === 401) {
        // Session expired — bounce to whichever login page matches the cached
        // actor type (set when they signed in / registered). On unknown role,
        // falls back to the user login; the page itself has a "Sign in as
        // merchant" cross-link.
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
      // Refresh the cached role so a later 401 routes back to the right login
      // even if the user cleared storage or arrived via cookie alone.
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
  // dropping the session and forcing the user to sign in again.
  function handleLogout() {
    setLogoutConfirmOpen(true);
  }

  async function confirmLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    // Capture the role BEFORE clearing it — we need it to pick the right
    // post-logout destination. Prefer the loaded actor type (server-confirmed)
    // and fall back to the cached role for safety.
    const role = me?.actor.type ?? readRole();
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    forgetRole();
    // Send user logouts → /waitlist/login, merchant logouts → /waitlist/merchant-login.
    // The previous `/waitlist` redirect always landed on the user signup form
    // (since /waitlist always rewrites to /waitlist/user) — that's why both
    // roles appeared to share the user login page after logout.
    router.push(loginPathForRole(role));
  }

  if (loading) {
    return <div className="min-h-screen bg-black flex items-center justify-center"><Loader2 className={`w-6 h-6 animate-spin ${sub}`} /></div>;
  }
  if (error || !me) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="text-red-400 text-sm mb-4">{error ?? 'Could not load dashboard'}</p>
          <button onClick={() => router.push('/waitlist/login')}
            className={`text-xs font-bold uppercase tracking-[0.14em] ${muted} hover:${txt} underline`}>
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
  // referral (see synthetic-existing logic in the quest map below). Without
  // this, the stats tile reads "3 of 4" while the referral tile shows
  // "Redeemed" — visibly inconsistent.
  const questsCompleted = me.tasks.filter((t) => t.status === 'VERIFIED').length
    + (referralCount > 0 ? 1 : 0);
  const totalEarnedFromQuestsAndRef = me.tasks.filter((t) => t.status === 'VERIFIED').reduce((s, t) => s + (t.points_awarded || 0), 0)
    + me.referrals.filter((r) => r.reward_status === 'credited').reduce((s, r) => s + r.reward_amount, 0);
  const pendingPoints = me.referrals.filter((r) => r.reward_status === 'pending').length * (isMerchant ? MERCHANT_BLIP_POINTS.REFERRAL : USER_BLIP_POINTS.REFERRAL);

  const referralCode = actor.referral_code ?? '';
  // Route the referral link straight to the signup form matching the
  // referrer's actor type. The bare /waitlist redirector always rewrites
  // to /waitlist/user, so a merchant sharing /waitlist?ref=X used to land
  // their invitees on the user signup form — a friction point that also
  // muddied referral attribution.
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
    { id: 'TWITTER',    title: 'Follow Us on Twitter',  reward: POINTS.TWITTER,  icon: Twitter,
      description: 'Follow @blip_money on X to stay updated and earn points.' },
    { id: 'TELEGRAM',   title: 'Follow Us on Telegram', reward: POINTS.TELEGRAM, icon: UsersIcon,
      description: 'Join our Telegram channel and verify membership.' },
    { id: 'CUSTOM',     title: 'Retweet a Post',        reward: POINTS.RETWEET,  icon: Repeat2,
      description: 'Post about Blip Market on X with the campaign message.' },
    { id: 'WHITEPAPER', title: 'Share Referral Link',   reward: POINTS.REFERRAL, icon: Send,
      description: `Invite ${isMerchant ? 'merchants' : 'friends'} with your referral link to earn BLIP.` },
  ];

  // Progress gauge data (semi-circle).
  const milestones = [100, 250, 500, 1000, 2500];
  const nextMilestone = milestones.find((m) => m > blipPoints) ?? milestones[milestones.length - 1];
  const gaugeProgress = Math.min(blipPoints / nextMilestone, 1);
  const gauge = [
    { value: gaugeProgress,     color: '#ffffff' },
    { value: 1 - gaugeProgress, color: 'rgba(255,255,255,0.08)' },
  ];

  const hasBothSegments = !!counterpart;

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar
        balance={blipPoints}
        onLogout={handleLogout}
        actor={actor}
      />

      <main className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 relative z-10 lg:min-h-[calc(100vh-64px)] lg:flex lg:flex-col">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-3 lg:items-stretch">

          {/* LEFT COLUMN ── */}
          <div className="lg:col-span-8 flex flex-col gap-3">

            {/* HERO ── */}
            <div className={`${surface} border ${border} rounded-xl p-5 md:p-6 relative overflow-hidden`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <div className="relative z-10">
                  <h1 className="text-3xl md:text-[40px] font-black mb-3 tracking-tight leading-[1.05]">
                    <span className={txt}>Refer Friends.</span>
                    <br />
                    <span className="text-[#ff6b35]">Earn More.</span>
                  </h1>
                  <p className={`text-sm ${muted} mb-5 max-w-md leading-relaxed`}>
                    Invite your friends to Blip Market and earn{' '}
                    <span className={`font-bold ${txt}`}>{formatCount(referralUnit)} pts</span> for each successful referral.
                    There&apos;s no limit to how much you can earn!
                  </p>
                  <div className="flex flex-wrap gap-2.5">
                    <button onClick={() => setReferralOpen(true)}
                      className="inline-flex items-center gap-2 bg-white text-black px-4 py-2.5 rounded-md text-[11px] font-bold uppercase tracking-[0.14em] hover:bg-gray-100 active:scale-[0.98] transition">
                      <Share2 className="w-3.5 h-3.5" /> Share Your Code
                    </button>
                    <button onClick={() => setHowOpen(true)}
                      className={`inline-flex items-center gap-2 ${inputBg} border ${border} px-4 py-2.5 rounded-md text-[11px] font-bold uppercase tracking-[0.14em] ${hov} transition`}>
                      <HelpCircle className="w-3.5 h-3.5" /> How It Works
                    </button>
                  </div>
                </div>

                {/* Orange-glow illustration */}
                <HeroIllustration />
              </div>
            </div>

            {/* JOIN MERCHANT ONBOARD PROGRAM ── */}
            {/* The CTA flips to a non-interactive "Redeemed" pill once the
                Apps Script webhook (`/api/waitlist/onboard-form-webhook`)
                has credited the actor for submitting the Google Form. The
                webhook writes a VERIFIED row to waitlist_tasks with
                task_type='ONBOARD_FORM', so we just look for that here. */}
            {(() => {
              const onboardTask = me.tasks.find((t) => t.task_type === 'ONBOARD_FORM');
              const onboardDone = onboardTask?.status === 'VERIFIED';
              const tileClass = `${surface} border ${border} rounded-xl p-4 flex items-center justify-between gap-3 ${onboardDone ? 'opacity-70' : hov} transition`;
              const inner = (
                <>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-md ${inputBg} border ${border} flex items-center justify-center shrink-0`}>
                      <FileText className={`w-5 h-5 ${txt}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-bold ${txt}`}>Join Merchant On Board Program</p>
                        <span className="text-[10px] font-black uppercase tracking-[0.12em] text-emerald-500">+500 BLIP</span>
                      </div>
                      <p className={`text-[11px] ${muted} leading-relaxed`}>
                        Submit this Google Form to join our merchant onboarding program and earn 500 pts.
                      </p>
                    </div>
                  </div>
                  {onboardDone ? (
                    <span className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-500 whitespace-nowrap">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Redeemed
                    </span>
                  ) : (
                    <span className={`${inputBg} border ${border} rounded-md px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] ${txt} flex items-center gap-1.5 whitespace-nowrap`}>
                      Submit Google Form <ExternalLink className="w-3 h-3" />
                    </span>
                  )}
                </>
              );
              return onboardDone ? (
                <div className={tileClass}>{inner}</div>
              ) : (
                <a
                  href={ONBOARD_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={tileClass}
                >
                  {inner}
                </a>
              );
            })()}

            {/* YOUR REFERRAL STATS ── */}
            <div className={`${surface} border ${border} rounded-xl p-4`}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-[#ff6b35]" />
                <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${sub}`}>Your Referral Stats</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatTile icon={<UserPlus className={`w-4 h-4 ${txt}`} />} value={referralCount} unit=""    label="Total Referrals"     hint="All time" />
                <StatTile icon={<Target   className={`w-4 h-4 ${txt}`} />} value={questsCompleted} unit=""  label="Quests Completed"    hint={`Completed ${questsCompleted} of 4`} />
                <StatTile icon={<Award    className={`w-4 h-4 ${txt}`} />} value={totalEarnedFromQuestsAndRef} unit="pts" label="Total Points Earned" hint="From Referral" />
                <StatTile icon={<Hourglass className={`w-4 h-4 ${txt}`} />} value={pendingPoints} unit="pts" label="Pending Points"      hint="Not yet credited" />
              </div>
            </div>

            {/* SOCIAL QUESTS ── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className={`p-1.5 rounded-md ${inputBg} border ${border}`}>
                  <Target className={`w-3.5 h-3.5 ${txt}`} />
                </div>
                <div>
                  <h2 className={`text-sm font-black uppercase tracking-[0.18em] ${txt}`}>Social Quests</h2>
                  <p className={`text-[11px] ${muted}`}>Complete quests to earn points and boost your rewards</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {quests.map((q) => {
                  // The "Share Referral Link" tile lives under task_type=WHITEPAPER
                  // (legacy naming), but applyReferral only writes to
                  // waitlist_referrals — there's no waitlist_tasks row that ever
                  // flips to VERIFIED. Synthesise a verified task from the
                  // referrals count so the tile flips to "Redeemed" the moment
                  // the user has at least one successful referral. Without this,
                  // the tile sticks on "Start" forever even after several
                  // referrals land.
                  const existing = q.id === 'WHITEPAPER' && referralCount > 0
                    ? {
                        id: 'referral-synth',
                        task_type: 'WHITEPAPER' as TaskType,
                        status: 'VERIFIED' as TaskStatus,
                        points_awarded: totalEarnedFromQuestsAndRef,
                      }
                    : me.tasks.find((t) => t.task_type === q.id);
                  return (
                    <QuestCard key={q.id} quest={q}
                      existing={existing}
                      onUpdate={load} onShareReferral={() => setReferralOpen(true)} />
                  );
                })}
              </div>
            </div>

            {/* UPGRADE CTA — shown only when missing the other segment */}
            {!hasBothSegments && (
              <button onClick={() => setUpgradeOpen(true)}
                className={`${surface} border ${border} rounded-xl p-4 flex items-center justify-between gap-3 text-left ${hov} transition`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full ${inputBg} border ${border} flex items-center justify-center shrink-0`}>
                    {isMerchant ? <UsersIcon className={`w-5 h-5 ${txt}`} /> : <Store className={`w-5 h-5 ${txt}`} />}
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${txt}`}>
                      {isMerchant ? 'Also a trader? Join as user.' : 'Run a business? Become a merchant.'}
                    </p>
                    <p className={`text-[11px] ${muted} leading-relaxed`}>
                      {isMerchant
                        ? `+${formatCount(USER_BLIP_POINTS.REGISTER)} BLIP, one click, same login.`
                        : `+${formatCount(MERCHANT_BLIP_POINTS.REGISTER)} BLIP + merchant quests.`}
                    </p>
                  </div>
                </div>
                <span className="bg-white text-black px-4 py-2 rounded-md text-[11px] font-bold uppercase tracking-[0.14em] hover:opacity-90 transition">
                  {isMerchant ? 'Join as user' : 'Become merchant'} →
                </span>
              </button>
            )}

            {/* MERCHANT BETA BANNER ── only shown to merchants; user-facing
                copy on this card is merchant-specific ("Merchant P2P App
                Test"). Hidden for users to avoid promising them a flow that
                doesn't exist for their actor type. */}
            {isMerchant && (
              <BetaRequestBanner
                betaRequest={me.beta_request}
                onClickRequest={() => setBetaModalOpen(true)}
              />
            )}
          </div>
          {/* /LEFT */}

          {/* RIGHT COLUMN ── */}
          <div className="lg:col-span-4 flex flex-col gap-3">

            {/* REFERRAL CODE + SHARE LINK ── */}
            <div className={`${surface} border ${border} rounded-xl p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white" />
                <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${sub}`}>Your Referral Code</span>
              </div>
              <div className={`flex items-center justify-between mb-2 ${inputBg} border border-[#ff6b35]/30 rounded-md px-3 py-2.5`}>
                <span className={`text-base font-black ${txt} tracking-[0.12em]`}>{referralCode || '—'}</span>
                <button onClick={() => copyToClipboard(referralCode, 'code')} className={`p-1 rounded ${hov} transition`} aria-label="Copy code">
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className={`w-4 h-4 ${muted}`} />}
                </button>
              </div>
              <p className={`text-[11px] ${muted} mb-4 leading-relaxed`}>
                Share your code or link and earn <span className={`font-bold ${txt}`}>{formatCount(referralUnit)} pts</span> for each successful referral.
              </p>

              <div className="mb-3">
                <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${sub} mb-1.5`}>Or share your link</div>
                <div className={`flex items-center gap-2 ${inputBg} border ${border} rounded-md px-3 py-2`}>
                  <span className="text-[11px] font-mono text-white/70 truncate flex-1">{referralLink || '—'}</span>
                  <button onClick={() => copyToClipboard(referralLink, 'link')} className={`p-1 rounded ${hov} transition shrink-0`} aria-label="Copy link">
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className={`w-3.5 h-3.5 ${muted}`} />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <ShareButton href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Join me on @blip_money — use my referral code ${referralCode || ''}: ${referralLink}`)}`}
                  icon={<Twitter className="w-3.5 h-3.5" />} label="X (Twitter)" />
                <ShareButton href={`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('Join me on Blip Market')}`}
                  icon={<MessageCircle className="w-3.5 h-3.5" />} label="Telegram" />
                <ShareButton onClick={() => setReferralOpen(true)} icon={<MoreHorizontal className="w-3.5 h-3.5" />} label="More" />
              </div>
            </div>

            {/* PROGRESS GAUGE ── */}
            <div className={`${surface} border ${border} rounded-xl p-4`}>
              <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${sub} mb-1`}>Your Progress</div>
              <div className="flex flex-col items-center pt-1 pb-1">
                <div className="relative w-36 h-20">
                  <ResponsiveContainer width="100%" height={76}>
                    <PieChart>
                      <Pie data={gauge} cx="50%" cy="100%"
                        startAngle={180} endAngle={0}
                        innerRadius={52} outerRadius={66}
                        dataKey="value" stroke="none">
                        {gauge.map((e, i) => <Cell key={i} fill={e.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
                    <p className={`text-xl font-black ${txt} leading-none`}>{formatCount(blipPoints)}</p>
                    <p className={`text-[9px] font-bold uppercase tracking-[0.16em] ${sub} mt-0.5`}>Total Points</p>
                  </div>
                </div>
                <p className={`text-[10px] ${muted} mt-2`}>
                  Next Milestone: <span className={`font-bold ${txt}`}>{formatCount(nextMilestone)} pts</span>
                </p>
              </div>
              {/* In-app rep + coin badge — surfaces the rebased 300–900
                  score and the live coin balance alongside the waitlist
                  points. The waitlist points are pre-launch hype; rep +
                  coins are the production economy. */}
              <ReputationCoinBadge variant="card" className="my-2" />
              <div className={`pt-2 border-t ${divider} space-y-0.5`}>
                {milestones.map((m) => {
                  const achieved = blipPoints >= m;
                  return (
                    <div key={m} className="flex items-center justify-between py-0.5">
                      <div className="flex items-center gap-2">
                        <Plus className={`w-3 h-3 ${achieved ? txt : sub}`} />
                        <span className={`text-[11px] ${achieved ? txt : muted} font-medium`}>{formatCount(m)} pts</span>
                      </div>
                      {achieved ? <Check className={`w-3.5 h-3.5 ${txt}`} /> : <Lock className={`w-3 h-3 ${sub}`} />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* LEADERBOARD ── */}
            <div className={`${surface} border ${border} rounded-xl overflow-hidden flex flex-col flex-1 min-h-0`}>
              <div className={`px-4 py-2.5 border-b ${divider} flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <Trophy className={`w-3.5 h-3.5 ${txt}`} />
                  <span className={`text-[10px] font-black uppercase tracking-[0.18em] ${sub}`}>Leaderboard</span>
                </div>
                <button className={`text-[10px] font-bold ${muted} hover:${txt} transition-colors`} onClick={() => setHistoryOpen(true)}>
                  View All
                </button>
              </div>
              <div className="px-1.5 py-1 max-h-[260px] overflow-y-auto flex-1">
                {leaderboard.length === 0 ? (
                  <div className={`text-center py-8 text-xs ${sub}`}>No one on the board yet. Be the first!</div>
                ) : (
                  leaderboard.slice(0, 10).map((row, i) => {
                    const rank = i + 1;
                    const name = row.display_name || row.username || '—';
                    return (
                      <div key={`${row.actor_type}:${row.actor_id}`}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg ${hov} cursor-pointer`}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-4 shrink-0 flex items-center justify-center">
                            {rank <= 3
                              ? <Crown className={`w-3.5 h-3.5 ${txt}`} />
                              : <span className={`text-[11px] font-bold ${sub}`}>{rank}</span>}
                          </span>
                          <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-white to-white/70 flex items-center justify-center text-black text-[8px] font-black uppercase shrink-0">
                            {name[0]}
                          </div>
                          <span className={`text-[11px] font-semibold ${txt} truncate`}>{name}</span>
                          <CircleCheck className={`w-3 h-3 ${sub} shrink-0`} />
                        </div>
                        <span className={`text-[11px] font-black ${txt} shrink-0`}>{formatCount(row.blip_points)} pts</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          {/* /RIGHT */}
        </div>
      </main>

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

// ── Merchant beta-access banner ───────────────────────────────────────
// Shows different button states based on the actor's latest request:
//   - no request   → "Send Request" (opens the modal)
//   - pending      → "Request Sent" (disabled)
//   - contacted    → "We've Been In Touch" (disabled)
//   - approved     → "Approved ✓"  (disabled, green)
//   - rejected     → "Send Request" again (re-open)
// Re-renders from /api/waitlist/me — the parent passes the latest state.
function BetaRequestBanner({
  betaRequest,
  onClickRequest,
}: {
  betaRequest: BetaRequest | null;
  onClickRequest: () => void;
}) {
  const status = betaRequest?.status ?? null;
  const isOpen = status === 'pending' || status === 'contacted';
  const isApproved = status === 'approved';

  let buttonText = 'Send Request';
  if (status === 'pending') buttonText = 'Request Sent';
  else if (status === 'contacted') buttonText = "We've Been In Touch";
  else if (isApproved) buttonText = 'Approved ✓';

  const disabled = isOpen || isApproved;

  return (
    <div className={`${surface} border ${border} rounded-xl p-4 mt-auto`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-[#ff6b35] bg-[#ff6b35]/10 border border-[#ff6b35]/20 rounded px-2 py-0.5">
              Merchant Beta
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">
              On-Request
            </span>
          </div>
          <h4 className={`text-sm font-bold ${txt} mb-1`}>Request for Merchant P2P App Test</h4>
          <p className={`text-[11px] ${muted} mb-3 leading-relaxed`}>
            Trial our P2P release app. Early access &amp; governance perks included.
          </p>
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1"><CircleCheck className="w-3 h-3" /> P2P Access</span>
            <span className="flex items-center gap-1"><CircleCheck className="w-3 h-3" /> Governance</span>
            <span className="text-zinc-700">v0.1.4</span>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={disabled ? undefined : onClickRequest}
          className={`px-4 py-2.5 rounded-md text-[11px] font-bold uppercase tracking-[0.12em] active:scale-[0.98] transition self-start whitespace-nowrap ${
            isApproved
              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 cursor-default'
              : isOpen
                ? 'bg-white/[0.04] border border-white/[0.08] text-white/50 cursor-default'
                : 'bg-white text-black hover:opacity-90'
          }`}
        >
          {buttonText}
        </button>
      </div>
    </div>
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
        <h3 id="beta-request-title" className={`text-base font-bold ${txt} mb-1`}>
          Request P2P App Test Access
        </h3>
        <p className={`text-xs ${sub} mb-5 leading-relaxed`}>
          Tell us how much volume you plan to trade each month. We&apos;ll review
          your request and reach out via your account email.
        </p>
        <label className={`block text-[11px] font-bold uppercase tracking-[0.14em] ${sub} mb-2`}>
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
            className={`flex-1 py-2.5 rounded-lg border ${border} ${inputBg} text-xs font-semibold ${txt} ${hov} transition-colors disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="flex-1 py-2.5 rounded-lg bg-white text-black text-xs font-bold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
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
// Lightweight inline component so we don't pull in the heavier app-wide
// Modal — the waitlist dashboard is dark-themed and self-contained, and
// this dialog is only ever rendered here.
function LogoutConfirmModal({
  role,
  loading,
  onCancel,
  onConfirm,
}: {
  role: 'user' | 'merchant';
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Close on Esc; lock body scroll while the modal is open.
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
            <h3 id="logout-confirm-title" className={`text-base font-bold ${txt}`}>
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
            className={`flex-1 py-2.5 rounded-lg border ${border} ${inputBg} text-xs font-semibold ${txt} ${hov} transition-colors disabled:opacity-50`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2.5 rounded-lg bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
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

// ── Navbar ─────────────────────────────────────────────────────────────
function Navbar({ balance, onLogout, actor }: {
  balance: number; onLogout: () => void;
  actor: WaitlistMe['actor'];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className={`${surface} border-b ${border} sticky top-0 z-50`}>
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
        {/* Logo + Dashboard tab */}
        <div className="flex items-center gap-6 md:gap-10">
          <Logo href="/waitlist" onDark />
          <nav className="hidden md:flex items-center gap-1 text-[13px] font-semibold">
            <button className={`relative px-3 py-1.5 ${txt} font-bold`}>
              Dashboard
              <span className="absolute left-2 right-2 -bottom-[22px] h-[2px] bg-white" />
            </button>
          </nav>
        </div>

        {/* Right: pills + actions */}
        <div className="hidden md:flex items-center gap-2">
          {/* Protocol Balance */}
          <div className={`${inputBg} border ${border} rounded-md px-3 py-1.5 flex items-center gap-2.5`}>
            <div>
              <div className={`text-[8px] font-black uppercase tracking-[0.18em] ${sub} leading-none mb-0.5`}>Protocol Balance</div>
              <div className={`text-[11px] font-bold ${txt} leading-none`}>{formatCount(balance)} pts</div>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          </div>
          {/* Settings */}
          <button className={`w-9 h-9 rounded-md flex items-center justify-center border ${border} ${inputBg} ${hov} transition-all`} aria-label="Settings">
            <Settings className={`w-4 h-4 ${txt}`} />
          </button>
          {/* Menu */}
          <div className="relative">
            <button onClick={() => setMenuOpen(!menuOpen)}
              className={`w-9 h-9 rounded-md flex items-center justify-center border ${border} ${inputBg} ${hov} transition-all`} aria-label="Menu">
              <Menu className={`w-4 h-4 ${txt}`} />
            </button>
            {menuOpen && (
              <div className={`absolute right-0 mt-2 w-60 ${surface} border ${border} rounded-xl shadow-xl overflow-hidden z-50`}>
                <div className={`px-4 py-3 border-b ${divider}`}>
                  <p className={`text-xs font-bold ${txt} truncate`}>{(actor.email ?? '').split('@')[0] || actor.display_name || 'Account'}</p>
                  <p className={`text-[10px] ${sub} truncate`}>{actor.email}</p>
                </div>
                <button onClick={onLogout}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-red-500 ${hov} transition-colors`}>
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Mobile menu trigger */}
        <button onClick={onLogout}
          className={`flex md:hidden w-9 h-9 rounded-md items-center justify-center border ${border} ${inputBg}`}
          aria-label="Logout">
          <LogOut className={`w-4 h-4 ${txt}`} />
        </button>
      </div>
    </header>
  );
}

// ── Hero illustration ───────────────────────────────────────────────────
function HeroIllustration() {
  return (
    <div className="hidden md:flex relative h-[180px] items-center justify-center">
      {/* Outer glow ring */}
      <div className="absolute w-40 h-40 rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(255,107,53,0.35) 0%, rgba(255,107,53,0) 70%)' }} />
      {/* Orbit ring */}
      <div className="absolute w-32 h-32 rounded-full border border-[#ff6b35]/40"
        style={{ boxShadow: '0 0 40px rgba(255,107,53,0.4), inset 0 0 30px rgba(255,107,53,0.2)' }} />
      {/* Floating people icons */}
      <div className="absolute left-[40%] top-1/2 -translate-y-1/2 w-12 h-12 rounded-2xl bg-gradient-to-br from-[#ff6b35] to-[#cc4a1a] flex items-center justify-center shadow-[0_8px_30px_rgba(255,107,53,0.5)]">
        <UsersIcon className="w-6 h-6 text-white" />
      </div>
      <div className="absolute right-[28%] top-[24%] w-9 h-9 rounded-2xl bg-gradient-to-br from-[#ff8855] to-[#ff6b35] flex items-center justify-center shadow-[0_6px_20px_rgba(255,107,53,0.5)]">
        <UserPlus className="w-4 h-4 text-white" />
      </div>
      <div className="absolute right-[20%] bottom-[18%] w-8 h-8 rounded-full bg-gradient-to-br from-[#ff6b35] to-[#cc4a1a] flex items-center justify-center shadow-[0_4px_16px_rgba(255,107,53,0.6)]">
        <Plus className="w-3.5 h-3.5 text-white" />
      </div>
    </div>
  );
}

// ── Stat tile ──────────────────────────────────────────────────────────
function StatTile({ icon, value, unit, label, hint }: {
  icon: React.ReactNode; value: number; unit: string; label: string; hint: string;
}) {
  return (
    <div className={`${inputBg} border ${border} rounded-lg px-3 py-2.5`}>
      <div className="flex items-center gap-1.5 mb-1.5">{icon}</div>
      <p className={`text-xl font-black ${txt} leading-none mb-0.5`}>
        {formatCount(value)} {unit && <span className="text-[10px] font-bold ml-0.5">{unit}</span>}
      </p>
      <p className={`text-[10px] font-bold ${txt}`}>{label}</p>
      <p className={`text-[9px] ${sub}`}>{hint}</p>
    </div>
  );
}

// ── Share button ───────────────────────────────────────────────────────
function ShareButton({ href, onClick, icon, label }: {
  href?: string; onClick?: () => void; icon: React.ReactNode; label: string;
}) {
  const className = `flex items-center justify-center gap-1.5 ${inputBg} border ${border} rounded-md px-2 py-2 text-[10px] font-bold uppercase tracking-[0.10em] ${txt} ${hov} transition`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {icon} {label}
      </a>
    );
  }
  return <button onClick={onClick} className={className}>{icon} {label}</button>;
}

// ── Quest card (opens the right verification modal) ────────────────────
function QuestCard({ quest, existing, onUpdate, onShareReferral }: {
  quest: { id: TaskType; title: string; reward: number; icon: React.ComponentType<{ className?: string }>; description: string };
  existing: Task | undefined;
  onUpdate: () => void;
  onShareReferral: () => void;
}) {
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

  return (
    <>
      <div className={`${surface} border ${border} rounded-xl p-4 flex flex-col ${isDone ? 'opacity-70' : ''}`}>
        <div className="flex items-start justify-between mb-2">
          <div className={`p-2 rounded-md ${inputBg} border ${border}`}>
            <QuestIcon className={`w-4 h-4 ${txt}`} />
          </div>
          <span className="text-[11px] font-black uppercase tracking-[0.12em] text-emerald-500 whitespace-nowrap pt-1">
            +{formatCount(quest.reward)} BLIP
          </span>
        </div>
        <div className="mb-3 flex-1">
          <h3 className={`text-sm font-bold ${txt} mb-0.5 leading-tight`}>{quest.title}</h3>
          <p className={`text-[11px] ${muted} leading-relaxed`}>{quest.description}</p>
        </div>
        <div className="flex justify-end">
          {isDone ? (
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-500">
              <CheckCircle2 className="w-3.5 h-3.5" /> Redeemed
            </div>
          ) : (
            <button onClick={handleStart}
              className="bg-white text-black px-6 py-2 rounded-md text-[11px] font-bold uppercase tracking-[0.14em] hover:opacity-90 active:scale-[0.98] transition">
              Start
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

// ── Modals (history, referral, how-it-works, upgrade) ─────────────────
function HistoryModal({ history, onClose }: { history: PointEntry[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className={`relative w-full max-w-md ${surface} border ${border} rounded-2xl overflow-hidden`} onClick={(e) => e.stopPropagation()}>
        <div className={`px-5 py-4 border-b ${divider} flex items-center justify-between`}>
          <h3 className={`text-sm font-bold ${txt}`}>Points History</h3>
          <button onClick={onClose} className={`text-xs ${muted} hover:${txt}`}>Close</button>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto divide-y divide-white/[0.04]">
          {history.length === 0 && <li className={`px-5 py-6 text-xs ${sub} text-center`}>No entries yet</li>}
          {history.map((h) => (
            <li key={h.id} className="px-5 py-3 flex items-center justify-between text-xs">
              <div>
                <div className={txt}>{prettyEvent(h.event)}</div>
                <div className={sub}>{new Date(h.created_at).toLocaleString('en-US')}</div>
              </div>
              <div className="font-black text-emerald-500">+{formatCount(h.bonus_points)}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReferralModal({ code, link, onClose, onCopy, copied }: {
  code: string; link: string; onClose: () => void; onCopy: () => void; copied: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className={`relative w-full max-w-md ${surface} border ${border} rounded-2xl p-6`} onClick={(e) => e.stopPropagation()}>
        <h3 className={`text-lg font-bold mb-1 ${txt}`}>Share your referral</h3>
        <p className={`text-xs ${muted} mb-5`}>Send this link to friends. Both sides earn BLIP when they sign up.</p>
        <div className="mb-3">
          <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${sub} mb-1.5`}>Your code</div>
          <div className={`${inputBg} border ${border} rounded-md px-3 py-2.5 font-black text-base tracking-[0.08em]`}>{code || '—'}</div>
        </div>
        <div className="mb-5">
          <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${sub} mb-1.5`}>Your link</div>
          <div className={`${inputBg} border ${border} rounded-md px-3 py-2.5 font-mono text-xs break-all`}>{link || '—'}</div>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className={`flex-1 py-2.5 rounded-md border ${border} text-[11px] font-bold uppercase tracking-[0.12em] ${txt} ${hov}`}>Close</button>
          <button onClick={onCopy} className="flex-1 py-2.5 rounded-md bg-white text-black text-[11px] font-bold uppercase tracking-[0.12em] hover:opacity-90 flex items-center justify-center gap-1.5">
            {copied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Link</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function HowItWorksModal({ onClose, referralUnit }: { onClose: () => void; referralUnit: number }) {
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
        <h3 className={`text-lg font-bold mb-1 ${txt}`}>How referrals work</h3>
        <p className={`text-xs ${muted} mb-5`}>Four simple steps.</p>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-[#ff6b35]/15 border border-[#ff6b35]/30 text-[#ff6b35] flex items-center justify-center text-xs font-black shrink-0">{i + 1}</div>
              <div>
                <p className={`text-sm font-bold ${txt}`}>{s.title}</p>
                <p className={`text-xs ${muted}`}>{s.desc}</p>
              </div>
            </li>
          ))}
        </ol>
        <button onClick={onClose} className="mt-6 w-full py-2.5 rounded-md bg-white text-black text-[11px] font-bold uppercase tracking-[0.12em] hover:opacity-90">
          Got it
        </button>
      </div>
    </div>
  );
}

function UpgradeModal({ actorType, onClose, onSuccess }: {
  actorType: ActorType; onClose: () => void; onSuccess: () => void;
}) {
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
        <h3 className={`text-lg font-bold mb-1 ${txt}`}>
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
        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3 mb-3">{error}</div>}
        <div className="flex gap-3">
          <button onClick={onClose}
            className={`flex-1 py-2.5 rounded-md border ${border} text-[11px] font-bold uppercase tracking-[0.12em] ${txt} ${hov}`}>
            Cancel
          </button>
          <button onClick={submit}
            disabled={submitting || (actorType === 'user' && !businessName.trim())}
            className="flex-1 py-2.5 rounded-md bg-white text-black text-[11px] font-bold uppercase tracking-[0.12em] hover:opacity-90 disabled:opacity-50">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function prettyEvent(event: string): string {
  return event.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
