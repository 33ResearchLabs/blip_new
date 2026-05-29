'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Computer,
  Fingerprint,
  Key,
  Loader2,
  LogOut,
  ShieldCheck,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import { AppPinSetupModal } from './AppPinSetupModal';
import { AppLockPromptModal } from './AppLockPromptModal';
import { clearAppPin } from '@/lib/auth/appPin';
import { enrollBiometric, clearBiometricTrust } from '@/lib/auth/appBiometric';
import { useAppPinSettings } from '@/hooks/useAppPinSettings';
import { useAppLock } from '@/context/AppLockContext';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface AppLockSettingsCardProps {
  userId: string | null;
}

type LockModal =
  | { type: 'none' }
  | { type: 'set' }
  | { type: 'change-verify' }
  | { type: 'change-set' }
  | { type: 'remove-verify' }
  | { type: 'enable-bio-verify' }
  | { type: 'enable-bio-set-pin' };

type DetailSheet = 'trusted-devices' | 'change-password' | null;

/**
 * Security
 * ────────
 * Premium dark-theme security panel surfacing every user-controllable
 * lock: App Lock PIN, Biometric Unlock, Payment Methods, Trusted Devices,
 * Change Password.
 *
 * Each row is a single tap target with icon + title + status pill +
 * chevron. The destructive verbs (Remove) stay one tier in — surfaced
 * via the row's expand toolbar — so the resting state of the section
 * reads as scannable settings rather than a wall of buttons.
 */
