'use client';

/**
 * PaymentPinRow
 * ─────────────
 * Surfaces the server-side Payment PIN in the user's Profile/YOU screen.
 *
 * Before this row existed, the Payment PIN had ZERO user-facing management
 * UI — it was only set as a side-effect of the first QR/UPI payment via
 * `PinSheet.tsx`, and once set it could only be verified, never seen or
 * reset. That produced "ghost PIN" scenarios where users had a PIN in the
 * DB they didn't remember setting, with no path out except a payment retry.
 *
 * This row mirrors the visual rhythm of AppLockSettingsCard so the two
 * PINs read as parallel settings:
 *
 *   APP LOCK
 *   ├─ App Lock PIN     locks the app on idle      [Set | Change | Remove]
 *   └─ Payment PIN      required for every Payment [Set | Change | Reset]
 *
 * State transitions:
 *   - Not set → tap "Set PIN" → opens PinSheet(setup) → POST /api/user/pin
 *   - Set     → "Change" → opens PinSheet(setup, requires current_password)
 *               "Reset"  → opens password modal → DELETE /api/user/pin
 *
 * The "Reset" path is the escape hatch the previous architecture lacked.
 */

import { useCallback, useEffect, useState } from 'react';
import { Wallet, Loader2, AlertCircle, X } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { PinSheet } from '@/components/user/PinSheet';

interface Props {
  /** Authenticated user id, used to keep the hook stable across actor switches. */
  userId: string | null;
}

type Modal = 'none' | 'set' | 'change' | 'reset';

export function PaymentPinRow({ userId }: Props) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>('none');

  const refresh = useCallback(async () => {
    if (!userId) {
      setHasPin(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchWithAuth('/api/user/pin');
      const j = await r.json();
      setHasPin(!!j?.data?.has_pin);
    } catch {
      setHasPin(null);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!userId) return null;

  const close = () => setModal('none');

  return (
    <>
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-white/[0.03]">
        <div className="flex items-center gap-3 min-w-0">
          <Wallet className="w-4 h-4 text-white/60 shrink-0" />
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-white/90 font-mono">Payment PIN</div>
            <div className="text-[10px] text-white/40 font-mono truncate">
              {loading
                ? 'Checking…'
                : hasPin
                  ? 'Required for every Payment'
                  : 'Set a 4-6 digit PIN to authorise Payments'}
            </div>
          </div>
        </div>
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-white/40" />
        ) : hasPin ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setModal('change')}
              className="px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/70 font-mono hover:bg-white/[0.08]"
            >
              Change
            </button>
            <button
              onClick={() => setModal('reset')}
              className="px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 font-mono hover:bg-red-500/20"
            >
              Reset
            </button>
          </div>
        ) : (
          <button
            onClick={() => setModal('set')}
            className="px-2.5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-[10px] text-accent font-mono hover:bg-accent/25 shrink-0"
          >
            Set PIN
          </button>
        )}
      </div>

      {/* Set first-time PIN — PinSheet's setup mode POSTs /api/user/pin
          without current_password (server allows first-time set freely). */}
      <PinSheet
        open={modal === 'set'}
        mode="setup"
        title="Set Payment PIN"
        subtitle="You'll be asked for this before every Payment."
        onClose={close}
        onSuccess={() => { close(); void refresh(); }}
      />

      {/* Change — opens password modal first, then PinSheet for the new
          PIN. The "set" pinsheet POSTs without current_password, so we
          instead use a thin custom flow that includes the password. */}
      {modal === 'change' && (
        <ChangePinModal
          onCancel={close}
          onDone={() => { close(); void refresh(); }}
        />
      )}

      {/* Reset — password-gated DELETE. Wipes the hash + lockout state. */}
      {modal === 'reset' && (
        <ResetPinModal
          onCancel={close}
          onDone={() => { close(); void refresh(); }}
        />
      )}
    </>
  );
}

