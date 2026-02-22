'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wallet, Lock, Unlock, Copy, Check, Loader2,
  Droplets, Download, Trash2, Key, Eye, EyeOff, ArrowDownToLine,
  ArrowUpFromLine, Shield, RefreshCw, ExternalLink,
} from 'lucide-react';
import { MerchantNavbar } from '@/components/merchant/MerchantNavbar';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { DEVNET_RPC } from '@/lib/solana/v2/config';
import {
  generateWallet, importWallet, decryptWallet, exportPrivateKey,
  saveEncryptedWallet, loadEncryptedWallet, clearEncryptedWallet,
  hasEncryptedWallet,
} from '@/lib/wallet/embeddedWallet';
import { Keypair } from '@solana/web3.js';

// Wallet hook — same pattern as merchant page
const useSolanaWalletHook = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSolanaWallet } = require('@/context/SolanaWalletContext');
    return useSolanaWallet();
  } catch {
    return {
      connected: false, publicKey: null, walletAddress: null,
      solBalance: null, usdtBalance: null, refreshBalances: async () => {},
      network: 'devnet' as const, programReady: false,
    };
  }
};

interface MerchantInfo {
  id: string;
  username: string;
  display_name: string;
}

type WalletView = 'loading' | 'setup' | 'unlock' | 'main';

