"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Wallet,
  Sun,
  Moon,
  ChevronRight,
  LogOut,
  Shield,
  RefreshCw,
  Sliders,
  LifeBuoy,
  HelpCircle,
  Mail,
  Gift,
  Coins,
} from "lucide-react";
import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

/**
 * Compact stats row shown in the profile header next to the avatar.
 * Surfaces the two numbers a user cares about most at a glance:
 *   - "{n} Blip Points" with the coin glyph
 *   - reputation score (300–900)
 */
function ProfileHeaderStats() {
  const [coins, setCoins] = useState<number | null>(null);
  const [repScore, setRepScore] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [coinsRes, repRes] = await Promise.all([
          fetchWithAuth('/api/coins/me').then((r) => (r.ok ? r.json() : null)),
          fetchWithAuth('/api/reputation/me').then((r) => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;
        if (coinsRes?.data && typeof coinsRes.data.balance === 'number') {
          setCoins(coinsRes.data.balance);
        }
        if (repRes?.data && typeof repRes.data.total_score === 'number') {
          setRepScore(repRes.data.total_score);
        }
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-raised border border-border-subtle text-text-secondary text-[11px] font-semibold">
        <Coins size={11} />
        <span className="tabular-nums text-text-primary">{coins != null ? coins.toLocaleString('en-US') : '—'}</span>
        <span className="text-text-tertiary">Blip Points</span>
      </span>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-raised border border-border-subtle text-text-secondary text-[11px] font-semibold">
        <Shield size={11} />
        <span className="tabular-nums text-text-primary">{repScore != null ? repScore : '—'}</span>
        <span className="text-text-tertiary">Rep</span>
      </span>
    </div>
  );
}
import { clearAuthStorageOnLogout } from "@/lib/auth/logoutCleanup";
import { BottomNav } from "./BottomNav";
import { PaymentMethodsManager } from "../PaymentMethodsManager";
import { AppLockSettingsCard } from "@/components/app-lock/AppLockSettingsCard";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { StatusPill } from "@/components/settings/StatusPill";
import type { Screen, Order } from "./types";
import { networkLabel } from "@/lib/solana/networkLabel";
import type { MutableRefObject } from "react";

const IS_EMBEDDED_WALLET = process.env.NEXT_PUBLIC_EMBEDDED_WALLET === 'true';

// Class-string aliases — mirror the Card / SectionLabel / CardLabel components
// for places where we compose with extra utility classes inline.
const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";
const CARD_LABEL = SECTION_LABEL;

// Reputation bar heights (index → tailwind h-*)
const REP_BAR_H = ["h-2", "h-3", "h-4", "h-5", "h-6"]; // 8,12,16,20,24px

export interface ProfileScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  userId: string | null;
  userName: string;
  completedOrders: Order[];
  timedOutOrders: Order[];
  // Solana wallet
  solanaWallet: {
    connected: boolean;
    walletAddress: string | null;
    solBalance: number | null;
    usdtBalance: number | null;
    refreshBalances: () => Promise<void>;
    disconnect: () => void;
  };
  setShowWalletModal: (v: boolean) => void;
  // Embedded wallet
  embeddedWallet?: {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: any) => void;
  };
  setShowWalletSetup?: (v: boolean) => void;
  setShowWalletUnlock?: (v: boolean) => void;
  // Disputes
  resolvedDisputes: Array<{
    id: string;
    orderNumber: string;
    resolvedInFavorOf: string;
    resolvedAt: string;
    otherPartyName: string;
    cryptoAmount: number;
    reason: string;
  }>;
  // Theme
  theme: string;
  toggleTheme: () => void;
  // Logout refs/state
  isAuthenticatingRef: MutableRefObject<boolean>;
  lastAuthenticatedWalletRef: MutableRefObject<string | null>;
  authAttemptedForWalletRef: MutableRefObject<string | null>;
  setShowUsernameModal: (v: boolean) => void;
  setUserId: (v: string | null) => void;
  setUserWallet: (v: string | null) => void;
  setUserName: (v: string) => void;
  setUserBalance: (v: number) => void;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setResolvedDisputes: React.Dispatch<React.SetStateAction<any[]>>;
  setLoginError: (v: string) => void;
  setLoginForm: (v: { username: string; password: string; email: string }) => void;
  maxW: string;
}