// ─── ChangePinModal ────────────────────────────────────────────────────────
// Two-step: (1) password input, (2) PinSheet for new PIN. We use the
// password-confirmed step to package both into the same POST so the server
// validates current_password atomically with the new PIN write.

function ChangePinModal({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'password' | 'pin'>('password');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submitPin = async () => {
    if (pin !== confirmPin) { setError('PINs don’t match. Try again.'); return; }
    if (!/^[0-9]{4,6}$/.test(pin)) { setError('PIN must be 4-6 digits.'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await fetchWithAuth('/api/user/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, current_password: password }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.success) { onDone(); return; }
      setError(j?.error || 'Could not change PIN.');
      // Send the user back to password if it was rejected.
      if (r.status === 401) setStep('password');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onCancel} title="Change Payment PIN">
      {step === 'password' ? (
        <>
          <p className="text-[12px] text-white/60 mb-3">
            Enter your account password to continue.
          </p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={100}
            autoFocus
            placeholder="Account password"
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-[14px] text-white placeholder:text-white/30 outline-none focus:border-accent/40"
          />
          {error && <InlineError text={error} />}
          <button
            onClick={() => { if (password) { setError(''); setStep('pin'); } }}
            disabled={!password || busy}
            className="mt-3 w-full py-2.5 rounded-lg bg-accent text-accent-text text-[13px] font-semibold disabled:opacity-50"
          >
            Continue
          </button>
        </>
      ) : (
        <>
          <p className="text-[12px] text-white/60 mb-3">Enter your new Payment PIN (4-6 digits).</p>
          <NumericInput value={pin} onChange={setPin} placeholder="New PIN" />
          <div className="h-2" />
          <NumericInput value={confirmPin} onChange={setConfirmPin} placeholder="Re-enter PIN" />
          {error && <InlineError text={error} />}
          <button
            onClick={submitPin}
            disabled={busy || pin.length < 4 || confirmPin.length < 4}
            className="mt-3 w-full py-2.5 rounded-lg bg-accent text-accent-text text-[13px] font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save PIN
          </button>
        </>
      )}
    </Sheet>
  );
}

// ─── ResetPinModal ─────────────────────────────────────────────────────────

function ResetPinModal({
  onCancel,
  onDone,
}: {
  onCancel: () => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await fetchWithAuth('/api/user/pin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: password }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.success) { onDone(); return; }
      setError(j?.error || 'Could not reset PIN.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onCancel} title="Reset Payment PIN">
      <p className="text-[12px] text-white/60 mb-3">
        This clears your Payment PIN. You&rsquo;ll be asked to create a new one
        on your next Payment. Enter your account password to confirm.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        maxLength={100}
        autoFocus
        placeholder="Account password"
        className="w-full px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-[14px] text-white placeholder:text-white/30 outline-none focus:border-accent/40"
      />
      {error && <InlineError text={error} />}
      <button
        onClick={submit}
        disabled={!password || busy}
        className="mt-3 w-full py-2.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-[13px] font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Reset PIN
      </button>
    </Sheet>
  );
}

// ─── Small shared pieces ───────────────────────────────────────────────────

function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <div className="fixed inset-0 z-[130] bg-black/70" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[131] bg-surface-base text-text-primary rounded-t-3xl border-t border-border-medium shadow-2xl">
        <div className="mx-auto max-w-[420px] px-5 py-5 pb-[max(env(safe-area-inset-bottom,16px),16px)]">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-text-tertiary">
              {title}
            </p>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-surface-hover">
              <X className="w-4 h-4 text-text-tertiary" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

function NumericInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value}
      maxLength={6}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder={placeholder}
      className="w-full px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-[14px] text-white placeholder:text-white/30 outline-none focus:border-accent/40 font-mono tracking-[0.4em]"
    />
  );
}

function InlineError({ text }: { text: string }) {
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] bg-error-dim border border-error-border text-error w-full">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
