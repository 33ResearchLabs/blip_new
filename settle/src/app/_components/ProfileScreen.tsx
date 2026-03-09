"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Wallet, Check, Copy, Plus, X, Clock, Moon, Sun } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import AmbientGlow from "@/components/user/shared/AmbientGlow";
import React from "react";
import type { BankAccount, ResolvedDispute } from "@/types/user";

interface NewBank {
  bank: string;
  iban: string;
  name: string;
}

interface SolanaWallet {
  connected: boolean;
  walletAddress: string | null;
  solBalance: number | null;
  usdtBalance: number | null;
  refreshBalances: () => void;
  disconnect: () => void;
}

interface Order {
  cryptoAmount: string;
  [key: string]: any;
}

export interface ProfileScreenProps {
  userName: string;
  solanaWallet: SolanaWallet;
  copied: boolean;
  setCopied: React.Dispatch<React.SetStateAction<boolean>>;
  bankAccounts: BankAccount[];
  setBankAccounts: React.Dispatch<React.SetStateAction<BankAccount[]>>;
  showAddBank: boolean;
  setShowAddBank: React.Dispatch<React.SetStateAction<boolean>>;
  newBank: NewBank;
  setNewBank: React.Dispatch<React.SetStateAction<NewBank>>;
  addBankAccount: () => void;
  completedOrders: Order[];
  timedOutOrders: Order[];
  resolvedDisputes: ResolvedDispute[];
  setResolvedDisputes: React.Dispatch<React.SetStateAction<ResolvedDispute[]>>;
  theme: string;
  toggleTheme: () => void;
  maxW: string;
  setShowWalletModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowUsernameModal: React.Dispatch<React.SetStateAction<boolean>>;
  setUserId: React.Dispatch<React.SetStateAction<string | null>>;
  setUserWallet: React.Dispatch<React.SetStateAction<string | null>>;
  setUserName: React.Dispatch<React.SetStateAction<string>>;
  setUserBalance: React.Dispatch<React.SetStateAction<number>>;
  setOrders: React.Dispatch<React.SetStateAction<any[]>>;
  setLoginError: React.Dispatch<React.SetStateAction<string>>;
  setLoginForm: React.Dispatch<React.SetStateAction<any>>;
  isAuthenticatingRef: React.MutableRefObject<boolean>;
  lastAuthenticatedWalletRef: React.MutableRefObject<string | null>;
  authAttemptedForWalletRef: React.MutableRefObject<string | null>;
}

