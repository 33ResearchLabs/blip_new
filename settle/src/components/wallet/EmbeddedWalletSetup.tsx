'use client';

import { useState } from 'react';
import { Loader2, Key, Download, Copy, Check, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  generateMnemonicWallet,
  importWallet,
  saveEncryptedWallet,
  saveEncryptedMnemonic,
  exportPrivateKey,
} from '@/lib/wallet/embeddedWallet';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { copyToClipboard } from '@/lib/clipboard';
import { Keypair } from '@solana/web3.js';
import { colors } from "@/lib/design/theme";
import { AppPinPad } from '@/components/app-lock/AppPinPad';

const PIN_LENGTH = 6;

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
  // 'enter' = first PIN entry; 'confirm' = re-enter for confirmation.
  // Two-step flow keeps a single visible on-screen keypad (AppPinPad is
  // tap-driven; stacking two would crowd the modal).
  const [createStep, setCreateStep] = useState<'enter' | 'confirm'>('enter');
  const [errorTick, setErrorTick] = useState(0);
  // Import tab PIN UX — PhonePe-style: two displays (PIN + Confirm PIN),
  // tapping one opens the keypad targeting that field; eye toggle reveals
  // entered digits. activePinField = null hides the keypad entirely.
  const [activePinField, setActivePinField] = useState<'pin' | 'confirm' | null>(null);
  const [showPin, setShowPin] = useState(false);

  // After creation — show backup key + recovery phrase
  const [createdKeypair, setCreatedKeypair] = useState<Keypair | null>(null);
  const [backupKey, setBackupKey] = useState('');
  // BIP39 mnemonic to show alongside the base58 backup key. Null on
  // legacy base58-import paths (no mnemonic to show).
  const [backupMnemonic, setBackupMnemonic] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backupConfirmed, setBackupConfirmed] = useState(false);

  // Pin is passed explicitly because this is invoked from AppPinPad's
  // synchronous onComplete callback — at that moment React hasn't yet
  // committed the setConfirmPassword from the same press, so closing over
  // `confirmPassword` here would read the previous (5-digit) value.
  const handleCreate = async (pin: string = password) => {
    setError('');
    if (!/^\d{6}$/.test(pin)) { setError(`Enter your ${PIN_LENGTH}-digit PIN`); return; }
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
        await generateMnemonicWallet(pin.trim(), unlockHelper);
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

  const handleImport = async (pin: string = password) => {
    setError('');
    // Import re-encrypts under the user's MPIN — same secret as Create.
    if (!/^\d{6}$/.test(pin)) { setError(`Enter your ${PIN_LENGTH}-digit PIN`); return; }
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
        pin.trim(),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-3xl w-full max-w-md p-6 sm:p-7 space-y-5 shadow-2xl flex flex-col"
        style={{
          background: `linear-gradient(${colors.surface.card}, ${colors.surface.card}), ${colors.bg.primary}`,
          border: `1px solid ${colors.border.subtle}`,
          // Use `dvh` so the modal respects the actual viewport height
          // (accounting for mobile browser chrome). `vh` on iOS Safari
          // and some Android browsers reports the full screen height even
          // when the URL bar is visible, which was clipping the dial pad
          // on the Import tab. Allow the content to scroll if it still
          // exceeds the available space (long press, large text, etc).
          minHeight: 'min(560px, 90dvh)',
          maxHeight: '95dvh',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold font-mono" style={{ color: colors.text.primary }}>Setup Wallet</h2>
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

        {/* Create tab — two-step single-keypad flow with animated swap */}
        {tab === 'create' && (
          <div className="flex-1 flex flex-col justify-center gap-5">
            <AnimatePresence mode="wait">
              <motion.p
                key={createStep}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="text-sm font-mono leading-relaxed text-center"
                style={{ color: colors.text.secondary }}
              >
                {createStep === 'enter'
                  ? 'Use your 6-digit sign-in PIN.'
                  : 'Re-enter to confirm.'}
              </motion.p>
            </AnimatePresence>

            <div style={{ maxWidth: 320, width: '100%', margin: '0 auto' }}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={createStep}
                  initial={{ opacity: 0, x: createStep === 'confirm' ? 24 : -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: createStep === 'confirm' ? -24 : 24 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  {createStep === 'enter' ? (
                    <AppPinPad
                      value={password}
                      onChange={setPassword}
                      onComplete={() => setCreateStep('confirm')}
                      length={PIN_LENGTH}
                      disabled={isLoading}
                    />
                  ) : (
                    <AppPinPad
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                      onComplete={(v) => {
                        if (v === password) handleCreate(v);
                        else {
                          setError('PINs do not match');
                          setErrorTick(t => t + 1);
                          setConfirmPassword('');
                          setPassword('');
                          setCreateStep('enter');
                        }
                      }}
                      length={PIN_LENGTH}
                      errorTick={errorTick}
                      disabled={isLoading}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {isLoading && (
              <div className="flex items-center justify-center gap-2 pt-2" style={{ color: colors.text.secondary }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-mono">Generating wallet…</span>
              </div>
            )}
          </div>
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

            <p className="text-sm font-mono text-center" style={{ color: colors.text.secondary }}>
              Set a 6-digit PIN to encrypt your wallet.
            </p>

            {/* PIN + Confirm PIN displays — tap to open the keypad for that
                field. PhonePe-style: dots show how many digits are entered;
                the eye toggle reveals the actual digits in both fields. */}
            <div className="flex flex-col gap-2">
              <PinFieldDisplay
                label="PIN"
                value={password}
                length={PIN_LENGTH}
                active={activePinField === 'pin'}
                show={showPin}
                onClick={() => setActivePinField('pin')}
              />
              <PinFieldDisplay
                label="Confirm PIN"
                value={confirmPassword}
                length={PIN_LENGTH}
                active={activePinField === 'confirm'}
                show={showPin}
                onClick={() => setActivePinField('confirm')}
                trailing={
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowPin((s) => !s); }}
                    className="p-1.5 rounded-md transition-colors hover:bg-white/[0.06]"
                    aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                  >
                    {showPin ? (
                      <EyeOff className="w-4 h-4" style={{ color: colors.text.tertiary }} />
                    ) : (
                      <Eye className="w-4 h-4" style={{ color: colors.text.tertiary }} />
                    )}
                  </button>
                }
              />
            </div>

            {/* Keypad — only appears after a field is tapped. Entering 6
                digits in PIN auto-advances to Confirm PIN; matching both
                triggers the import. Mismatched confirm shakes + clears. */}
            <AnimatePresence>
              {activePinField && (
                <motion.div
                  key={activePinField}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2 }}
                  style={{ maxWidth: 320, width: '100%', margin: '0 auto' }}
                >
                  <AppPinPad
                    value={activePinField === 'pin' ? password : confirmPassword}
                    onChange={(v) => {
                      if (activePinField === 'pin') setPassword(v);
                      else setConfirmPassword(v);
                    }}
                    onComplete={(v) => {
                      if (activePinField === 'pin') {
                        setActivePinField('confirm');
                      } else if (v === password) {
                        if (privateKeyInput.trim()) handleImport(v);
                        else setError('Paste your recovery phrase or private key above.');
                      } else {
                        setError('PINs do not match');
                        setErrorTick((t) => t + 1);
                        setConfirmPassword('');
                      }
                    }}
                    length={PIN_LENGTH}
                    errorTick={errorTick}
                    disabled={isLoading}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {isLoading && (
              <div className="flex items-center justify-center gap-2 pt-2" style={{ color: colors.text.secondary }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-mono">Importing wallet…</span>
              </div>
            )}
          </form>
        )}

        <p className="text-[9px] font-mono text-center" style={{ color: colors.text.tertiary }}>
          Your private key is encrypted with AES-256-GCM and stored locally. We never see it.
        </p>
      </motion.div>
    </div>
  );
}

interface PinFieldDisplayProps {
  label: string;
  value: string;
  length: number;
  active: boolean;
  show: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}

function PinFieldDisplay({
  label,
  value,
  length,
  active,
  show,
  onClick,
  trailing,
}: PinFieldDisplayProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl px-4 py-3 transition-colors"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: `1px solid ${active ? colors.accent.primary : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <p
            className="text-[10px] font-mono uppercase tracking-[0.15em] mb-1.5"
            style={{ color: colors.text.tertiary }}
          >
            {label}
          </p>
          <div className="flex items-center gap-2 h-6">
            {Array.from({ length }).map((_, i) => {
              const filled = i < value.length;
              if (show && filled) {
                return (
                  <span
                    key={i}
                    className="text-base font-mono tabular-nums"
                    style={{ color: '#fff', minWidth: 10, textAlign: 'center' }}
                  >
                    {value[i]}
                  </span>
                );
              }
              return (
                <span
                  key={i}
                  className="rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    background: filled ? '#fff' : 'rgba(255,255,255,0.18)',
                  }}
                />
              );
            })}
          </div>
        </div>
        {trailing}
      </div>
    </button>
  );
}