export function AppLockSettingsCard({
  userId,
}: AppLockSettingsCardProps) {
  const settings = useAppPinSettings(userId);
  const { refreshPinStatus, lock: forceLock } = useAppLock();

  // ── App Lock PIN + Biometric state ────────────────────────────────────
  const [lockModal, setLockModal] = useState<LockModal>({ type: 'none' });
  const [enrollingBio, setEnrollingBio] = useState(false);
  const [bioError, setBioError] = useState('');

  // ── Inline expand state — which row's destructive toolbar is open ─────
  const [expanded, setExpanded] = useState<'app-lock' | null>(null);

  // ── Detail sheets for Trusted Devices / Change Password ──────────────
  const [sheet, setSheet] = useState<DetailSheet>(null);

  // Live device count drives the row's status pill.
  const [deviceCount, setDeviceCount] = useState<number | null>(null);

  const refreshDeviceCount = useCallback(async () => {
    if (!userId) {
      setDeviceCount(null);
      return;
    }
    try {
      const r = await fetchWithAuth('/api/auth/sessions');
      const j = await r.json();
      if (r.ok && j?.success && Array.isArray(j.data)) {
        setDeviceCount(j.data.length);
      }
    } catch {
      /* leave the previous count in place */
    }
  }, [userId]);

  useEffect(() => {
    void refreshDeviceCount();
  }, [refreshDeviceCount]);

  if (!userId) return null;

  const closeLock = () => setLockModal({ type: 'none' });

  const handleEnrollBiometric = async (pin: string) => {
    closeLock();
    setBioError('');
    setEnrollingBio(true);
    try {
      const res = await enrollBiometric(userId, pin);
      if (!res.ok) {
        setBioError(
          res.reason === 'no-prf'
            ? 'Your browser lacks the secure biometric extension. Use Chrome / Edge / Safari 17+.'
            : res.reason === 'cancelled'
              ? 'Biometric prompt cancelled.'
              : res.reason === 'unsupported'
                ? 'Biometric not supported on this device.'
                : 'Could not enable biometrics.',
        );
        return;
      }
      settings.refresh();
    } finally {
      setEnrollingBio(false);
    }
  };

  const handleRemoveAppPin = () => {
    clearAppPin(userId);
    clearBiometricTrust(userId);
    settings.refresh();
    refreshPinStatus();
    closeLock();
    setExpanded(null);
  };

  // ── Row status helpers ────────────────────────────────────────────────
  const lockStatus = settings.pinEnrolled
    ? { label: 'Enabled', tone: 'on' as const }
    : { label: 'Not set', tone: 'off' as const };

  const bioStatus = !settings.biometricSupported
    ? { label: 'Unavailable', tone: 'muted' as const }
    : settings.biometricEnrolled
      ? { label: 'Active', tone: 'on' as const }
      : { label: 'Off', tone: 'off' as const };

  const deviceStatus =
    deviceCount === null
      ? { label: 'Loading', tone: 'muted' as const }
      : deviceCount <= 1
        ? { label: '1 Device', tone: 'muted' as const }
        : { label: `${deviceCount} Devices`, tone: 'on' as const };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      <section
        aria-label="Security"
        className="rounded-[20px] overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,rgba(255,255,255,0.015)_100%)] border border-white/[0.07] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] divide-y divide-white/[0.05]"
      >
        {/* 1 — App Lock PIN ──────────────────────────────────────────── */}
        <SecurityRow
          icon={<ShieldCheck className="w-[15px] h-[15px]" />}
          title="App Lock PIN"
          subtitle={
            settings.pinEnrolled
              ? 'Locks the app when you switch away'
              : 'Add a 4-digit PIN to lock the app'
          }
          status={lockStatus}
          expanded={expanded === 'app-lock' && settings.pinEnrolled}
          onClick={() => {
            if (!settings.pinEnrolled) {
              setLockModal({ type: 'set' });
              return;
            }
            setExpanded((cur) => (cur === 'app-lock' ? null : 'app-lock'));
          }}
        >
          {settings.pinEnrolled && (
            <RowActions>
              <SecondaryButton onClick={() => setLockModal({ type: 'change-verify' })}>
                Change
              </SecondaryButton>
              <SecondaryButton onClick={forceLock}>Lock now</SecondaryButton>
              <DangerButton onClick={() => setLockModal({ type: 'remove-verify' })}>
                Remove
              </DangerButton>
            </RowActions>
          )}
        </SecurityRow>

        {/* 2 — Biometric Unlock ─────────────────────────────────────── */}
        <SecurityRow
          icon={
            enrollingBio ? (
              <Loader2 className="w-[15px] h-[15px] animate-spin" />
            ) : (
              <Fingerprint className="w-[15px] h-[15px]" />
            )
          }
          title="Biometric Unlock"
          subtitle={
            !settings.biometricSupported
              ? 'Not supported on this device'
              : settings.biometricEnrolled
                ? 'Face ID / Touch ID unlocks the app'
                : settings.pinEnrolled
                  ? 'Use biometrics instead of typing the PIN'
                  : 'Unlock with biometrics — PIN as fallback'
          }
          status={bioStatus}
          disabled={!settings.biometricSupported || enrollingBio}
          onClick={() => {
            if (!settings.biometricSupported || enrollingBio) return;
            setBioError('');
            if (settings.biometricEnrolled) {
              settings.disableBiometric();
              return;
            }
            setLockModal({
              type: settings.pinEnrolled ? 'enable-bio-verify' : 'enable-bio-set-pin',
            });
          }}
          errorText={bioError || undefined}
        />

        {/* 3 — Trusted Devices ──────────────────────────────────────── */}
        <SecurityRow
          icon={<Smartphone className="w-[15px] h-[15px]" />}
          title="Trusted Devices"
          subtitle="Review devices signed in to your account"
          status={deviceStatus}
          onClick={() => setSheet('trusted-devices')}
        />

        {/* 4 — Change Password ──────────────────────────────────────── */}
        <SecurityRow
          icon={<Key className="w-[15px] h-[15px]" />}
          title="Change Password"
          subtitle="Update your account password"
          onClick={() => setSheet('change-password')}
        />
      </section>

      {/* ── App Lock PIN modals ────────────────────────────────────── */}
      {lockModal.type === 'set' && (
        <AppPinSetupModal
          userId={userId}
          mode="set"
          onDone={() => {
            closeLock();
            settings.refresh();
            refreshPinStatus();
          }}
          onClose={closeLock}
        />
      )}

      {lockModal.type === 'enable-bio-set-pin' && (
        <AppPinSetupModal
          userId={userId}
          mode="set"
          onDone={(pin) => {
            settings.refresh();
            refreshPinStatus();
            handleEnrollBiometric(pin);
          }}
          onClose={closeLock}
        />
      )}

      {lockModal.type === 'change-verify' && (
        <AppLockPromptModal
          userId={userId}
          title="Verify current PIN"
          description="Enter your current PIN to change it."
          onSuccess={() => setLockModal({ type: 'change-set' })}
          onClose={closeLock}
          onLockout={() => {
            closeLock();
            settings.refresh();
            refreshPinStatus();
          }}
        />
      )}

      {lockModal.type === 'change-set' && (
        <AppPinSetupModal
          userId={userId}
          mode="change"
          onDone={() => {
            // Old wrapped PIN inside biometric trust no longer verifies
            // against the new verifier — drop it explicitly so the next
            // unlock doesn't auto-fail and burn a slot.
            clearBiometricTrust(userId);
            settings.refresh();
            refreshPinStatus();
            closeLock();
          }}
          onClose={closeLock}
        />
      )}

      {lockModal.type === 'remove-verify' && (
        <AppLockPromptModal
          userId={userId}
          title="Confirm PIN"
          description="Enter your PIN to remove it."
          onSuccess={handleRemoveAppPin}
          onClose={closeLock}
          onLockout={() => {
            closeLock();
            settings.refresh();
            refreshPinStatus();
          }}
        />
      )}

      {lockModal.type === 'enable-bio-verify' && (
        <AppLockPromptModal
          userId={userId}
          title="Confirm PIN"
          description="We'll wrap your PIN with a key only your biometric can unlock."
          onSuccess={handleEnrollBiometric}
          onClose={closeLock}
          onLockout={() => {
            closeLock();
            settings.refresh();
            refreshPinStatus();
          }}
        />
      )}

      {/* ── Detail sheets ──────────────────────────────────────────── */}
      {sheet === 'trusted-devices' && (
        <TrustedDevicesSheet
          onClose={() => {
            setSheet(null);
            void refreshDeviceCount();
          }}
        />
      )}

      {sheet === 'change-password' && (
        <ChangePasswordSheet
          userId={userId}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Presentational primitives
 * ────────────────────────────────────────────────────────────────── */

interface StatusPill {
  label: string;
  tone: 'on' | 'off' | 'muted';
}

interface SecurityRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  status?: StatusPill;
  loading?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  errorText?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}

function SecurityRow({
  icon,
  title,
  subtitle,
  status,
  loading,
  disabled,
  expanded,
  errorText,
  onClick,
  children,
}: SecurityRowProps) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`group w-full px-4 py-3.5 flex items-center gap-3 text-left transition-colors duration-150 ${
          disabled
            ? 'opacity-55 cursor-not-allowed'
            : 'active:bg-white/[0.04] hover:bg-white/[0.025]'
        }`}
      >
        <span className="w-9 h-9 shrink-0 rounded-[11px] flex items-center justify-center bg-white/[0.04] border border-white/[0.06] text-white/75 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
          {icon}
        </span>

        <span className="flex-1 min-w-0">
          <span className="block text-[14px] font-semibold tracking-[-0.01em] text-white/95 leading-tight">
            {title}
          </span>
          {subtitle && (
            <span className="mt-0.5 block text-[11.5px] font-medium text-white/45 leading-snug truncate">
              {subtitle}
            </span>
          )}
        </span>

        <span className="flex items-center gap-2 shrink-0">
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-white/35" />
          ) : status ? (
            <StatusBadge status={status} />
          ) : null}
          <ChevronRight
            className={`w-[15px] h-[15px] text-white/30 transition-transform duration-200 ${
              expanded ? 'rotate-90 text-white/55' : 'group-hover:text-white/55'
            }`}
          />
        </span>
      </button>

      {errorText && (
        <div className="px-4 pb-3 -mt-1 flex items-start gap-2 text-[11px] text-red-300/85">
          <AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>{errorText}</span>
        </div>
      )}

      {expanded && children && (
        <div className="px-4 pb-3.5 pl-[60px] -mt-1">{children}</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StatusPill }) {
  const toneCls =
    status.tone === 'on'
      ? 'text-black bg-white border-white'
      : status.tone === 'off'
        ? 'text-white/55 bg-white/[0.04] border-white/[0.06]'
        : 'text-white/45 bg-white/[0.03] border-white/[0.05]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full text-[10px] font-semibold tracking-[0.04em] border ${toneCls}`}
    >
      {status.tone === 'on' && (
        <span className="w-1 h-1 rounded-full bg-black" />
      )}
      {status.label}
    </span>
  );
}

function RowActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="h-8 px-3 rounded-[10px] bg-white/[0.05] border border-white/[0.08] text-[11.5px] font-semibold text-white/80 hover:bg-white/[0.08] active:scale-[0.97] transition"
    >
      {children}
    </button>
  );
}

function DangerButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="h-8 px-3 rounded-[10px] bg-white/[0.05] border border-white/[0.12] text-[11.5px] font-semibold text-white/80 hover:bg-white/[0.08] active:scale-[0.97] transition"
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Trusted Devices — lists active sessions, supports per-session revoke
 * and "Sign out everywhere" (revokes every session including the current
 * one, which logs the caller out via cleared refresh cookie).
 * ────────────────────────────────────────────────────────────────── */

interface DeviceSession {
  id: string;
  device: string | null;
  ip: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceName: string | null;
  deviceType: 'desktop' | 'mobile' | 'tablet' | string;
  lastUsed: string;
  createdAt: string;
  expiresAt: string;
}

function TrustedDevicesSheet({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signoutAllBusy, setSignoutAllBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const r = await fetchWithAuth('/api/auth/sessions');
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Failed to load devices');
      setSessions(j.data as DeviceSession[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load devices');
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (sessionId: string) => {
    setBusyId(sessionId);
    setError('');
    try {
      const r = await fetchWithAuth(
        `/api/auth/sessions?session_id=${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Failed to revoke device');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke device');
    } finally {
      setBusyId(null);
    }
  };

  const signOutEverywhere = async () => {
    if (signoutAllBusy) return;
    setSignoutAllBusy(true);
    setError('');
    try {
      const r = await fetchWithAuth('/api/auth/sessions', { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Failed to sign out everywhere');
      // Server clears the refresh cookie; bounce to the landing page so
      // the next request is unauthenticated.
      window.location.href = '/';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sign out everywhere');
      setSignoutAllBusy(false);
    }
  };

  return (
    <Sheet title="Trusted Devices" onClose={onClose}>
      {sessions === null ? (
        <div className="py-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-white/50" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-[12px] text-white/55 py-4">No active devices found.</p>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto pr-1 scrollbar-hide">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-start gap-3 rounded-[14px] px-3 py-3 bg-white/[0.03] border border-white/[0.06]"
            >
              <div className="w-9 h-9 rounded-[10px] bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0 text-white/75">
                {s.deviceType === 'desktop' ? (
                  <Computer className="w-[15px] h-[15px]" />
                ) : (
                  <Smartphone className="w-[15px] h-[15px]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-white/95 leading-tight truncate">
                  {labelDevice(s)}
                </p>
                <p className="mt-0.5 text-[11px] text-white/90 truncate">
                  {[s.browser, s.os].filter(Boolean).join(' • ') || 'Unknown'}
                </p>
                <p className="mt-1 text-[10px] tracking-[0.04em] uppercase font-semibold text-white/90">
                  {s.ip ? `IP ${s.ip} · ` : ''}Last used {relativeTime(s.lastUsed)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(s.id)}
                disabled={busyId === s.id}
                aria-label="Revoke device"
                className="h-8 px-2 rounded-[10px] bg-white/[0.05] border border-white/[0.12] text-white/80 disabled:opacity-50 active:scale-[0.97] transition flex items-center gap-1"
              >
                {busyId === s.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <InlineError text={error} />}

      <button
        type="button"
        onClick={signOutEverywhere}
        disabled={signoutAllBusy || sessions === null || sessions.length === 0}
        className="mt-4 w-full py-2.5 rounded-lg bg-white border border-white  text-black text-[13px] font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {signoutAllBusy ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <LogOut className="w-4 h-4" />
        )}
        Sign out everywhere
      </button>
    </Sheet>
  );
}

function labelDevice(s: DeviceSession): string {
  if (s.deviceName) return s.deviceName;
  if (s.device) return s.device;
  const t = s.deviceType ? s.deviceType[0].toUpperCase() + s.deviceType.slice(1) : 'Device';
  return `${t} session`;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'recently';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US');
}

/* ──────────────────────────────────────────────────────────────────────
 * Change Password — verifies current password, sets new one, server-side
 * revokes every OTHER active session so a stolen refresh cookie can't
 * keep working after the password change.
 * ────────────────────────────────────────────────────────────────── */

function ChangePasswordSheet({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError('');
    if (!current) {
      setError('Enter your current password.');
      return;
    }
    if (next.length < 8 || next.length > 24) {
      setError('New password must be 8–24 characters.');
      return;
    }
    if (next !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetchWithAuth('/api/auth/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_password',
          user_id: userId,
          current_password: current,
          new_password: next,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.success) {
        setError(j?.error || 'Could not change password.');
        return;
      }
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Sheet title="Password Changed" onClose={onClose}>
        <div className="flex items-start gap-3 mb-2">
          <div className="w-10 h-10 rounded-[12px] bg-white/[0.05] border border-white/[0.12] flex items-center justify-center shrink-0">
            <Key className="w-5 h-5 text-white/85" />
          </div>
          <p className="text-[13px] leading-relaxed text-white/80">
            Your password has been updated. Other devices have been signed out for
            your security — they&rsquo;ll need to sign in again with the new password.
          </p>
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 rounded-lg bg-accent text-accent-text text-[13px] font-semibold"
        >
          Done
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Change Password" onClose={onClose}>
      <p className="text-[12px] text-white/55 mb-3">
        Enter your current password, then choose a new one (8–24 characters).
      </p>

      <PasswordInput
        value={current}
        onChange={setCurrent}
        placeholder="Current password"
        autoFocus
      />
      <div className="h-2" />
      <PasswordInput value={next} onChange={setNext} placeholder="New password" />
      <div className="h-2" />
      <PasswordInput value={confirm} onChange={setConfirm} placeholder="Confirm new password" />

      {error && <InlineError text={error} />}

      <button
        onClick={submit}
        disabled={busy || !current || !next || !confirm}
        className="mt-4 w-full py-2.5 rounded-lg bg-accent text-accent-text text-[13px] font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Update password
      </button>
    </Sheet>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Shared small pieces (Sheet / PasswordInput / InlineError)
 * ────────────────────────────────────────────────────────────────── */

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
            <button
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-surface-hover"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-text-tertiary" />
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={24}
      autoFocus={autoFocus}
      placeholder={placeholder}
      className="w-full px-3 py-2.5 rounded-lg bg-white/[0.03] border border-white/10 text-[14px] text-white placeholder:text-white/30 outline-none focus:border-accent/40"
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
