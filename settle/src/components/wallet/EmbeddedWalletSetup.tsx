'use client';

import { useState } from 'react';
import { Loader2, Key, Download, Eye, EyeOff, Copy, Check, AlertTriangle } from 'lucide-react';
import { generateWallet, importWallet, saveEncryptedWallet, exportPrivateKey } from '@/lib/wallet/embeddedWallet';
import { copyToClipboard } from '@/lib/clipboard';
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

  const handleCopyKey = async () => {
    await copyToClipboard(backupKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleContinue = () => {
    if (createdKeypair) onWalletCreated(createdKeypair);
  };

  const inputStyle = {
    width: '100%', background: '#f4f4f4', border: '1px solid rgba(0,0,0,0.08)',
    borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 500,
    color: '#000', outline: 'none', fontFamily: 'monospace',
  };

  const labelStyle = {
    display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em',
    textTransform: 'uppercase' as const, color: 'rgba(0,0,0,0.4)', marginBottom: 6,
  };

  // Backup screen after creation
  if (createdKeypair) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
        <div className="rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-bold font-mono" style={{ color: '#000' }}>Backup Your Key</h2>
          </div>

          <p className="text-sm font-mono" style={{ color: 'rgba(0,0,0,0.5)' }}>
            Save this private key somewhere safe. If you forget your password,
            this is the only way to recover your wallet.
          </p>

          <div className="relative">
            <div className="p-3 rounded-lg font-mono text-xs break-all select-all"
              style={{ background: '#f4f4f4', border: '1px solid rgba(0,0,0,0.08)', color: 'rgba(0,0,0,0.7)' }}>
              {backupKey}
            </div>
            <button
              onClick={handleCopyKey}
              className="absolute top-2 right-2 p-1.5 rounded-md transition-colors"
              style={{ background: 'rgba(0,0,0,0.05)' }}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" style={{ color: 'rgba(0,0,0,0.4)' }} />}
            </button>
          </div>

          <div className="p-3 rounded-lg" style={{ background: '#f4f4f4', border: '1px solid rgba(0,0,0,0.08)' }}>
            <div className="text-[10px] font-mono uppercase mb-1" style={{ color: 'rgba(0,0,0,0.4)' }}>Public Address</div>
            <div className="text-sm font-mono break-all" style={{ color: 'rgba(0,0,0,0.7)' }}>
              {createdKeypair.publicKey.toBase58()}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(e) => setBackupConfirmed(e.target.checked)}
              className="w-4 h-4 rounded accent-orange-500"
              style={{ border: '1px solid rgba(0,0,0,0.2)' }}
            />
            <span className="text-xs font-mono" style={{ color: 'rgba(0,0,0,0.6)' }}>
              I have saved my private key
            </span>
          </label>

          <button
            onClick={handleContinue}
            disabled={!backupConfirmed}
            className="w-full py-3 rounded-lg font-bold font-mono transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: '#111111', color: '#fff' }}
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl" style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-mono" style={{ color: '#000' }}>Setup Wallet</h2>
          {onClose && (
            <button onClick={onClose} className="text-sm font-mono" style={{ color: 'rgba(0,0,0,0.4)' }}>
              Skip
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl p-1" style={{ background: 'rgba(0,0,0,0.04)' }}>
          <button
            onClick={() => { setTab('create'); setError(''); }}
            className="flex-1 py-2 rounded-lg text-xs font-mono font-medium transition-colors"
            style={tab === 'create'
              ? { background: '#111111', color: '#fff' }
              : { color: 'rgba(0,0,0,0.4)' }}
          >
            Create New
          </button>
          <button
            onClick={() => { setTab('import'); setError(''); }}
            className="flex-1 py-2 rounded-lg text-xs font-mono font-medium transition-colors"
            style={tab === 'import'
              ? { background: '#111111', color: '#fff' }
              : { color: 'rgba(0,0,0,0.4)' }}
          >
            Import Key
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-2 rounded-lg text-xs font-mono" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.15)', color: '#dc2626' }}>
            {error}
          </div>
        )}

        {/* Create tab */}
        {tab === 'create' && (
          <div className="space-y-3">
            <div>
              <label style={labelStyle}>Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 6 characters"
                  style={{ ...inputStyle, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                >
                  {showPassword
                    ? <EyeOff className="w-4 h-4" style={{ color: 'rgba(0,0,0,0.3)' }} />
                    : <Eye className="w-4 h-4" style={{ color: 'rgba(0,0,0,0.3)' }} />}
                </button>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                style={inputStyle}
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={isLoading}
              className="w-full py-3 rounded-lg font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: '#111111', color: '#fff' }}
            >
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Key className="w-4 h-4" /> Create Wallet</>}
            </button>
          </div>
        )}

        {/* Import tab */}
        {tab === 'import' && (
          <div className="space-y-3">
            <div>
              <label style={labelStyle}>Private Key (Base58)</label>
              <textarea
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value)}
                placeholder="Paste your base58 private key..."
                rows={3}
                className="resize-none"
                style={{ ...inputStyle, padding: '10px 14px' }}
              />
            </div>

            <div>
              <label style={labelStyle}>Encryption Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                style={inputStyle}
              />
            </div>

            <button
              onClick={handleImport}
              disabled={isLoading}
              className="w-full py-3 rounded-lg font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: '#111111', color: '#fff' }}
            >
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</> : <><Download className="w-4 h-4" /> Import Wallet</>}
            </button>
          </div>
        )}

        <p className="text-[9px] font-mono text-center" style={{ color: 'rgba(0,0,0,0.3)' }}>
          Your private key is encrypted with AES-256-GCM and stored locally. We never see it.
        </p>
      </div>
    </div>
  );
}
