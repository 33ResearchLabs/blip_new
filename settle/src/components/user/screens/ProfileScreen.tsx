"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Star,
  Copy,
  Clock,
  User,
  Plus,
  Wallet,
  Sun,
  Moon,
  X,
} from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { HomeAmbientGlow } from "./HomeDecorations";
import { BottomNav } from "./BottomNav";
import type { Screen, Order, BankAccount } from "./types";
import type { MutableRefObject } from "react";

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
    <>
      <HomeAmbientGlow />
      <div className="h-12 shrink-0" />

      <div className="px-5 pt-2 pb-4 shrink-0 z-10">
        <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.38em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: 3 }}>Account</p>
        <p style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>Profile</p>
      </div>

      <div className="flex-1 px-5 pb-24 overflow-y-auto">
        {/* User */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-[20px] overflow-hidden" style={{ border: '2px solid rgba(255,255,255,0.2)' }}>
            <div className="w-full h-full flex items-center justify-center font-black text-xl text-white" style={{ background: 'linear-gradient(135deg, #1a1a1a, #333)' }}>
              {userName.charAt(0).toUpperCase()}
            </div>
          </div>
          <div>
            <p className="text-[17px] font-semibold text-white">{userName}</p>
            <p className="text-[13px] text-neutral-500 font-mono">
              {solanaWallet.connected && solanaWallet.walletAddress
                ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                : 'Wallet not connected'}
            </p>
          </div>
        </div>

        {/* Wallet */}
        <div className="mb-6">
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 12 }}>Solana Wallet</p>
          <div className="rounded-[22px] p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0"
                style={{ background: solanaWallet.connected ? 'rgba(249,115,22,0.08)' : 'rgba(255,255,255,0.05)', border: `1px solid ${solanaWallet.connected ? 'rgba(249,115,22,0.2)' : 'rgba(255,255,255,0.07)'}` }}>
                <Wallet className="w-5 h-5" style={{ color: solanaWallet.connected ? '#f97316' : 'rgba(255,255,255,0.4)' }} />
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.25)', marginBottom: 3 }}>
                  {solanaWallet.connected ? 'Solana Devnet' : 'Not Connected'}
                </p>
                <p style={{ fontSize: 13, fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>
                  {solanaWallet.connected && solanaWallet.walletAddress
                    ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                    : 'Connect your wallet'}
                </p>
              </div>
              <motion.button whileTap={{ scale: 0.9 }}
                onClick={async () => {
                  if (solanaWallet.connected && solanaWallet.walletAddress) {
                    await copyToClipboard(solanaWallet.walletAddress);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                }}
                className="w-8 h-8 rounded-[10px] flex items-center justify-center"
                style={{ background: 'rgba(255,255,255,0.06)' }}>
                {copied ? <Check className="w-4 h-4" style={{ color: '#f97316' }} /> : <Copy className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.35)' }} />}
              </motion.button>
            </div>

            {/* Solana Balances */}
            {solanaWallet.connected && (
              <div className="pt-3 mt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex gap-2 mb-3">
                  <div className="flex-1 rounded-[14px] p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <p style={{ fontSize: 7.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)', marginBottom: 4 }}>SOL</p>
                    <p style={{ fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em' }}>
                      {solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '\u2014'}
                    </p>
                  </div>
                  <div className="flex-1 rounded-[14px] p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <p style={{ fontSize: 7.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.2)', marginBottom: 4 }}>USDT</p>
                    <p style={{ fontSize: 18, fontWeight: 900, color: '#f97316', letterSpacing: '-0.02em' }}>
                      {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '\u2014'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.refreshBalances()} className="flex-1 py-2.5 rounded-[14px] text-center" style={{ background: 'rgba(255,255,255,0.04)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)' }}>
                    Refresh
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.disconnect()} className="flex-1 py-2.5 rounded-[14px] text-center" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#f87171' }}>
                    Disconnect
                  </motion.button>
                </div>
              </div>
            )}

            {/* Connect Solana Wallet Button */}
            {!solanaWallet.connected && (
              <button
                onClick={() => setShowWalletModal(true)}
                className="w-full mt-4 py-3 rounded-xl text-[14px] font-medium bg-white/10 border border-white/10 text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <Wallet className="w-4 h-4" />
                Connect Solana Wallet
              </button>
            )}
          </div>
        </div>

        {/* Banks */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase' }}>Bank Accounts</p>
            <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(true)}
              className="w-8 h-8 rounded-[10px] flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Plus className="w-4 h-4" style={{ color: '#fff' }} />
            </motion.button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bankAccounts.map(acc => (
              <div key={acc.id} className="flex items-center gap-3 rounded-[18px] p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <span className="text-lg">{'\uD83C\uDFE6'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.01em' }}>{acc.bank}</p>
                    {acc.isDefault && (
                      <span style={{ fontSize: 8, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', padding: '2px 6px', borderRadius: 99, background: 'rgba(249,115,22,0.1)', color: '#f97316' }}>Default</span>
                    )}
                  </div>
                  <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)' }}>{acc.iban}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Stats & Reputation */}
        <div className="mb-6">
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 12 }}>Stats & Reputation</p>
          <div className="flex gap-2.5 mb-3">
            {[
              { label: 'Trades', value: completedOrders.length.toString(), color: '#fff' },
              { label: 'Volume', value: completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0).toFixed(0) + ' USDT', color: '#f97316' },
              { label: 'Score', value: completedOrders.length > 0 ? (completedOrders.length / (completedOrders.length + timedOutOrders.length) * 100).toFixed(0) + '%' : '\u2014', color: '#f97316' },
            ].map(stat => (
              <div key={stat.label} className="flex-1 rounded-[18px] px-3 py-3" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
                <p style={{ fontSize: 7.5, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.25)', marginBottom: 6 }}>{stat.label}</p>
                <p style={{ fontSize: 18, fontWeight: 900, color: stat.color, letterSpacing: '-0.02em' }}>{stat.value}</p>
              </div>
            ))}
          </div>
          {completedOrders.length > 0 && (
            <div className="rounded-[18px] p-4 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Reputation Tier</p>
                <p style={{ fontSize: 16, fontWeight: 900, letterSpacing: '-0.02em', color: '#f97316' }}>
                  {completedOrders.length >= 50 ? 'Elite Trader' : completedOrders.length >= 20 ? 'Trusted' : completedOrders.length >= 10 ? 'Established' : completedOrders.length >= 3 ? 'Emerging' : 'New Trader'}
                </p>
              </div>
              <div className="flex items-end gap-1">
                {[...Array(5)].map((_, i) => {
                  const lvl = completedOrders.length >= 50 ? 5 : completedOrders.length >= 20 ? 4 : completedOrders.length >= 10 ? 3 : completedOrders.length >= 3 ? 2 : 1;
                  return <div key={i} style={{ width: 4, height: 8 + i * 4, borderRadius: 3, background: i < lvl ? '#f97316' : 'rgba(255,255,255,0.07)' }} />;
                })}
              </div>
            </div>
          )}
        </div>

        {/* Console & Analytics */}
        <div className="mb-6">
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 12 }}>Analytics</p>
          <a href="/console" className="flex items-center gap-3 rounded-[18px] p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
              <Clock className="w-5 h-5" style={{ color: '#fff' }} />
            </div>
            <div className="flex-1">
              <p style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.01em' }}>Console</p>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Timeouts & Analytics</p>
            </div>
            {timedOutOrders.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 900, padding: '3px 8px', borderRadius: 99, background: 'rgba(249,115,22,0.1)', color: '#f97316', border: '1px solid rgba(249,115,22,0.25)' }}>
                {timedOutOrders.length} timeout{timedOutOrders.length !== 1 ? 's' : ''}
              </span>
            )}
          </a>
        </div>

        {/* Resolved Disputes */}
        {resolvedDisputes.length > 0 && (
          <div className="mt-6">
            <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Resolved Disputes</p>
            <div className="space-y-2">
              {resolvedDisputes.map(dispute => (
                <div key={dispute.id} className="bg-neutral-900 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-white">#{dispute.orderNumber}</span>
                      <span className={`px-2 py-0.5 text-[10px] rounded-full ${
                        dispute.resolvedInFavorOf === 'user'
                          ? 'bg-white/5 text-white'
                          : dispute.resolvedInFavorOf === 'merchant'
                          ? 'bg-white/10 text-white/70'
                          : 'bg-white/5 text-white/70'
                      }`}>
                        {dispute.resolvedInFavorOf === 'user' ? 'Won' :
                         dispute.resolvedInFavorOf === 'merchant' ? 'Lost' : 'Split'}
                      </span>
                    </div>
                    <p className="text-[12px] text-neutral-500">
                      {new Date(dispute.resolvedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] text-neutral-400">vs {dispute.otherPartyName}</p>
                    <p className="text-[14px] font-semibold text-white">
                      ${dispute.cryptoAmount.toLocaleString()}
                    </p>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-1 capitalize">
                    {dispute.reason.replace(/_/g, ' ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Theme Toggle */}
        <div className="mt-6">
          <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Appearance</p>
          <button
            onClick={toggleTheme}
            className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              {theme === 'dark' ? (
                <Moon className="w-5 h-5 text-white/70" />
              ) : (
                <Sun className="w-5 h-5 text-white/70" />
              )}
              <span className="text-[15px] text-white">
                {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
              </span>
            </div>
            <div className={`w-12 h-7 rounded-full p-1 transition-colors ${
              theme === 'light' ? 'bg-white/10' : 'bg-neutral-700'
            }`}>
              <div className={`w-5 h-5 rounded-full bg-white transition-transform ${
                theme === 'light' ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </button>
        </div>

        {/* Logout */}
        <div className="mt-8">
          <button
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
            className="w-full py-4 rounded-2xl bg-red-500/10 text-red-400 text-[15px] font-medium"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Add Bank */}
      <AnimatePresence>
        {showAddBank && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-40"
              onClick={() => setShowAddBank(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30 }}
              className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} bg-neutral-900 rounded-t-3xl`}
            >
              <div className="flex items-center justify-between p-4 border-b border-neutral-800">
                <h2 className="text-[17px] font-semibold text-white">Add Bank Account</h2>
                <button onClick={() => setShowAddBank(false)}>
                  <X className="w-5 h-5 text-neutral-500" />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="text-[13px] text-neutral-500 mb-1 block">Bank Name</label>
                  <input
                    value={newBank.bank}
                    onChange={(e) => setNewBank(p => ({ ...p, bank: e.target.value }))}
                    placeholder="Emirates NBD"
                    className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-white placeholder:text-neutral-600 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[13px] text-neutral-500 mb-1 block">IBAN</label>
                  <input
                    value={newBank.iban}
                    onChange={(e) => setNewBank(p => ({ ...p, iban: e.target.value }))}
                    placeholder="AE12 0345 0000 0012 3456 789"
                    className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-white font-mono placeholder:text-neutral-600 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[13px] text-neutral-500 mb-1 block">Account Name</label>
                  <input
                    value={newBank.name}
                    onChange={(e) => setNewBank(p => ({ ...p, name: e.target.value }))}
                    placeholder="John Doe"
                    className="w-full bg-neutral-800 rounded-xl px-4 py-3 text-white placeholder:text-neutral-600 outline-none"
                  />
                </div>
              </div>
              <div className="p-4 pb-8">
                <button
                  onClick={addBankAccount}
                  disabled={!newBank.bank || !newBank.iban || !newBank.name}
                  className={`w-full py-4 rounded-2xl text-[17px] font-semibold ${
                    newBank.bank && newBank.iban && newBank.name
                      ? "bg-white/10 text-white"
                      : "bg-neutral-800 text-neutral-600"
                  }`}
                >
                  Add Account
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </>
  );
};
