'use client';

import { useState } from 'react';
import { Loader2, Key, Download, Eye, EyeOff, Copy, Check, AlertTriangle } from 'lucide-react';
import { generateWallet, importWallet, saveEncryptedWallet, exportPrivateKey } from '@/lib/wallet/embeddedWallet';
import { Keypair } from '@solana/web3.js';

interface EmbeddedWalletSetupProps {
  onWalletCreated: (keypair: Keypair) => void;
  onClose?: () => void;
}

export function EmbeddedWalletSetup({ onWalletCreated, onClose }: EmbeddedWalletSetupProps) {
  const [tab, setTab] = useState<'create' | 'import'>('create');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // After creation — show backup key
  const [createdKeypair, setCreatedKeypair] = useState<Keypair | null>(null);
  const [backupKey, setBackupKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);

  const handleCreate = async () => {
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setIsLoading(true);
    try {
      const { keypair, encrypted } = await generateWallet(password);
      saveEncryptedWallet(encrypted);
      setCreatedKeypair(keypair);
      setBackupKey(exportPrivateKey(keypair));
    } catch (err: any) {
      setError(err.message || 'Failed to create wallet');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    if (!privateKeyInput.trim()) { setError('Paste your private key'); return; }

    setIsLoading(true);
    try {
      const { keypair, encrypted } = await importWallet(privateKeyInput.trim(), password);
      saveEncryptedWallet(encrypted);
      onWalletCreated(keypair);
    } catch (err: any) {
      setError(err.message || 'Invalid private key or encryption failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyKey = () => {
    navigator.clipboard.writeText(backupKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    if (createdKeypair) onWalletCreated(createdKeypair);
  };

  // Backup screen after creation
  if (createdKeypair) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-md border border-white/[0.08] shadow-2xl p-6 space-y-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-bold text-white font-mono">Backup Your Key</h2>
          </div>

          <p className="text-sm text-white/60 font-mono">
            Save this private key somewhere safe. If you forget your password,
            this is the only way to recover your wallet.
          </p>

          <div className="relative">
            <div className="p-3 bg-white/[0.04] border border-white/[0.08] rounded-lg font-mono text-xs text-white/80 break-all select-all">
              {backupKey}
            </div>
            <button
              onClick={handleCopyKey}
              className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-white/[0.08] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
            </button>
          </div>

          <div className="p-3 bg-white/[0.04] border border-white/[0.08] rounded-lg">
            <div className="text-[10px] text-white/40 font-mono uppercase mb-1">Public Address</div>
            <div className="text-sm text-white/80 font-mono break-all">
              {createdKeypair.publicKey.toBase58()}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(e) => setBackupConfirmed(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/[0.04] accent-orange-500"
            />
            <span className="text-xs text-white/60 font-mono">
              I have saved my private key
            </span>
          </label>

          <button
            onClick={handleContinue}
            disabled={!backupConfirmed}
            className="w-full py-3 rounded-lg bg-orange-500 text-black font-bold font-mono
                       hover:bg-orange-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0d0d0d] rounded-2xl w-full max-w-md border border-white/[0.08] shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white font-mono">Setup Wallet</h2>
          {onClose && (
            <button onClick={onClose} className="text-white/40 hover:text-white/60 text-sm font-mono">
              Skip
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex bg-white/[0.03] rounded-lg p-[3px]">
          <button
            onClick={() => { setTab('create'); setError(''); }}
            className={`flex-1 py-2 rounded-md text-xs font-mono font-medium transition-colors ${
              tab === 'create' ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/60'
            }`}
          >
            Create New
          </button>
          <button
            onClick={() => { setTab('import'); setError(''); }}
            className={`flex-1 py-2 rounded-md text-xs font-mono font-medium transition-colors ${
              tab === 'import' ? 'bg-white/[0.08] text-white' : 'text-white/40 hover:text-white/60'
            }`}
          >
            Import Key
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-mono">
            {error}
          </div>
        )}

        {/* Create tab */}
        {tab === 'create' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-white/40 font-mono uppercase mb-1 block">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg
                             text-sm text-white font-mono placeholder:text-white/20
                             focus:outline-none focus:border-orange-500/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4 text-white/30" /> : <Eye className="w-4 h-4 text-white/30" />}
                </button>
              </div>
            </div>

            <div>
              <label className="text-[10px] text-white/40 font-mono uppercase mb-1 block">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-sm text-white font-mono placeholder:text-white/20
                           focus:outline-none focus:border-orange-500/50"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={isLoading}
              className="w-full py-3 rounded-lg bg-orange-500 text-black font-bold font-mono
                         hover:bg-orange-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Key className="w-4 h-4" /> Create Wallet</>}
            </button>
          </div>
        )}

        {/* Import tab */}
        {tab === 'import' && (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-white/40 font-mono uppercase mb-1 block">Private Key (Base58)</label>
              <textarea
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value)}
                placeholder="Paste your base58 private key..."
                rows={3}
                className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-sm text-white font-mono placeholder:text-white/20 resize-none
                           focus:outline-none focus:border-orange-500/50"
              />
            </div>

            <div>
              <label className="text-[10px] text-white/40 font-mono uppercase mb-1 block">Encryption Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg
                           text-sm text-white font-mono placeholder:text-white/20
                           focus:outline-none focus:border-orange-500/50"
              />
            </div>

            <button
              onClick={handleImport}
              disabled={isLoading}
              className="w-full py-3 rounded-lg bg-orange-500 text-black font-bold font-mono
                         hover:bg-orange-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</> : <><Download className="w-4 h-4" /> Import Wallet</>}
            </button>
          </div>
        )}

        <p className="text-[9px] text-white/30 font-mono text-center">
          Your private key is encrypted with AES-256-GCM and stored locally. We never see it.
        </p>
      </div>
    </div>
  );
}
