'use client';

import { useState } from 'react';
import { Loader2, Key, Download, Eye, EyeOff, Copy, Check, AlertTriangle } from 'lucide-react';
import {
  generateMnemonicWallet,
  importWallet,
  saveEncryptedWallet,
  saveEncryptedMnemonic,
  exportPrivateKey,
  validatePasswordStrength,
} from '@/lib/wallet/embeddedWallet';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { copyToClipboard } from '@/lib/clipboard';
import { Keypair } from '@solana/web3.js';
import { colors } from "@/lib/design/theme";

// Fetch the per-actor unlock helper from the server. Required when
// creating a new wallet at the current v3 blob version (Step 3 of
// wallet hardening). Returns null on any failure — caller treats null
// as "couldn't reach server, surface a retry-able error".
async function fetchUnlockHelper(): Promise<string | null> {
  try {
    const res = await fetchWithAuth('/api/wallet/unlock-helper');
    if (!res.ok) return null;
    const data = await res.json();
    const helper = data?.data?.unlock_helper;
    return typeof helper === 'string' && helper.length > 0 ? helper : null;
  } catch {
    return null;
  }
}

interface EmbeddedWalletSetupProps {
  // Actor that this wallet belongs to (user.id or merchant.id). Required so
  // the encrypted blob lands in the right per-actor localStorage slot —
  // device-wide storage was the bug that let User B see User A's unlock
  // prompt. Parents pass the id from their own auth probe; if it's not
  // ready yet, this component shows an error rather than writing to a
  // wrong-or-legacy slot.
  actorId: string | null;
  onWalletCreated: (keypair: Keypair) => void;
  onClose?: () => void;
}