export function ProfileScreen(props: ProfileScreenProps) {
  const {
    userName,
    solanaWallet,
    copied,
    setCopied,
    bankAccounts,
    setBankAccounts,
    showAddBank,
    setShowAddBank,
    newBank,
    setNewBank,
    addBankAccount,
    completedOrders,
    timedOutOrders,
    resolvedDisputes,
    setResolvedDisputes,
    theme,
    toggleTheme,
    maxW,
    setShowWalletModal,
    setShowUsernameModal,
    setUserId,
    setUserWallet,
    setUserName,
    setUserBalance,
    setOrders,
    setLoginError,
    setLoginForm,
    isAuthenticatingRef,
    lastAuthenticatedWalletRef,
    authAttemptedForWalletRef,
  } = props;

  return (
    <motion.div
      key="profile"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`flex-1 w-full ${maxW} flex flex-col overflow-hidden`}
      style={{ background: '#06060e' }}
    >
      <AmbientGlow />
      <div className="h-12 shrink-0" />

      <div className="px-5 py-4 shrink-0 z-10">
        <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.22)', textTransform: 'uppercase', marginBottom: 4 }}>Account</p>
        <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em', color: '#fff' }}>Profile</h1>
      </div>

      <div className="flex-1 px-5 pb-28 overflow-y-auto no-scrollbar z-10">
        {/* User */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-[22px] flex items-center justify-center text-white text-xl font-black"
            style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.2), rgba(16,185,129,0.2))', border: '2px solid rgba(124,58,237,0.3)' }}>
            {userName.charAt(0).toUpperCase()}
          </div>
          <div>
            <p style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff' }}>{userName}</p>
            <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.3)' }}>
              {solanaWallet.connected && solanaWallet.walletAddress
                ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                : 'Wallet not connected'}
            </p>
          </div>
        </div>

        {/* Wallet */}
        <div className="mb-6">
          <p style={{ fontSize: 8, fontWeight: 900, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', marginBottom: 12 }}>Solana Wallet</p>
          <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.055)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                solanaWallet.connected
                  ? 'bg-white/10'
                  : 'bg-neutral-700'
              }`}>
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-[13px] text-neutral-500">
                  {solanaWallet.connected ? 'Solana Devnet' : 'Not Connected'}
                </p>
                <p className="text-[15px] font-mono text-white">
                  {solanaWallet.connected && solanaWallet.walletAddress
                    ? `${solanaWallet.walletAddress.slice(0, 8)}...${solanaWallet.walletAddress.slice(-6)}`
                    : 'Connect your wallet'}
                </p>
              </div>
              <button
                onClick={async () => {
                  if (solanaWallet.connected && solanaWallet.walletAddress) {
                    await copyToClipboard(solanaWallet.walletAddress);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                }}
                className="p-2"
              >
                {copied ? (
                  <Check className="w-5 h-5 text-white" />
                ) : (
                  <Copy className="w-5 h-5 text-neutral-500" />
                )}
              </button>
            </div>

            {/* Solana Balances */}
            {solanaWallet.connected && (
              <div className="border-t border-neutral-800 pt-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-neutral-800 rounded-xl p-3">
                    <p className="text-[11px] text-neutral-500 mb-1">SOL Balance</p>
                    <p className="text-[17px] font-semibold text-white">
                      {solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '...'} SOL
                    </p>
                  </div>
                  <div className="bg-neutral-800 rounded-xl p-3">
                    <p className="text-[11px] text-neutral-500 mb-1">USDT Balance</p>
                    <p className="text-[17px] font-semibold text-white">
                      {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '...'} USDT
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => solanaWallet.refreshBalances()}
                    className="flex-1 py-2 text-[13px] text-neutral-400 hover:text-white transition-colors"
                  >
                    Refresh
                  </button>
                  <button
                    onClick={() => solanaWallet.disconnect()}
                    className="flex-1 py-2 text-[13px] text-red-400 hover:text-red-300 transition-colors"
                  >
                    Disconnect
                  </button>
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
            <p className="text-[13px] text-neutral-500 uppercase tracking-wide">Bank Accounts</p>
            <button
              onClick={() => setShowAddBank(true)}
              className="w-8 h-8 rounded-full bg-neutral-900 flex items-center justify-center"
            >
              <Plus className="w-4 h-4 text-neutral-400" />
            </button>
          </div>

          {bankAccounts.map(acc => (
            <div key={acc.id} className="bg-neutral-900 rounded-2xl p-4 mb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                  <span className="text-lg">{'\u{1F3E6}'}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-medium text-white">{acc.bank}</p>
                    {acc.isDefault && (
                      <span className="px-2 py-0.5 bg-white/5 text-white text-[11px] rounded-full">Default</span>
                    )}
                  </div>
                  <p className="text-[13px] text-neutral-500 font-mono">{acc.iban}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div>
          <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Stats & Reputation</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-neutral-900 rounded-2xl p-4">
              <p className="text-[28px] font-semibold text-white">{completedOrders.length}</p>
              <p className="text-[13px] text-neutral-500">Trades</p>
            </div>
            <div className="bg-neutral-900 rounded-2xl p-4">
              <p className="text-[28px] font-semibold text-white">
                {completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0).toFixed(0)}
              </p>
              <p className="text-[13px] text-neutral-500">Volume</p>
            </div>
            <div className="bg-neutral-900 rounded-2xl p-4">
              <p className="text-[28px] font-semibold text-white">
                {completedOrders.length > 0 ? (completedOrders.length / (completedOrders.length + timedOutOrders.length) * 100).toFixed(0) : '\u2014'}
              </p>
              <p className="text-[13px] text-neutral-500">Score %</p>
            </div>
          </div>
          {/* Reputation tier */}
          {completedOrders.length > 0 && (
            <div className="mt-3 bg-neutral-900 rounded-2xl p-4 flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-white">Reputation Level</p>
                <p className="text-[11px] text-neutral-500 mt-0.5">
                  {completedOrders.length >= 50 ? 'Elite Trader' :
                   completedOrders.length >= 20 ? 'Trusted' :
                   completedOrders.length >= 10 ? 'Established' :
                   completedOrders.length >= 3 ? 'Emerging' : 'New Trader'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-6 rounded-full ${
                      i < (completedOrders.length >= 50 ? 5 : completedOrders.length >= 20 ? 4 : completedOrders.length >= 10 ? 3 : completedOrders.length >= 3 ? 2 : 1)
                        ? 'bg-orange-400/80'
                        : 'bg-neutral-800'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Console & Analytics */}
        <div className="mt-6">
          <p className="text-[13px] text-neutral-500 mb-3 uppercase tracking-wide">Analytics</p>
          <a
            href="/console"
            className="w-full bg-neutral-900 rounded-2xl p-4 flex items-center justify-between hover:bg-neutral-800 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                <Clock className="w-5 h-5 text-white/70" />
              </div>
              <div>
                <p className="text-[15px] font-medium text-white">Console</p>
                <p className="text-[12px] text-neutral-500">View timeouts & analytics</p>
              </div>
            </div>
            {timedOutOrders.length > 0 && (
              <span className="px-2 py-1 bg-white/5 text-white/70 text-[11px] rounded-full font-medium">
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
              // Clear all session data
              localStorage.removeItem('blip_user');
              localStorage.removeItem('blip_wallet');
              // Reset all auth refs to prevent auto-login
              isAuthenticatingRef.current = false;
              lastAuthenticatedWalletRef.current = null;
              authAttemptedForWalletRef.current = null;
              // Close any modals
              setShowUsernameModal(false);
              setShowWalletModal(false);
              // Clear state
              setUserId(null);
              setUserWallet(null);
              setUserName('Guest');
              setUserBalance(0);
              setOrders([]);
              setBankAccounts([]);
              setResolvedDisputes([]);
              setLoginError('');
              setLoginForm({ username: '', password: '' });
              // Disconnect wallet first, then change screen
              if (solanaWallet.disconnect) {
                solanaWallet.disconnect();
              }
              // Force page reload to fully reset state
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

    </motion.div>
  );
}