export default function WalletPage() {
  const router = useRouter();
  const solanaWallet = useSolanaWalletHook();
  const embeddedWallet = (solanaWallet as any)?.embeddedWallet as {
    state: 'none' | 'locked' | 'unlocked';
    unlockWallet: (password: string) => Promise<boolean>;
    lockWallet: () => void;
    deleteWallet: () => void;
    setKeypairAndUnlock: (kp: Keypair) => void;
  } | undefined;

  const [merchantInfo, setMerchantInfo] = useState<MerchantInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<WalletView>('loading');

  // Setup state
  const [setupTab, setSetupTab] = useState<'create' | 'import'>('create');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState('');

  // Unlock state
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockLoading, setUnlockLoading] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  // Main wallet state
  const [copied, setCopied] = useState(false);
  const [isAirdropping, setIsAirdropping] = useState(false);
  const [airdropMsg, setAirdropMsg] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Backup state (after creation)
  const [pendingKeypair, setPendingKeypair] = useState<Keypair | null>(null);
  const [backupDownloaded, setBackupDownloaded] = useState(false);

  // Restore merchant session
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const savedMerchant = localStorage.getItem('blip_merchant');
        if (savedMerchant) {
          const merchant = JSON.parse(savedMerchant);
          const checkRes = await fetch(`/api/auth/merchant?action=check_session&merchant_id=${merchant.id}`);
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.success && checkData.data?.valid) {
              setMerchantInfo(checkData.data.merchant || merchant);
              setIsLoading(false);
              return;
            }
          }
          localStorage.removeItem('blip_merchant');
        }
      } catch {
        localStorage.removeItem('blip_merchant');
      }
      setIsLoading(false);
      router.push('/merchant/login');
    };
    restoreSession();
  }, [router]);

  // Determine view based on wallet state
  useEffect(() => {
    if (isLoading) { setView('loading'); return; }
    if (!embeddedWallet) { setView('setup'); return; }

    switch (embeddedWallet.state) {
      case 'none': setView('setup'); break;
      case 'locked': setView('unlock'); break;
      case 'unlocked': setView('main'); break;
    }
  }, [isLoading, embeddedWallet?.state]);

  // ---- Handlers ----

  const handleCreate = async () => {
    setSetupError('');
    if (password.length < 6) { setSetupError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setSetupError('Passwords do not match'); return; }

    setSetupLoading(true);
    try {
      const { keypair, encrypted } = await generateWallet(password);
      saveEncryptedWallet(encrypted);
      setPendingKeypair(keypair);
    } catch (err: any) {
      setSetupError(err.message || 'Failed to create wallet');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleImport = async () => {
    setSetupError('');
    if (password.length < 6) { setSetupError('Password must be at least 6 characters'); return; }
    if (!privateKeyInput.trim()) { setSetupError('Paste your private key'); return; }

    setSetupLoading(true);
    try {
      const { keypair, encrypted } = await importWallet(privateKeyInput.trim(), password);
      saveEncryptedWallet(encrypted);
      embeddedWallet?.setKeypairAndUnlock(keypair);
    } catch (err: any) {
      setSetupError(err.message || 'Invalid private key');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleDownloadBackup = () => {
    if (!pendingKeypair) return;
    const key = exportPrivateKey(pendingKeypair);
    const blob = new Blob(
      [`Blip Money — Wallet Backup\n\nPublic Key: ${pendingKeypair.publicKey.toBase58()}\nPrivate Key: ${key}\n\nKeep this file safe. Anyone with the private key can access your funds.\nGenerated: ${new Date().toISOString()}\n`],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `blip-wallet-backup-${pendingKeypair.publicKey.toBase58().slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupDownloaded(true);
  };

  const handleFinishSetup = () => {
    if (pendingKeypair && embeddedWallet) {
      embeddedWallet.setKeypairAndUnlock(pendingKeypair);
      setPendingKeypair(null);
      setBackupDownloaded(false);
      setPassword('');
      setConfirmPassword('');
    }
  };

  const handleUnlock = async () => {
    if (!unlockPassword) return;
    setUnlockError('');
    setUnlockLoading(true);
    try {
      const ok = await embeddedWallet?.unlockWallet(unlockPassword);
      if (!ok) { setUnlockError('Wrong password'); setUnlockPassword(''); }
    } catch {
      setUnlockError('Failed to decrypt wallet');
    } finally {
      setUnlockLoading(false);
    }
  };

  const handleCopyAddress = () => {
    if (!solanaWallet.walletAddress) return;
    navigator.clipboard.writeText(solanaWallet.walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAirdropSol = useCallback(async () => {
    if (!solanaWallet.publicKey || isAirdropping) return;
    setIsAirdropping(true);
    setAirdropMsg('');
    try {
      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const sig = await connection.requestAirdrop(solanaWallet.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      setAirdropMsg('2 SOL airdropped!');
      await solanaWallet.refreshBalances();
    } catch (err: any) {
      setAirdropMsg(err.message?.includes('429') ? 'Rate limited — try again later' : 'Airdrop failed');
    } finally {
      setIsAirdropping(false);
      setTimeout(() => setAirdropMsg(''), 5000);
    }
  }, [solanaWallet.publicKey, isAirdropping]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try { await solanaWallet.refreshBalances(); } catch {}
    setIsRefreshing(false);
  };

  const handleExportKey = () => {
    // We need to prompt for password, decrypt, then download
    const pw = prompt('Enter your wallet password to export the private key');
    if (!pw) return;

    const encrypted = loadEncryptedWallet();
    if (!encrypted) { alert('No wallet found'); return; }

    decryptWallet(encrypted, pw).then(kp => {
      const key = exportPrivateKey(kp);
      const blob = new Blob(
        [`Blip Money — Wallet Export\n\nPublic Key: ${kp.publicKey.toBase58()}\nPrivate Key: ${key}\n\nKeep this file safe.\nExported: ${new Date().toISOString()}\n`],
        { type: 'text/plain' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blip-wallet-export-${kp.publicKey.toBase58().slice(0, 8)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => {
      alert('Wrong password');
    });
  };

  const handleDelete = () => {
    embeddedWallet?.deleteWallet();
    setShowDeleteConfirm(false);
  };

  const address = solanaWallet.walletAddress || '';
  const truncated = address ? `${address.slice(0, 8)}....${address.slice(-6)}` : '';

  // Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#060606] overflow-hidden">
      <MerchantNavbar
        activePage="wallet"
        merchantInfo={merchantInfo}
        embeddedWalletState={embeddedWallet?.state}
      />

      {/* Main content — centered card */}
      <div className="flex-1 flex items-start justify-center overflow-y-auto pt-8 pb-8 px-4">
        <div className="w-full max-w-[420px]">

          {/* ========== SETUP VIEW ========== */}
          {(view === 'setup' && !pendingKeypair) && (
            <div className="space-y-6">
              {/* Wallet icon hero */}
              <div className="text-center pt-4">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/5 border border-orange-500/20 flex items-center justify-center mb-4">
                  <Wallet className="w-10 h-10 text-orange-500" />
                </div>
                <h1 className="text-2xl font-bold text-white font-mono">Create Your Wallet</h1>
                <p className="text-sm text-white/40 font-mono mt-2">
                  Non-custodial Solana wallet. Your keys, your crypto.
                </p>
              </div>

              {/* Glass card */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                {/* Tabs */}
                <div className="flex bg-white/[0.03] rounded-lg p-[3px]">
                  <button
                    onClick={() => { setSetupTab('create'); setSetupError(''); }}
                    className={`flex-1 py-2.5 rounded-md text-xs font-mono font-medium transition-colors ${
                      setupTab === 'create' ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    Create New
                  </button>
                  <button
                    onClick={() => { setSetupTab('import'); setSetupError(''); }}
                    className={`flex-1 py-2.5 rounded-md text-xs font-mono font-medium transition-colors ${
                      setupTab === 'import' ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    Import Key
                  </button>
                </div>

                {setupError && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                    {setupError}
                  </div>
                )}

                {setupTab === 'create' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">Password</label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Min 6 characters"
                          className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                     text-sm text-white font-mono placeholder:text-white/20
                                     focus:outline-none focus:border-orange-500/50 transition-colors"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2">
                          {showPassword ? <EyeOff className="w-4 h-4 text-white/30" /> : <Eye className="w-4 h-4 text-white/30" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">Confirm Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20
                                   focus:outline-none focus:border-orange-500/50 transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleCreate}
                      disabled={setupLoading}
                      className="w-full py-3.5 rounded-xl bg-orange-500 text-black font-bold font-mono text-sm
                                 hover:bg-orange-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {setupLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Key className="w-4 h-4" /> Create Wallet</>}
                    </button>
                  </div>
                )}

                {setupTab === 'import' && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">Private Key (Base58)</label>
                      <textarea
                        value={privateKeyInput}
                        onChange={(e) => setPrivateKeyInput(e.target.value)}
                        placeholder="Paste your base58 private key..."
                        rows={3}
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20 resize-none
                                   focus:outline-none focus:border-orange-500/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">Encryption Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min 6 characters"
                        className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                                   text-sm text-white font-mono placeholder:text-white/20
                                   focus:outline-none focus:border-orange-500/50 transition-colors"
                      />
                    </div>
                    <button
                      onClick={handleImport}
                      disabled={setupLoading}
                      className="w-full py-3.5 rounded-xl bg-orange-500 text-black font-bold font-mono text-sm
                                 hover:bg-orange-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {setupLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</> : <><ArrowDownToLine className="w-4 h-4" /> Import Wallet</>}
                    </button>
                  </div>
                )}
              </div>

              {/* Security note */}
              <div className="flex items-start gap-2.5 px-1">
                <Shield className="w-4 h-4 text-white/20 shrink-0 mt-0.5" />
                <p className="text-[10px] text-white/25 font-mono leading-relaxed">
                  Your private key is encrypted with AES-256-GCM and stored only in your browser. We never see or store your keys.
                </p>
              </div>
            </div>
          )}

          {/* ========== BACKUP VIEW (after create) ========== */}
          {(view === 'setup' && pendingKeypair) && (
            <div className="space-y-6">
              <div className="text-center pt-4">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/5 border border-orange-500/20 flex items-center justify-center mb-4">
                  <Shield className="w-10 h-10 text-orange-500" />
                </div>
                <h1 className="text-2xl font-bold text-white font-mono">Backup Your Wallet</h1>
                <p className="text-sm text-white/40 font-mono mt-2">
                  Download your recovery file. Without it, a forgotten password means lost funds.
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                {/* Public address preview */}
                <div className="p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl">
                  <div className="text-[10px] text-white/30 font-mono uppercase mb-1">Your Public Address</div>
                  <div className="text-sm text-white/80 font-mono break-all">
                    {pendingKeypair.publicKey.toBase58()}
                  </div>
                </div>

                {/* Download button */}
                <button
                  onClick={handleDownloadBackup}
                  className={`w-full py-3.5 rounded-xl font-bold font-mono text-sm flex items-center justify-center gap-2 transition-colors ${
                    backupDownloaded
                      ? 'bg-green-500/20 border border-green-500/30 text-green-400'
                      : 'bg-orange-500 text-black hover:bg-orange-400'
                  }`}
                >
                  {backupDownloaded ? (
                    <><Check className="w-4 h-4" /> Backup Downloaded</>
                  ) : (
                    <><Download className="w-4 h-4" /> Download Backup File</>
                  )}
                </button>

                {/* Continue */}
                <button
                  onClick={handleFinishSetup}
                  disabled={!backupDownloaded}
                  className="w-full py-3.5 rounded-xl bg-white/[0.06] border border-white/[0.08] text-white font-bold font-mono text-sm
                             hover:bg-white/[0.08] transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  Continue to Wallet
                </button>
              </div>

              <div className="flex items-start gap-2.5 px-1">
                <Shield className="w-4 h-4 text-red-400/50 shrink-0 mt-0.5" />
                <p className="text-[10px] text-red-400/50 font-mono leading-relaxed">
                  The backup file contains your private key. Never share it. Store it offline.
                </p>
              </div>
            </div>
          )}

          {/* ========== UNLOCK VIEW ========== */}
          {view === 'unlock' && (
            <div className="space-y-6">
              <div className="text-center pt-4">
                <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-orange-500/20 to-orange-600/5 border border-orange-500/20 flex items-center justify-center mb-4">
                  <Lock className="w-10 h-10 text-orange-500" />
                </div>
                <h1 className="text-2xl font-bold text-white font-mono">Unlock Wallet</h1>
                <p className="text-sm text-white/40 font-mono mt-2">
                  Enter your password to access your wallet
                </p>
              </div>

              <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl p-5 space-y-4">
                {unlockError && (
                  <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
                    {unlockError}
                  </div>
                )}

                <div>
                  <label className="text-[10px] text-white/40 font-mono uppercase mb-1.5 block">Password</label>
                  <input
                    type="password"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                    placeholder="Enter your wallet password"
                    autoFocus
                    className="w-full px-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl
                               text-sm text-white font-mono placeholder:text-white/20
                               focus:outline-none focus:border-orange-500/50 transition-colors"
                  />
                </div>

                <button
                  onClick={handleUnlock}
                  disabled={unlockLoading || !unlockPassword}
                  className="w-full py-3.5 rounded-xl bg-orange-500 text-black font-bold font-mono text-sm
                             hover:bg-orange-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {unlockLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking...</> : <><Unlock className="w-4 h-4" /> Unlock</>}
                </button>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      embeddedWallet?.deleteWallet();
                      setSetupTab('import');
                    }}
                    className="text-[10px] text-orange-500/60 hover:text-orange-500 font-mono transition-colors flex items-center gap-1"
                  >
                    <Key className="w-3 h-3" />
                    Import with private key
                  </button>
                  <button
                    onClick={() => {
                      embeddedWallet?.deleteWallet();
                      setSetupTab('create');
                    }}
                    className="text-[10px] text-white/30 hover:text-white/50 font-mono transition-colors flex items-center gap-1"
                  >
                    <Wallet className="w-3 h-3" />
                    Create new wallet
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========== MAIN WALLET VIEW ========== */}
          {view === 'main' && (
            <div className="space-y-4">
              {/* Balance hero */}
              <div className="bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.06] rounded-2xl p-6 text-center">
                {/* Status indicator */}
                <div className="flex items-center justify-center gap-1.5 mb-4">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="text-[10px] text-green-400 font-mono uppercase tracking-wider">Connected</span>
                </div>

                {/* Total balance */}
                <div className="text-[10px] text-white/30 font-mono uppercase tracking-wider mb-1">
                  USDT Balance
                </div>
                <div className="text-4xl font-bold text-white font-mono tabular-nums mb-1">
                  {solanaWallet.usdtBalance !== null
                    ? solanaWallet.usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : '—'
                  }
                </div>
                <div className="text-xs text-white/30 font-mono">
                  Fake USDT on Devnet
                </div>

                {/* SOL balance mini */}
                <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-center gap-4">
                  <div className="text-center">
                    <div className="text-[9px] text-white/30 font-mono uppercase">SOL</div>
                    <div className="text-sm font-bold text-white/70 font-mono tabular-nums">
                      {solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '—'}
                    </div>
                  </div>
                  <div className="w-px h-6 bg-white/[0.06]" />
                  <div className="text-center">
                    <div className="text-[9px] text-white/30 font-mono uppercase">Network</div>
                    <div className="text-sm font-medium text-orange-400 font-mono">Devnet</div>
                  </div>
                </div>
              </div>

              {/* Address card */}
              <div
                onClick={handleCopyAddress}
                className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-white/[0.12] transition-colors group"
              >
                <div>
                  <div className="text-[9px] text-white/30 font-mono uppercase mb-0.5">Wallet Address</div>
                  <div className="text-sm text-white/80 font-mono group-hover:text-white transition-colors">{truncated}</div>
                </div>
                <div className="flex items-center gap-2">
                  {address && (
                    <a
                      href={`https://explorer.solana.com/address/${address}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-white/20 hover:text-white/40" />
                    </a>
                  )}
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-white/30" />}
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleAirdropSol}
                  disabled={isAirdropping}
                  className="py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors
                             flex flex-col items-center gap-1.5 disabled:opacity-50"
                >
                  {isAirdropping ? <Loader2 className="w-5 h-5 text-orange-400 animate-spin" /> : <Droplets className="w-5 h-5 text-orange-400" />}
                  <span className="text-[10px] text-white/50 font-mono">Airdrop SOL</span>
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors
                             flex flex-col items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-5 h-5 text-orange-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span className="text-[10px] text-white/50 font-mono">Refresh</span>
                </button>
                <button
                  onClick={handleExportKey}
                  className="py-3 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.05] transition-colors
                             flex flex-col items-center gap-1.5"
                >
                  <Download className="w-5 h-5 text-orange-400" />
                  <span className="text-[10px] text-white/50 font-mono">Export Key</span>
                </button>
              </div>

              {airdropMsg && (
                <div className={`text-xs font-mono text-center py-2 rounded-lg ${
                  airdropMsg.includes('airdropped')
                    ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                    : 'text-red-400 bg-red-500/10 border border-red-500/20'
                }`}>
                  {airdropMsg}
                </div>
              )}

              {/* Token list */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.04]">
                  <span className="text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Tokens</span>
                </div>

                {/* SOL row */}
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border border-purple-500/20">
                      <span className="text-xs font-bold text-purple-300">S</span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white font-mono">SOL</div>
                      <div className="text-[10px] text-white/30 font-mono">Solana</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white font-mono tabular-nums">
                      {solanaWallet.solBalance !== null ? solanaWallet.solBalance.toFixed(4) : '0.0000'}
                    </div>
                  </div>
                </div>

                {/* USDT row */}
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500/30 to-emerald-500/30 flex items-center justify-center border border-green-500/20">
                      <span className="text-xs font-bold text-green-300">$</span>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white font-mono">USDT</div>
                      <div className="text-[10px] text-white/30 font-mono">Fake USDT (Devnet)</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-orange-500 font-mono tabular-nums">
                      {solanaWallet.usdtBalance !== null ? solanaWallet.usdtBalance.toFixed(2) : '0.00'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Security section */}
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.04]">
                  <span className="text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">Security</span>
                </div>

                <button
                  onClick={() => embeddedWallet?.lockWallet()}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors border-b border-white/[0.03]"
                >
                  <Lock className="w-4 h-4 text-white/30" />
                  <span className="text-sm text-white/60 font-mono">Lock Wallet</span>
                </button>

                <button
                  onClick={handleExportKey}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors border-b border-white/[0.03]"
                >
                  <Download className="w-4 h-4 text-white/30" />
                  <span className="text-sm text-white/60 font-mono">Download Backup</span>
                </button>

                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-red-500/5 transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-red-400/50" />
                  <span className="text-sm text-red-400/60 font-mono">Delete Wallet</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-sm border border-white/[0.08] shadow-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-red-400 font-mono">Delete Wallet?</h3>
            <p className="text-xs text-white/50 font-mono leading-relaxed">
              This removes the encrypted key from this device permanently. Make sure you have downloaded your backup file first.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/[0.06] text-sm text-white/60 font-mono hover:bg-white/[0.08] transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 py-2.5 rounded-xl bg-red-500/20 border border-red-500/30 text-sm text-red-400 font-mono hover:bg-red-500/30 transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
