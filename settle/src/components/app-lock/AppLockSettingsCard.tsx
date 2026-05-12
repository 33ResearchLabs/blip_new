'use client';

import { useState } from 'react';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { AppPinSetupModal } from './AppPinSetupModal';
import { AppLockPromptModal } from './AppLockPromptModal';
import { clearAppPin } from '@/lib/auth/appPin';
import { enrollBiometric, clearBiometricTrust } from '@/lib/auth/appBiometric';
import { useAppPinSettings } from '@/hooks/useAppPinSettings';
import { useAppLock } from '@/context/AppLockContext';

interface AppLockSettingsCardProps {
  userId: string | null;
}

type Modal =
  | { type: 'none' }
  | { type: 'set' }                  // first-time PIN setup (PIN-only path)
  | { type: 'change-verify' }
  | { type: 'change-set' }
  | { type: 'remove-verify' }
  | { type: 'enable-bio-verify' }    // verify existing PIN, then enroll biometric
  | { type: 'enable-bio-set-pin' };  // no PIN yet — set PIN, then enroll biometric

/** Combined PIN + biometric settings card. The Biometric row is always
 *  visible when the device supports WebAuthn — users opting straight
 *  for biometric land in a combined flow that sets the App PIN first
 *  (since PIN is the spec-required fallback), then enrolls biometric.
 *  Every destructive verb goes through a fresh PIN re-verify — never
 *  trust the unlocked session for those. */