export const ProfileScreen = ({
  screen,
  setScreen,
  userId,
  userName,
  completedOrders,
  timedOutOrders,
  solanaWallet,
  setShowWalletModal,
  embeddedWallet,
  setShowWalletSetup,
  setShowWalletUnlock,
  resolvedDisputes,
  theme,
  toggleTheme,
  isAuthenticatingRef,
  lastAuthenticatedWalletRef,
  authAttemptedForWalletRef,
  setShowUsernameModal,
  setUserId,
  setUserWallet,
  setUserName,
  setUserBalance,
  setOrders,
  setResolvedDisputes,
  setLoginError,
  setLoginForm,
  maxW,
}: ProfileScreenProps) => {
  const router = useRouter();

  // Derived identity metrics — kept at render-top so header + identity card
  // can reference the same numbers without re-deriving them inline.
  const tradesCount = completedOrders.length;
  const volumeTotal = completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0);
  const successRate = tradesCount > 0
    ? (tradesCount / (tradesCount + timedOutOrders.length)) * 100
    : null;
  const tier =
    tradesCount >= 50 ? 'Elite Trader'
    : tradesCount >= 20 ? 'Trusted'
    : tradesCount >= 10 ? 'Established'
    : tradesCount >= 3 ? 'Emerging'
    : tradesCount > 0 ? 'New Trader'
    : null;
  const tierLvl =
    tradesCount >= 50 ? 5
    : tradesCount >= 20 ? 4
    : tradesCount >= 10 ? 3
    : tradesCount >= 3 ? 2
    : tradesCount > 0 ? 1
    : 0;
  const nextTierThreshold =
    tradesCount < 3 ? 3
    : tradesCount < 10 ? 10
    : tradesCount < 20 ? 20
    : tradesCount < 50 ? 50
    : null;
  const prevTierThreshold =
    tradesCount < 3 ? 0
    : tradesCount < 10 ? 3
    : tradesCount < 20 ? 10
    : tradesCount < 50 ? 20
    : 50;
  const tierProgress = nextTierThreshold
    ? Math.min(100, Math.max(0, ((tradesCount - prevTierThreshold) / (nextTierThreshold - prevTierThreshold)) * 100))
    : 100;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── Hero profile banner: avatar with connection dot, name,
          tier line, and a tappable wallet pill (replaces the separate copy
          button for a cleaner one-tap interaction). */}
      <header className="px-5 pt-10 pb-5 shrink-0">
        <p className={`${SECTION_LABEL} mb-3`}>Account</p>
        <div className="flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="w-14 h-14 rounded-[18px] flex items-center justify-center bg-surface-raised border border-border-medium">
              <span className="text-[24px] font-bold tracking-[-0.03em] text-text-primary">
                {(userName || 'U').charAt(0).toUpperCase()}
              </span>
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface-base ${
                solanaWallet.connected ? 'bg-text-primary' : 'bg-text-quaternary'
              }`}
              aria-label={solanaWallet.connected ? 'Wallet connected' : 'Wallet disconnected'}
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[22px] font-bold tracking-[-0.03em] text-text-primary leading-none truncate mb-1.5">
              {userName || 'User'}
            </p>
            {/* Rep score + Blip Points chip row — sits directly below
                the user name so the most important "who am I worth"
                signals are immediately legible next to the avatar. */}
            <ProfileHeaderStats />
          </div>
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex-1 px-5 pb-24 overflow-y-auto scrollbar-hide">

        {/* Identity card \u2014 combines reputation + stats into a single cohesive
            block. Reputation row sits on top with a progress bar showing
            trades-to-next-tier; the 3 stat columns sit below, divided by
            vertical hairlines for a tabular, professional read. */}
        <div className={`rounded-[20px] mb-3 overflow-hidden ${CARD}`}>
          {tier ? (
            <div className="px-4 pt-4 pb-3.5 border-b border-border-subtle">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-[9px] flex items-center justify-center bg-surface-active">
                    <Shield size={13} className="text-text-secondary" />
                  </div>
                  <div>
                    <p className={`${CARD_LABEL} leading-none mb-1`}>Reputation</p>
                    <p className="text-[15px] font-bold tracking-[-0.02em] text-text-primary leading-none">
                      {tier}
                    </p>
                  </div>
                </div>
                <div className="flex items-end gap-[3px]">
                  {[...Array(5)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-[3px] rounded-[2px] ${REP_BAR_H[i]} ${i < tierLvl ? 'bg-accent' : 'bg-border-medium'}`}
                    />
                  ))}
                </div>
              </div>
              {nextTierThreshold !== null && (
                <>
                  <div className="h-1 w-full rounded-full bg-surface-active overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${tierProgress}%` }}
                    />
                  </div>
                  <p className="text-[10px] font-semibold text-text-tertiary mt-1.5">
                    {nextTierThreshold - tradesCount} more trade{nextTierThreshold - tradesCount === 1 ? '' : 's'} to next tier
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="px-4 pt-4 pb-3.5 border-b border-border-subtle flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-[9px] flex items-center justify-center bg-surface-active">
                <Shield size={13} className="text-text-tertiary" />
              </div>
              <div>
                <p className={`${CARD_LABEL} leading-none mb-1`}>Reputation</p>
                <p className="text-[13px] font-semibold text-text-tertiary leading-none">
                  Complete your first trade to earn a tier
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 divide-x divide-border-subtle">
            {[
              { label: 'Trades', value: tradesCount.toString(), sub: null as string | null },
              { label: 'Volume', value: volumeTotal.toFixed(0), sub: 'USDT' },
              { label: 'Success', value: successRate !== null ? `${successRate.toFixed(0)}%` : '\u2014', sub: null },
            ].map((stat) => (
              <div key={stat.label} className="px-3 py-3.5 flex flex-col items-center">
                <p className={`${CARD_LABEL} mb-1.5`}>{stat.label}</p>
                <p className="text-[19px] font-bold tracking-[-0.03em] text-text-primary leading-none">
                  {stat.value}
                  {stat.sub && <span className="text-[11px] font-bold text-text-tertiary ml-1">{stat.sub}</span>}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Wallet — refined: header row carries network + Live status pill;
            balances render in two equal-weight columns separated by a vertical
            divider; actions sit in a clean bottom row. */}
        <p className={`${SECTION_LABEL} block mb-2`}>Solana Wallet</p>
        <div className={`rounded-[20px] overflow-hidden mb-3 ${CARD}`}>
          <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 border ${
                solanaWallet.connected
                  ? 'bg-surface-active border-border-medium'
                  : 'bg-surface-hover border-border-subtle'
              }`}>
                <Wallet size={15} className={solanaWallet.connected ? 'text-text-primary' : 'text-text-tertiary'} />
              </div>
              <div className="min-w-0">
                <p className={`${CARD_LABEL} mb-0.5`}>
                  {solanaWallet.connected ? networkLabel() : 'Not Connected'}
                </p>
                <p className="text-[13px] font-bold text-text-primary font-mono truncate">
                  {solanaWallet.connected && solanaWallet.walletAddress
                    ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                    : 'Connect your wallet'}
                </p>
              </div>
            </div>
            {solanaWallet.connected && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-surface-raised border border-border-subtle shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-text-primary" />
                <span className="text-[9px] font-bold tracking-[0.1em] uppercase text-text-secondary">Live</span>
              </span>
            )}
          </div>

          {/* Solana Balances */}
          {solanaWallet.connected && (
            <>
              <div className="grid grid-cols-2 border-t border-border-subtle divide-x divide-border-subtle">
                {[
                  { label: 'SOL', value: solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '\u2014' },
                  { label: 'USDT', value: solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '\u2014' },
                ].map((b) => (
                  <div key={b.label} className="px-4 py-3.5">
                    <p className={`${CARD_LABEL} mb-1.5`}>{b.label}</p>
                    <p className="text-[20px] font-bold tracking-[-0.03em] text-text-primary leading-none">{b.value}</p>
                  </div>
                ))}
              </div>

              <div className="px-3 pt-3 pb-3 border-t border-border-subtle">
                <div className="flex gap-2">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => solanaWallet.refreshBalances()}
                    className="flex-1 h-9 rounded-[12px] flex items-center justify-center gap-1.5 bg-surface-active text-[11px] font-bold text-text-secondary tracking-[0.08em] uppercase"
                  >
                    <RefreshCw size={12} className="text-text-tertiary" />
                    Refresh
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => solanaWallet.disconnect()}
                    className="flex-1 h-9 rounded-[12px] flex items-center justify-center gap-1.5 bg-surface-active border border-border-subtle text-[11px] font-bold text-text-secondary tracking-[0.08em] uppercase"
                  >
                    <LogOut size={12} className="text-text-tertiary" />
                    Disconnect
                  </motion.button>
                </div>

                {/* Embedded-wallet management. Surfaced only when the
                    embedded-wallet flag is on. */}
                {/* {IS_EMBEDDED_WALLET && (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => router.push('/user/wallet')}
                    className="w-full mt-2 h-10 rounded-[12px] flex items-center justify-center gap-1.5 bg-surface-raised border border-border-subtle text-[12px] font-bold text-text-secondary tracking-[-0.01em]"
                  >
                    Manage Wallet
                    <ChevronRight size={14} className="text-text-tertiary" />
                  </motion.button>
                )} */}
              </div>
            </>
          )}

          {/* Connect Solana Wallet Button */}
          {!solanaWallet.connected && (
            <div className="px-4 pb-4">
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={() => {
                  if (IS_EMBEDDED_WALLET && setShowWalletSetup && setShowWalletUnlock) {
                    if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                    else setShowWalletSetup(true);
                  } else {
                    setShowWalletModal(true);
                  }
                }}
                className="w-full h-12 rounded-[14px] flex items-center justify-center gap-2 bg-accent text-accent-text text-[14px] font-bold tracking-[-0.01em]">
                <Wallet size={16} className="text-accent-text" /> Connect Wallet
              </motion.button>
            </div>
          )}
        </div>

        {/* ── 1. Payment Methods (own card, always-visible list) ── */}
        <PaymentMethodsManager userId={userId} />

        {/* ── 2. Security & Privacy ── */}
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-white/40" />
            <span className={SECTION_LABEL}>Security &amp; Privacy</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold tracking-[0.16em] uppercase text-text-tertiary">
            Protected
          </span>
        </div>
        <div className="mb-6">
          <AppLockSettingsCard userId={userId} />
        </div>

        {/* Resolved Disputes — rich list kept inline so each card retains
            its existing layout (orderNumber, won/lost/split badge, amount,
            counterparty). Only rendered when there's at least one. */}
        {resolvedDisputes.length > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className={SECTION_LABEL}>Resolved Disputes</span>
              <StatusPill label={`${resolvedDisputes.length}`} tone="muted" />
            </div>
            <div className="flex flex-col gap-2">
              {resolvedDisputes.map(dispute => {
                const badgeClass =
                  dispute.resolvedInFavorOf === 'user'
                    ? 'bg-surface-raised text-text-primary border border-border-medium'
                    : dispute.resolvedInFavorOf === 'merchant'
                    ? 'bg-surface-active text-text-tertiary border border-border-subtle'
                    : 'bg-surface-active text-text-tertiary';
                return (
                  <div key={dispute.id} className={`rounded-[16px] px-4 py-3 ${CARD}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-text-primary">#{dispute.orderNumber}</span>
                        <span className={`text-[9px] font-bold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full ${badgeClass}`}>
                          {dispute.resolvedInFavorOf === 'user' ? 'Won' :
                           dispute.resolvedInFavorOf === 'merchant' ? 'Lost' : 'Split'}
                        </span>
                      </div>
                      <p className="text-[11px] text-text-tertiary">
                        {new Date(dispute.resolvedAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] text-text-tertiary">vs {dispute.otherPartyName}</p>
                      <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em]">
                        ${dispute.cryptoAmount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 4. Preferences ── */}
        <SettingsGroup label="Preferences" icon={<Sliders className="w-3.5 h-3.5" />}>
          <SettingsRow
            icon={theme === 'dark' ? <Moon className="w-[15px] h-[15px]" /> : <Sun className="w-[15px] h-[15px]" />}
            title="Appearance"
            subtitle={theme === 'dark' ? 'Dark mode' : 'Light mode'}
            hideChevron
            onClick={toggleTheme}
            trailing={
              <span
                role="switch"
                aria-checked={theme === 'light'}
                aria-label="Toggle light mode"
                className="w-11 h-6 rounded-full p-0.5 flex items-center transition-colors duration-200 bg-accent shrink-0"
              >
                <span
                  className={`w-5 h-5 rounded-full bg-surface-base transition-transform duration-200 ${
                    theme === 'light' ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </span>
            }
          />
        </SettingsGroup>

        {/* ── 5. Rewards ── */}
        <SettingsGroup label="Rewards" icon={<Gift className="w-3.5 h-3.5" />}>
          <SettingsRow
            icon={<Gift className="w-[15px] h-[15px]" />}
            title="Invite friends"
            subtitle="Earn USDT when they trade"
            onClick={() => setScreen("rewards")}
          />
        </SettingsGroup>

        {/* ── 6. Help & Support ── */}
        <SettingsGroup label="Help & Support" icon={<LifeBuoy className="w-3.5 h-3.5" />}>
          <SettingsRow
            href="/faq"
            icon={<HelpCircle className="w-[15px] h-[15px]" />}
            title="FAQs"
            subtitle="Common questions answered"
          />
          <SettingsRow
            icon={<Mail className="w-[15px] h-[15px]" />}
            title="Contact Support"
            subtitle="DM us on Telegram · replies in 10 min"
            onClick={() => setScreen("support")}
          />
        </SettingsGroup>

        {/* Logout */}
        <motion.button whileTap={{ scale: 0.97 }}
          onClick={() => {

            // Sweep all auth/identity state + any unlocked wallet session
            // material. Encrypted blobs stay in place so the same user can
            // re-unlock on next login.
            clearAuthStorageOnLogout();
            isAuthenticatingRef.current = false;
            lastAuthenticatedWalletRef.current = null;
            authAttemptedForWalletRef.current = null;
            setShowUsernameModal(false);
            setShowWalletModal(false);
            setUserId(null);
            setUserWallet(null);
            setUserName('Guest');
            setUserBalance(0);
            setOrders([]);
            setResolvedDisputes([]);
            setLoginError('');
            setLoginForm({ username: '', password: '', email: '' });
            // Drop the wallet context's actor binding so the next account
            // on this device starts at 'initializing' rather than reusing
            // the previous user's in-memory keypair / session blob.
            const ew = (solanaWallet as any)?.embeddedWallet;
            if (ew?.setActorId) ew.setActorId(null);
            if (solanaWallet.disconnect) {
              solanaWallet.disconnect();
            }
            window.location.href = '/';
          }}
          className="w-full h-12 flex items-center justify-center gap-2 rounded-lg bg-white border border-white text-[14px] font-bold text-black tracking-[-0.01em]">
          <LogOut size={16} className="text-invert" />
          Sign Out
        </motion.button>
      </div>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
