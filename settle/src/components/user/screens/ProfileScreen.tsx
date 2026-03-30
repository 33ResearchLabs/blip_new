"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Copy,
  Clock,
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
  const card = { background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' };
  const label = { fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const };
  const cardLabel = { fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', color: 'rgba(0,0,0,0.35)', textTransform: 'uppercase' as const };

  return (
    <div className="flex flex-col h-dvh overflow-hidden" style={{ background: '#060606' }}>

      {/* ── Header ── */}
      <header className="px-5 pt-10 pb-4 shrink-0">
        <p style={{ ...label, marginBottom: 4 }}>Account</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-[16px] flex items-center justify-center shrink-0"
              style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#000' }}>{userName.charAt(0).toUpperCase()}</span>
            </div>
            <div>
              <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', lineHeight: 1.1 }}>{userName}</p>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', marginTop: 2 }}>
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
              className="w-9 h-9 rounded-[12px] flex items-center justify-center"
              style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
              {copied ? <Check size={15} color="#10b981" /> : <Copy size={15} color="rgba(0,0,0,0.4)" />}
            </motion.button>
          )}
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex-1 px-5 pb-24 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'Trades', value: completedOrders.length.toString() },
            { label: 'Volume', value: completedOrders.reduce((s, o) => s + parseFloat(o.cryptoAmount), 0).toFixed(0) + ' USDT' },
            { label: 'Score', value: completedOrders.length > 0 ? (completedOrders.length / (completedOrders.length + timedOutOrders.length) * 100).toFixed(0) + '%' : '\u2014' },
          ].map(stat => (
            <div key={stat.label} className="rounded-[18px] flex flex-col items-center py-3" style={card}>
              <p style={{ ...cardLabel, marginBottom: 4 }}>{stat.label}</p>
              <p style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.03em', color: '#000' }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Reputation */}
        {completedOrders.length > 0 && (() => {
          const tier = completedOrders.length >= 50 ? 'Elite Trader' : completedOrders.length >= 20 ? 'Trusted' : completedOrders.length >= 10 ? 'Established' : completedOrders.length >= 3 ? 'Emerging' : 'New Trader';
          const lvl = completedOrders.length >= 50 ? 5 : completedOrders.length >= 20 ? 4 : completedOrders.length >= 10 ? 3 : completedOrders.length >= 3 ? 2 : 1;
          return (
            <div className="rounded-[18px] px-4 py-3 flex items-center justify-between mb-3" style={card}>
              <div>
                <p style={{ ...cardLabel, marginBottom: 4 }}>Reputation</p>
                <p style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', color: '#000' }}>{tier}</p>
              </div>
              <div className="flex items-end gap-1">
                {[...Array(5)].map((_, i) => (
                  <div key={i} style={{ width: 4, borderRadius: 2, height: 8 + i * 4, background: i < lvl ? '#000' : 'rgba(0,0,0,0.12)' }} />
                ))}
              </div>
            </div>
          );
        })()}

        {/* Wallet */}
        <p style={{ ...label, marginBottom: 8, display: 'block' }}>Solana Wallet</p>
        <div className="rounded-[18px] p-4 mb-3" style={card}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
              style={{ background: solanaWallet.connected ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
              <Wallet size={16} color={solanaWallet.connected ? '#000' : 'rgba(0,0,0,0.3)'} />
            </div>
            <div className="flex-1 min-w-0">
              <p style={{ ...cardLabel, marginBottom: 2 }}>
                {solanaWallet.connected ? 'Solana Devnet' : 'Not Connected'}
              </p>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#000', fontFamily: 'monospace' }}>
                {solanaWallet.connected && solanaWallet.walletAddress
                  ? `${solanaWallet.walletAddress.slice(0, 6)}...${solanaWallet.walletAddress.slice(-4)}`
                  : 'Connect your wallet'}
              </p>
            </div>
          </div>

          {/* Solana Balances */}
          {solanaWallet.connected && (
            <>
              <div className="flex gap-2 mb-2 pt-3" style={{ borderTop: '1px solid rgba(0,0,0,0.07)' }}>
                {[
                  { label: 'SOL', value: solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '\u2014' },
                  { label: 'USDT', value: solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '\u2014' },
                ].map(b => (
                  <div key={b.label} className="flex-1 rounded-[14px] px-3 py-2" style={{ background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.06)' }}>
                    <p style={{ ...cardLabel, marginBottom: 3 }}>{b.label}</p>
                    <p style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em', color: '#000' }}>{b.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.refreshBalances()}
                  className="flex-1 py-2 rounded-[12px]"
                  style={{ background: 'rgba(0,0,0,0.05)', fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Refresh
                </motion.button>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => solanaWallet.disconnect()}
                  className="flex-1 py-2 rounded-[12px]"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', fontSize: 11, fontWeight: 700, color: '#dc2626', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
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
              className="w-full py-3 rounded-[14px] flex items-center justify-center gap-2 mt-2"
              style={{ background: '#000000', fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>
              <Wallet size={16} color="#fff" /> Connect Wallet
            </motion.button>
          )}
        </div>

        {/* Bank Accounts */}
        <div className="flex items-center justify-between mb-2">
          <p style={label}>Bank Accounts</p>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(true)}
            className="w-8 h-8 rounded-[10px] flex items-center justify-center"
            style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
            <Plus size={15} color="rgba(0,0,0,0.5)" />
          </motion.button>
        </div>
        <div className="flex flex-col gap-2 mb-3">
          {bankAccounts.map(acc => (
            <div key={acc.id} className="flex items-center gap-3 rounded-2xl px-4 py-3" style={card}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'rgba(0,0,0,0.05)', fontSize: 18 }}>{'\uD83C\uDFE6'}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#000', letterSpacing: '-0.01em' }}>{acc.bank}</p>
                  {acc.isDefault && (
                    <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 99, background: '#000', color: '#fff' }}>Default</span>
                  )}
                </div>
                <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', fontFamily: 'monospace' }}>{acc.iban}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Console & Analytics */}
        <p style={{ ...label, marginBottom: 8, display: 'block' }}>Analytics</p>
        <a href="/console" className="flex items-center gap-3 rounded-[16px] px-4 py-3 mb-3" style={card}>
          <div className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
            style={{ background: 'rgba(0,0,0,0.06)' }}>
            <TrendingUp size={16} color="rgba(0,0,0,0.6)" />
          </div>
          <div className="flex-1">
            <p style={{ fontSize: 14, fontWeight: 700, color: '#000', letterSpacing: '-0.01em' }}>Console</p>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'rgba(0,0,0,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Timeouts & Analytics</p>
          </div>
          {timedOutOrders.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.2)' }}>
              {timedOutOrders.length} timeout{timedOutOrders.length !== 1 ? 's' : ''}
            </span>
          )}
          <ChevronRight size={15} color="rgba(0,0,0,0.2)" />
        </a>

        {/* Resolved Disputes */}
        {resolvedDisputes.length > 0 && (
          <>
            <p style={{ ...label, marginBottom: 8, display: 'block' }}>Resolved Disputes</p>
            <div className="flex flex-col gap-2 mb-3">
              {resolvedDisputes.map(dispute => (
                <div key={dispute.id} className="rounded-[16px] px-4 py-3" style={card}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#000' }}>#{dispute.orderNumber}</span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99,
                        ...(dispute.resolvedInFavorOf === 'user'
                          ? { background: 'rgba(16,185,129,0.1)', color: '#059669', border: '1px solid rgba(16,185,129,0.25)' }
                          : dispute.resolvedInFavorOf === 'merchant'
                          ? { background: 'rgba(239,68,68,0.1)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.2)' }
                          : { background: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.4)' })
                      }}>
                        {dispute.resolvedInFavorOf === 'user' ? 'Won' :
                         dispute.resolvedInFavorOf === 'merchant' ? 'Lost' : 'Split'}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)' }}>
                      {new Date(dispute.resolvedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>vs {dispute.otherPartyName}</p>
                    <p style={{ fontSize: 14, fontWeight: 800, color: '#000', letterSpacing: '-0.01em' }}>
                      ${dispute.cryptoAmount.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Theme Toggle — commented out, not ready yet
        <p style={{ ...label, marginBottom: 8, display: 'block' }}>Appearance</p>
        <div className="rounded-[16px] px-4 py-3 flex items-center justify-between mb-3" style={card}>
          <div className="flex items-center gap-3">
            {theme === 'dark' ? (
              <Moon size={16} color="rgba(0,0,0,0.6)" />
            ) : (
              <Sun size={16} color="rgba(0,0,0,0.6)" />
            )}
            <span style={{ fontSize: 14, fontWeight: 700, color: '#000' }}>
              {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
            </span>
          </div>
          <button onClick={toggleTheme}>
            <div style={{
              width: 48, height: 28, borderRadius: 14, padding: 2, transition: 'background 0.2s',
              background: theme === 'light' ? '#000' : 'rgba(0,0,0,0.12)',
              display: 'flex', alignItems: 'center',
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: 12, background: theme === 'light' ? '#fff' : 'rgba(0,0,0,0.3)',
                transition: 'transform 0.2s',
                transform: theme === 'light' ? 'translateX(20px)' : 'translateX(0px)',
              }} />
            </div>
          </button>
        </div>
        */}

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
          className="w-full flex items-center justify-center gap-2"
          style={{ height: 48, borderRadius: 14, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)', fontSize: 14, fontWeight: 800, color: '#dc2626', letterSpacing: '-0.01em' }}>
          <LogOut size={16} color="#dc2626" />
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
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30 }}
              className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} rounded-t-3xl`}
              style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}
            >
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <p style={{ fontSize: 17, fontWeight: 800, color: '#000', letterSpacing: '-0.02em' }}>Add Bank Account</p>
                <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowAddBank(false)}
                  className="w-8 h-8 rounded-[10px] flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.05)' }}>
                  <X size={15} color="rgba(0,0,0,0.4)" />
                </motion.button>
              </div>
              <div className="px-5 py-4 flex flex-col gap-3">
                <div>
                  <p style={{ ...cardLabel, marginBottom: 6, display: 'block' }}>Bank Name</p>
                  <input
                    value={newBank.bank}
                    onChange={(e) => setNewBank(p => ({ ...p, bank: e.target.value }))}
                    placeholder="Emirates NBD"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '10px 14px', fontSize: 14, fontWeight: 600, color: '#000', outline: 'none' }}
                  />
                </div>
                <div>
                  <p style={{ ...cardLabel, marginBottom: 6, display: 'block' }}>IBAN</p>
                  <input
                    value={newBank.iban}
                    onChange={(e) => setNewBank(p => ({ ...p, iban: e.target.value }))}
                    placeholder="AE12 0345 0000 0012 3456 789"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '10px 14px', fontSize: 14, fontWeight: 600, color: '#000', outline: 'none' }}
                  />
                </div>
                <div>
                  <p style={{ ...cardLabel, marginBottom: 6, display: 'block' }}>Account Name</p>
                  <input
                    value={newBank.name}
                    onChange={(e) => setNewBank(p => ({ ...p, name: e.target.value }))}
                    placeholder="John Doe"
                    style={{ width: '100%', background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '10px 14px', fontSize: 14, fontWeight: 600, color: '#000', outline: 'none' }}
                  />
                </div>
              </div>
              <div className="px-5 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}>
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={addBankAccount}
                  disabled={!newBank.bank || !newBank.iban || !newBank.name}
                  className="w-full"
                  style={{ height: 48, borderRadius: 14, fontSize: 14, fontWeight: 800, letterSpacing: '-0.01em', ...(newBank.bank && newBank.iban && newBank.name ? { background: '#000', color: '#fff' } : { background: 'rgba(0,0,0,0.05)', color: 'rgba(0,0,0,0.2)' }) }}>
                  Add Account
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <BottomNav screen={screen} setScreen={setScreen} maxW={maxW} />
    </div>
  );
};