export function AppLockSettingsCard({ userId }: AppLockSettingsCardProps) {
  const settings = useAppPinSettings(userId);
  const { refreshPinStatus, lock: forceLock } = useAppLock();

  const [modal, setModal] = useState<Modal>({ type: 'none' });
  const [enrollingBio, setEnrollingBio] = useState(false);
  const [bioError, setBioError] = useState('');

  if (!userId) return null;

  const close = () => setModal({ type: 'none' });

  const handleEnrollBiometric = async (pin: string) => {
    close();
    setBioError('');
    setEnrollingBio(true);
    try {
      const res = await enrollBiometric(userId, pin);
      if (!res.ok) {
        setBioError(
          res.reason === 'no-prf'      ? 'Your browser lacks the secure biometric extension. Use Chrome / Edge / Safari 17+.'
          : res.reason === 'cancelled' ? 'Biometric prompt cancelled.'
          : res.reason === 'unsupported' ? 'Biometric not supported on this device.'
          :                                'Could not enable biometrics.'
        );
        return;
      }
      settings.refresh();
    } finally {
      setEnrollingBio(false);
    }
  };

  const handleRemovePin = () => {
    clearAppPin(userId);
    clearBiometricTrust(userId);
    settings.refresh();
    refreshPinStatus();
    close();
  };

  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.04]">
        <span className="text-[10px] font-bold text-white/40 font-mono uppercase tracking-wider">
          App Lock
        </span>
      </div>

      {/* App PIN row */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-white/[0.03]">
        <div className="flex items-center gap-3 min-w-0">
          <ShieldCheck className="w-4 h-4 text-white/60 shrink-0" />
          <div className="min-w-0">
            <div className="text-[12px] font-bold text-white/90 font-mono">App PIN</div>
            <div className="text-[10px] text-white/40 font-mono truncate">
              {settings.pinEnrolled
                ? '4-digit PIN locks the app'
                : 'Add a 4-digit PIN to lock the app'}
            </div>
          </div>
        </div>
        {settings.pinEnrolled ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setModal({ type: 'change-verify' })}
              className="px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/70 font-mono hover:bg-white/[0.08]"
            >
              Change
            </button>
            <button
              onClick={() => setModal({ type: 'remove-verify' })}
              className="px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/20 text-[10px] text-red-400 font-mono hover:bg-red-500/20"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            onClick={() => setModal({ type: 'set' })}
            className="px-2.5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-[10px] text-accent font-mono hover:bg-accent/25 shrink-0"
          >
            Set PIN
          </button>
        )}
      </div>

      {/* Biometric row — visible whenever the device supports a platform
          authenticator. If no PIN exists yet, "Enable" walks the user
          through PIN setup first (PIN is the spec-mandated fallback
          when biometric fails / changes / is unavailable). */}
      {settings.biometricSupported && (
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-white/[0.03]">
          <div className="flex items-center gap-3 min-w-0">
            <Fingerprint className="w-4 h-4 text-white/60 shrink-0" />
            <div className="min-w-0">
              <div className="text-[12px] font-bold text-white/90 font-mono">Biometrics</div>
              <div className="text-[10px] text-white/40 font-mono truncate">
                {settings.biometricEnrolled
                  ? 'Face ID / Touch ID unlocks the app'
                  : settings.pinEnrolled
                    ? 'Use biometrics instead of typing the PIN'
                    : 'Unlock with biometrics — PIN as fallback'}
              </div>
              {bioError && (
                <div className="mt-1 text-[10px] text-red-400 font-mono">{bioError}</div>
              )}
            </div>
          </div>
          {settings.biometricEnrolled ? (
            <button
              onClick={() => { settings.disableBiometric(); setBioError(''); }}
              disabled={enrollingBio}
              className="px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-[10px] text-white/60 font-mono hover:bg-white/[0.08] disabled:opacity-50 shrink-0"
            >
              Disable
            </button>
          ) : (
            <button
              onClick={() => {
                setBioError('');
                // Branch on whether a PIN already exists. With a PIN we
                // just re-verify it. Without one we run the combined
                // set-PIN-then-enroll-biometric flow so the user doesn't
                // need to discover the PIN row first.
                setModal({
                  type: settings.pinEnrolled ? 'enable-bio-verify' : 'enable-bio-set-pin',
                });
              }}
              disabled={enrollingBio}
              className="px-2.5 py-1.5 rounded-md bg-accent/15 border border-accent/30 text-[10px] text-accent font-mono hover:bg-accent/25 disabled:opacity-50 flex items-center gap-1 shrink-0"
            >
              {enrollingBio ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              Enable
            </button>
          )}
        </div>
      )}

      {/* Lock-now row */}
      {settings.pinEnrolled && (
        <button
          onClick={forceLock}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.03] transition-colors"
        >
          <ShieldCheck className="w-4 h-4 text-white/60" />
          <span className="text-[12px] text-white/80 font-mono">Lock app now</span>
        </button>
      )}

      {/* ---- Modals ---- */}

      {modal.type === 'set' && (
        <AppPinSetupModal
          userId={userId}
          mode="set"
          onDone={() => { close(); settings.refresh(); refreshPinStatus(); }}
          onClose={close}
        />
      )}

      {/* Combined flow when user taps "Enable Biometrics" before
          setting a PIN. Step 1: set PIN. The plaintext returned by
          onDone is then handed straight to biometric enrollment, so
          the user doesn't have to re-enter it. */}
      {modal.type === 'enable-bio-set-pin' && (
        <AppPinSetupModal
          userId={userId}
          mode="set"
          onDone={(pin) => {
            settings.refresh();
            refreshPinStatus();
            handleEnrollBiometric(pin);
          }}
          onClose={close}
        />
      )}

      {modal.type === 'change-verify' && (
        <AppLockPromptModal
          userId={userId}
          title="Verify current PIN"
          description="Enter your current PIN to change it."
          onSuccess={() => setModal({ type: 'change-set' })}
          onClose={close}
          onLockout={() => { close(); settings.refresh(); refreshPinStatus(); }}
        />
      )}

      {modal.type === 'change-set' && (
        <AppPinSetupModal
          userId={userId}
          mode="change"
          onDone={() => {
            // Old wrapped PIN inside biometric trust no longer
            // verifies against the new verifier — drop it explicitly
            // so the next unlock doesn't auto-fail and burn a slot.
            clearBiometricTrust(userId);
            settings.refresh();
            refreshPinStatus();
            close();
          }}
          onClose={close}
        />
      )}

      {modal.type === 'remove-verify' && (
        <AppLockPromptModal
          userId={userId}
          title="Confirm PIN"
          description="Enter your PIN to remove it."
          onSuccess={handleRemovePin}
          onClose={close}
          onLockout={() => { close(); settings.refresh(); refreshPinStatus(); }}
        />
      )}

      {modal.type === 'enable-bio-verify' && (
        <AppLockPromptModal
          userId={userId}
          title="Confirm PIN"
          description="We'll wrap your PIN with a key only your biometric can unlock."
          onSuccess={handleEnrollBiometric}
          onClose={close}
          onLockout={() => { close(); settings.refresh(); refreshPinStatus(); }}
        />
      )}
    </div>
  );
}