export function EmbeddedWalletSetup({ actorId, onWalletCreated, onClose }: EmbeddedWalletSetupProps) {
  const [tab, setTab] = useState<'create' | 'import'>('create');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [privateKeyInput, setPrivateKeyInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // After creation — show backup key + recovery phrase
  const [createdKeypair, setCreatedKeypair] = useState<Keypair | null>(null);
  const [backupKey, setBackupKey] = useState('');
  // BIP39 mnemonic to show alongside the base58 backup key. Null on
  // legacy base58-import paths (no mnemonic to show).
  const [backupMnemonic, setBackupMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);

  const handleCreate = async () => {
    setError('');
    // Strength check enforced at creation time only. Existing wallets
    // (which may have been created under the old 6-char minimum) are
    // unaffected — unlock path never validates strength.
    const strength = validatePasswordStrength(password.trim());
    if (!strength.ok) { setError(strength.reason || 'Password is too weak'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!actorId) { setError('Session not ready — try again in a moment'); return; }

    setIsLoading(true);
    try {
      // Step 3: helper is mandatory for new (v3+) wallets.
      const unlockHelper = await fetchUnlockHelper();
      if (!unlockHelper) {
        setError('Could not reach the server. Check your connection and try again.');
        return;
      }
      // Step 4: mnemonic-derived wallet — recoverable in any Solana wallet
      // via the 12-word phrase shown on the next screen.
      const { keypair, mnemonic, encrypted, encryptedMnemonic } =
        await generateMnemonicWallet(password.trim(), unlockHelper);
      saveEncryptedWallet(actorId, encrypted);
      saveEncryptedMnemonic(actorId, encryptedMnemonic);
      setCreatedKeypair(keypair);
      setBackupKey(exportPrivateKey(keypair));
      setBackupMnemonic(mnemonic);
    } catch (err: any) {
      setError(err.message || 'Failed to create wallet');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    setError('');
    // Import re-encrypts with a new password, so apply the same strength
    // rules — otherwise importing would be a back-door around them.
    const strength = validatePasswordStrength(password.trim());
    if (!strength.ok) { setError(strength.reason || 'Password is too weak'); return; }
    if (!privateKeyInput.trim()) { setError('Paste your recovery phrase or private key'); return; }
    if (!actorId) { setError('Session not ready — try again in a moment'); return; }

    setIsLoading(true);
    try {
      const unlockHelper = await fetchUnlockHelper();
      if (!unlockHelper) {
        setError('Could not reach the server. Check your connection and try again.');
        return;
      }
      // importWallet auto-detects mnemonic vs base58. Persist the
      // encrypted mnemonic when present so the user can recover the
      // phrase later via "Show Recovery Phrase".
      const { keypair, encrypted, encryptedMnemonic } = await importWallet(
        privateKeyInput.trim(),
        password.trim(),
        unlockHelper,
      );
      saveEncryptedWallet(actorId, encrypted);
      if (encryptedMnemonic) {
        saveEncryptedMnemonic(actorId, encryptedMnemonic);
      }
      onWalletCreated(keypair);
    } catch (err: any) {
      setError(err.message || 'Invalid private key / recovery phrase or encryption failed');
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
    width: '100%', background: colors.surface.card, border: `1px solid ${colors.border.subtle}`,
    borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 500,
    color: colors.text.primary, outline: 'none', fontFamily: 'monospace',
  };

  const labelStyle = {
    display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em',
    textTransform: 'uppercase' as const, color: colors.text.tertiary, marginBottom: 6,
  };

  // Backup screen after creation
  if (createdKeypair) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
        <div className="rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl" style={{ background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`, border: `1px solid ${colors.border.subtle}` }}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold font-mono" style={{ color: colors.text.primary }}>Backup Your Wallet</h2>
          </div>

          <p className="text-sm font-mono" style={{ color: colors.text.secondary }}>
            Write your 12-word recovery phrase down on paper. If you forget your
            password or lose this device, the phrase is how you recover the wallet
            in any Solana wallet (Phantom, Solflare, etc.).
          </p>

          {/* Recovery phrase — only present for mnemonic-derived wallets
              (new Create path). Legacy base58-import path leaves it null. */}
          {backupMnemonic && (
            <div className="p-3 rounded-lg" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
              <div className="text-[10px] font-mono uppercase mb-2 flex items-center gap-1.5" style={{ color: colors.text.tertiary }}>
                <Key className="w-3 h-3" /> Recovery Phrase (12 words)
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {backupMnemonic.split(/\s+/).map((word, i) => (
                  <div
                    key={i}
                    className="px-2 py-1.5 rounded text-[11px] font-mono flex items-center gap-1.5"
                    style={{ background: colors.bg.primary, border: `1px solid ${colors.border.subtle}`, color: colors.text.primary }}
                  >
                    <span className="text-[9px] w-3 text-right" style={{ color: colors.text.tertiary }}>{i + 1}</span>
                    <span>{word}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Base58 private key — fallback backup material. Useful for users
              who already use a wallet that doesn't support BIP39 import. */}
          <details className="rounded-lg" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
            <summary className="px-3 py-2 text-[11px] font-mono cursor-pointer select-none" style={{ color: colors.text.tertiary }}>
              Also show base58 private key (advanced)
            </summary>
            <div className="relative px-3 pb-3">
              <div className="p-3 rounded-lg font-mono text-xs break-all select-all"
                style={{ background: colors.bg.primary, border: `1px solid ${colors.border.subtle}`, color: colors.text.secondary }}>
                {backupKey}
              </div>
              <button
                onClick={handleCopyKey}
                className="absolute top-5 right-5 p-1.5 rounded-md transition-colors"
                style={{ background: colors.surface.active }}
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" style={{ color: colors.text.tertiary }} />}
              </button>
            </div>
          </details>

          <div className="p-3 rounded-lg" style={{ background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`, border: `1px solid ${colors.border.subtle}` }}>
            <div className="text-[10px] font-mono uppercase mb-1" style={{ color: colors.text.tertiary }}>Public Address</div>
            <div className="text-sm font-mono break-all" style={{ color: colors.text.secondary }}>
              {createdKeypair.publicKey.toBase58()}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(e) => setBackupConfirmed(e.target.checked)}
              className="w-4 h-4 rounded"
              style={{ border: '1px solid rgba(0,0,0,0.2)' }}
            />
            <span className="text-xs font-mono" style={{ color: colors.text.secondary }}>
              I have saved my private key
            </span>
          </label>

          <button
            onClick={handleContinue}
            disabled={!backupConfirmed}
            className="w-full py-3 rounded-lg font-bold font-mono transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: colors.accent.primary, color: colors.accent.text }}
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="rounded-2xl w-full max-w-md p-6 space-y-5 shadow-2xl" style={{ background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`, border: `1px solid ${colors.border.subtle}` }}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-mono" style={{ color: colors.text.primary }}>Setup Wallet</h2>
          {onClose && (
            <button onClick={onClose} className="text-sm font-mono" style={{ color: colors.text.tertiary }}>
              Skip
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl p-1" style={{ background: colors.surface.card }}>
          <button
            onClick={() => { setTab('create'); setError(''); }}
            className="flex-1 py-2 rounded-lg text-xs font-mono font-medium transition-colors"
            style={tab === 'create'
              ? { background: colors.accent.primary, color: colors.accent.text }
              : { color: colors.text.tertiary }}
          >
            Create New
          </button>
          <button
            onClick={() => { setTab('import'); setError(''); }}
            className="flex-1 py-2 rounded-lg text-xs font-mono font-medium transition-colors"
            style={tab === 'import'
              ? { background: colors.accent.primary, color: colors.accent.text }
              : { color: colors.text.tertiary }}
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
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
            autoComplete="off"
            className="space-y-3"
          >
            {/* Hidden username anchor — keeps the password manager bound to
                THIS form so saved logins don't leak into nearby text inputs. */}
            <input
              type="text"
              name="wallet-account"
              autoComplete="username"
              value="blip-user-wallet"
              readOnly
              aria-hidden="true"
              tabIndex={-1}
              className="absolute opacity-0 pointer-events-none h-0 w-0"
            />
            <div>
              <label htmlFor="user-wallet-new-password" style={labelStyle}>Password</label>
              <div className="relative">
                <input
                  id="user-wallet-new-password"
                  name="user-wallet-new-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  maxLength={100}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="4-6 digit PIN or 12+ char password"
                  style={{ ...inputStyle, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                >
                  {showPassword
                    ? <EyeOff className="w-4 h-4" style={{ color: colors.text.tertiary }} />
                    : <Eye className="w-4 h-4" style={{ color: colors.text.tertiary }} />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="user-wallet-new-password-confirm" style={labelStyle}>Confirm Password</label>
              <input
                id="user-wallet-new-password-confirm"
                name="user-wallet-new-password-confirm"
                type="password"
                autoComplete="new-password"
                maxLength={100}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                style={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: colors.accent.primary, color: colors.accent.text }}
            >
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</> : <><Key className="w-4 h-4" /> Create Wallet</>}
            </button>
          </form>
        )}

        {/* Import tab */}
        {tab === 'import' && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleImport(); }}
            autoComplete="off"
            className="space-y-3"
          >
            {/* Hidden username anchor — see comment in create form. */}
            <input
              type="text"
              name="wallet-account"
              autoComplete="username"
              value="blip-user-wallet"
              readOnly
              aria-hidden="true"
              tabIndex={-1}
              className="absolute opacity-0 pointer-events-none h-0 w-0"
            />
            <div>
              <label htmlFor="user-wallet-import-key" style={labelStyle}>Private Key (Base58)</label>
              <textarea
                id="user-wallet-import-key"
                name="user-wallet-import-key"
                autoComplete="off"
                // 24-word phrases can exceed 150 chars (e.g. all "abandon"
                // → 24×8+23 = 215). Raise from 128 so longer recovery
                // phrases aren't silently truncated.
                maxLength={256}
                value={privateKeyInput}
                onChange={(e) => setPrivateKeyInput(e.target.value)}
                placeholder="Paste your 12-word recovery phrase OR base58 private key..."
                rows={3}
                className="resize-none"
                style={{ ...inputStyle, padding: '10px 14px' }}
              />
            </div>

            <div>
              <label htmlFor="user-wallet-import-password" style={labelStyle}>Encryption Password</label>
              <input
                id="user-wallet-import-password"
                name="user-wallet-import-password"
                type="password"
                autoComplete="new-password"
                maxLength={100}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="4-6 digit PIN or 12+ char password"
                style={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg font-bold font-mono transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: colors.accent.primary, color: colors.accent.text }}
            >
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing...</> : <><Download className="w-4 h-4" /> Import Wallet</>}
            </button>
          </form>
        )}

        <p className="text-[9px] font-mono text-center" style={{ color: colors.text.tertiary }}>
          Your private key is encrypted with AES-256-GCM and stored locally. We never see it.
        </p>
      </div>
    </div>
  );
}
