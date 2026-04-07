"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Copy,
  User,
  Plus,
  Wallet,
  Sun,
  Moon,
  X,
  TrendingUp,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { BottomNav } from "./BottomNav";
import type { Screen, Order, BankAccount } from "./types";
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
  // Copy
  copied: boolean;
  setCopied: (v: boolean) => void;
  // Banks
  bankAccounts: BankAccount[];
  showAddBank: boolean;
  setShowAddBank: (v: boolean) => void;
  newBank: { bank: string; iban: string; name: string };
  setNewBank: React.Dispatch<React.SetStateAction<{ bank: string; iban: string; name: string }>>;
  addBankAccount: () => void;
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
  setBankAccounts: React.Dispatch<React.SetStateAction<BankAccount[]>>;
  setResolvedDisputes: React.Dispatch<React.SetStateAction<any[]>>;
  setLoginError: (v: string) => void;
  setLoginForm: (v: { username: string; password: string }) => void;
  maxW: string;
}

export const ProfileScreen = ({
  screen,
  setScreen,
  userName,
  completedOrders,
  timedOutOrders,
  solanaWallet,
  setShowWalletModal,
  embeddedWallet,
  setShowWalletSetup,
  setShowWalletUnlock,
  copied,
  setCopied,
  bankAccounts,
  showAddBank,
  setShowAddBank,
  newBank,
  setNewBank,
  addBankAccount,
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
  setBankAccounts,
  setResolvedDisputes,
  setLoginError,
  setLoginForm,
  maxW,
}: ProfileScreenProps) => {
  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-4 shrink-0">
        <p className={`${SECTION_LABEL} mb-1`}>Account</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[16px] flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle">
              <span className="text-[20px] font-extrabold text-white">{userName.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <p className="text-[20px] font-extrabold tracking-[-0.03em] text-text-primary leading-[1.1]">{userName}</p>
              <p className="text-[11px] font-semibold text-text-tertiary font-mono mt-0.5">
                {solanaWallet.connected && solanaWallet.walletAddress
                  ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                  : 'Wallet not connected'}
              </p>
            </div>
          </div>
          {solanaWallet.connected && solanaWallet.walletAddress && (
            <motion.button whileTap={{ scale: 0.85 }}
              onClick={async () => {
                await copyToClipboard(solanaWallet.walletAddress!);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-surface-raised border border-border-subtle">
              {copied
                ? <Check size={15} className="text-[#10b981]" />
                : <Copy size={15} className="text-white/40" />}
            </motion.button>
          )}
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex-1 px-5 pb-24 overflow-y-auto scrollbar-hide">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'Trades', value: completedOrders.length.toString() },
            { label: 'Volume', value: completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0).toFixed(0) + ' USDT' },
            { label: 'Score', value: completedOrders.length > 0 ? (completedOrders.length / (completedOrders.length + timedOutOrders.length) * 100).toFixed(0) + '%' : '\u2014' },
          ].map(stat => (
            <div key={stat.label} className={`rounded-[18px] flex flex-col items-center py-3 ${CARD}`}>
              <p className={`${CARD_LABEL} mb-1`}>{stat.label}</p>
              <p className="text-[20px] font-extrabold tracking-[-0.03em] text-white">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Reputation */}
        {completedOrders.length > 0 && (() => {
          const tier = completedOrders.length >= 50 ? 'Elite Trader' : completedOrders.length >= 20 ? 'Trusted' : completedOrders.length >= 10 ? 'Established' : completedOrders.length >= 3 ? 'Emerging' : 'New Trader';
          const lvl = completedOrders.length >= 50 ? 5 : completedOrders.length >= 20 ? 4 : completedOrders.length >= 10 ? 3 : completedOrders.length >= 3 ? 2 : 1;
          return (
            <div className={`rounded-[18px] px-4 py-3 flex items-center justify-between mb-3 ${CARD}`}>
              <div>
                <p className={`${CARD_LABEL} mb-1`}>Reputation</p>
                <p className="text-[16px] font-extrabold tracking-[-0.02em] text-white">{tier}</p>
              </div>
              <div className="flex items-end gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-[2px] ${REP_BAR_H[i]} ${i < lvl ? 'bg-white' : 'bg-text-quaternary'}`}
                  />
                ))}
              </div>
            </div>
          );
        })()}

        {/* Wallet */}
        <p className={`${SECTION_LABEL} block mb-2`}>Solana Wallet</p>
        <div className={`rounded-[18px] p-4 mb-3 ${CARD}`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 border border-white/10 ${
              solanaWallet.connected ? 'bg-white/10' : 'bg-white/5'
            }`}>
              <Wallet size={16} className={solanaWallet.connected ? 'text-white' : 'text-white/30'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`${CARD_LABEL} mb-0.5`}>
                {solanaWallet.connected ? 'Solana Devnet' : 'Not Connected'}
              </p>
              <p className="text-[13px] font-bold text-white font-mono">
                {solanaWallet.connected && solanaWallet.walletAddress
                  ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                  : 'Connect your wallet'}
              </p>
            </div>
          </div>

          {/* Solana Balances */}
          {solanaWallet.connected && (
            <>
              <div className="flex gap-2 mb-2 pt-3 border-t border-white/10">
                {[
                  { label: 'SOL', value: solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '\u2014' },
                  { label: 'USDT', value: solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '\u2014' },
                ].map(b => (
                  <div key={b.label} className="flex-1 rounded-[14px] px-3 py-2 bg-white/[0.06] border border-white/10">
                    <p className={`${CARD_LABEL} mb-[3px]`}>{b.label}</p>
                    <p className="text-[17px] font-extrabold tracking-[-0.02em] text-white">{b.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.refreshBalances()}
                  className="flex-1 py-2 rounded-[12px] bg-white/[0.08] text-[11px] font-bold text-white/50 tracking-[0.08em] uppercase">
                  Refresh
                </motion.button>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.disconnect()}
                  className="flex-1 py-2 rounded-[12px] bg-error-dim border border-error-border text-[11px] font-bold text-error tracking-[0.08em] uppercase">
                  Disconnect
                </motion.button>
              </div>
            </>
          )}

          {/* Connect Solana Wallet Button */}
          {!solanaWallet.connected && (
            <motion.button whileTap={{ scale: 0.97 }}
              onClick={() => {
                if (IS_EMBEDDED_WALLET && setShowWalletSetup && setShowWalletUnlock) {
                  if (embeddedWallet?.state === 'locked') setShowWalletUnlock(true);
                  else setShowWalletSetup(true);
                } else {
                  setShowWalletModal(true);
                }
              }}
              className="w-full py-3 rounded-[14px] flex items-center justify-center gap-2 mt-2 bg-accent text-accent-text text-[14px] font-extrabold tracking-[-0.01em]">
              <Wallet size={16} className="text-accent-text" /> Connect Wallet
            </motion.button>
          )}
        </div>

        {/* Bank Accounts */}
        <div className="flex items-center justify-between mb-2">
          <p className={SECTION_LABEL}>Bank Accounts</p>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(true)}
            className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-raised border border-border-subtle">
            <Plus size={15} className="text-white/50" />
          </motion.button>
        </div>
        <div className="flex flex-col gap-2 mb-3">
          {bankAccounts.map(acc => (
            <div key={acc.id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${CARD}`}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-white/[0.08] text-[18px]">
                {'\uD83C\uDFE6'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-bold text-white tracking-[-0.01em]">{acc.bank}</p>
                  {acc.isDefault && (
                    <span className="text-[8px] font-extrabold tracking-[0.1em] uppercase px-1.5 py-0.5 rounded-full bg-accent text-accent-text">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/35 font-mono">{acc.iban}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Console & Analytics */}
        <p className={`${SECTION_LABEL} block mb-2`}>Analytics</p>
        <a href="/console" className={`flex items-center gap-3 rounded-[16px] px-4 py-3 mb-3 ${CARD}`}>
          <div className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 bg-white/[0.08]">
            <TrendingUp size={16} className="text-white/60" />
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-bold text-white tracking-[-0.01em]">Console</p>
            <p className="text-[10px] font-semibold text-white/35 tracking-[0.1em] uppercase">Timeouts & Analytics</p>
          </div>
          {timedOutOrders.length > 0 && (
            <span className="text-[10px] font-bold px-2 py-[3px] rounded-full bg-error-dim border border-error-border text-[#dc2626]">
              {timedOutOrders.length} timeout{timedOutOrders.length !== 1 ? 's' : ''}
            </span>
          )}
          <ChevronRight size={15} className="text-white/20" />
        </a>

        {/* Resolved Disputes */}
        {resolvedDisputes.length > 0 && (
          <>
            <p className={`${SECTION_LABEL} block mb-2`}>Resolved Disputes</p>
            <div className="flex flex-col gap-2 mb-3">
              {resolvedDisputes.map(dispute => {
                const badgeClass =
                  dispute.resolvedInFavorOf === 'user'
                    ? 'bg-success-dim text-[#059669] border border-success-border'
                    : dispute.resolvedInFavorOf === 'merchant'
                    ? 'bg-error-dim text-[#dc2626] border border-error-border'
                    : 'bg-white/[0.08] text-white/40';
                return (
                  <div key={dispute.id} className={`rounded-[16px] px-4 py-3 ${CARD}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-white">#{dispute.orderNumber}</span>
                        <span className={`text-[9px] font-bold tracking-[0.1em] uppercase px-[7px] py-0.5 rounded-full ${badgeClass}`}>
                          {dispute.resolvedInFavorOf === 'user' ? 'Won' :
                           dispute.resolvedInFavorOf === 'merchant' ? 'Lost' : 'Split'}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/35">
                        {new Date(dispute.resolvedAt).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[12px] text-white/35">vs {dispute.otherPartyName}</p>
                      <p className="text-[14px] font-extrabold text-white tracking-[-0.01em]">
                        ${dispute.cryptoAmount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Theme Toggle */}
        <p className={`${SECTION_LABEL} block mb-2`}>Appearance</p>
        <div className={`rounded-[16px] px-4 py-3 flex items-center justify-between mb-3 ${CARD}`}>
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon size={16} className="text-text-secondary" />
            ) : (
              <Sun size={16} className="text-text-secondary" />
            )}
            <span className="text-[14px] font-bold text-text-primary">
              {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </span>
          </div>
          <button onClick={toggleTheme}>
            <div className="w-12 h-7 rounded-[14px] p-0.5 flex items-center transition-colors duration-200 bg-accent">
              <div className={`w-6 h-6 rounded-full bg-surface-base transition-transform duration-200 ${
                theme === 'light' ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>
        </div>

        {/* Logout */}
        <motion.button whileTap={{ scale: 0.97 }}
          onClick={() => {
            console.log('[User] Signing out...');
            localStorage.removeItem('blip_user');
            localStorage.removeItem('blip_wallet');
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
            setBankAccounts([]);
            setResolvedDisputes([]);
            setLoginError('');
            setLoginForm({ username: '', password: '' });
            if (solanaWallet.disconnect) {
              solanaWallet.disconnect();
            }
            window.location.href = '/';
          }}
          className="w-full h-12 flex items-center justify-center gap-2 rounded-[14px] bg-error-dim border border-error-border text-[14px] font-extrabold text-[#dc2626] tracking-[-0.01em]">
          <LogOut size={16} className="text-[#dc2626]" />
          Sign Out
        </motion.button>
      </div>

      {/* Add Bank Modal */}
      <AnimatePresence>
        {showAddBank && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setShowAddBank(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-0 z-50 flex items-center justify-center px-5 py-8"
              onClick={() => setShowAddBank(false)}
            >
              <div
                className={`w-full ${maxW} rounded-2xl shadow-2xl bg-surface-base border border-border-medium`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
                  <p className="text-[17px] font-extrabold text-text-primary tracking-[-0.02em]">Add Bank Account</p>
                  <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(false)}
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-surface-hover">
                    <X size={15} className="text-text-tertiary" />
                  </motion.button>
                </div>
                <div className="px-5 py-4 flex flex-col gap-3">
                  <div>
                    <p className={`${CARD_LABEL} block mb-1.5`}>Bank Name</p>
                    <input
                      value={newBank.bank}
                      onChange={(e) => setNewBank(p => ({ ...p, bank: e.target.value }))}
                      placeholder="Emirates NBD"
                      className="w-full bg-surface-hover border border-border-medium rounded-[12px] px-3.5 py-2.5 text-[14px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong"
                    />
                  </div>
                  <div>
                    <p className={`${CARD_LABEL} block mb-1.5`}>IBAN</p>
                    <input
                      value={newBank.iban}
                      onChange={(e) => setNewBank(p => ({ ...p, iban: e.target.value }))}
                      placeholder="AE12 0345 0000 0012 3456 789"
                      className="w-full bg-surface-hover border border-border-medium rounded-[12px] px-3.5 py-2.5 text-[14px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong"
                    />
                  </div>
                  <div>
                    <p className={`${CARD_LABEL} block mb-1.5`}>Account Name</p>
                    <input
                      value={newBank.name}
                      onChange={(e) => setNewBank(p => ({ ...p, name: e.target.value }))}
                      placeholder="John Doe"
                      className="w-full bg-surface-hover border border-border-medium rounded-[12px] px-3.5 py-2.5 text-[14px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong"
                    />
                  </div>
                </div>
                <div className="px-5 pb-5 pt-1">
                  <motion.button whileTap={{ scale: 0.97 }}
                    onClick={addBankAccount}
                    disabled={!newBank.bank || !newBank.iban || !newBank.name}
                    className={`w-full h-12 rounded-[14px] text-[14px] font-extrabold tracking-[-0.01em] ${
                      newBank.bank && newBank.iban && newBank.name
                        ? 'bg-accent text-accent-text'
                        : 'bg-surface-hover text-text-quaternary'
                    }`}>
                    Add Account
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
