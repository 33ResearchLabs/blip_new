"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Phone, ShieldCheck, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '';
// reCAPTCHA Enterprise (the custom fraud-scoring layer) is opt-in. When off
// (the default), Firebase Phone Auth manages its own reCAPTCHA and no Enterprise
// key is required — the most reliable path for OTP delivery. Set
// NEXT_PUBLIC_RECAPTCHA_ENTERPRISE=true once real Enterprise keys are configured.
const RECAPTCHA_ENTERPRISE_ENABLED = process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE === 'true';

function loadRecaptchaScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve();
    if ((window as any).grecaptcha?.enterprise) return resolve();
    const existing = document.getElementById('recaptcha-enterprise-script');
    if (existing) { existing.addEventListener('load', () => resolve()); return; }
    const script = document.createElement('script');
    script.id = 'recaptcha-enterprise-script';
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
}

async function getRecaptchaToken(action: string): Promise<string> {
  await loadRecaptchaScript();
  return new Promise((resolve, reject) => {
    (window as any).grecaptcha.enterprise.ready(async () => {
      try {
        const token = await (window as any).grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action });
        resolve(token);
      } catch (e) {
        reject(e);
      }
    });
  });
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Receives the verified E.164 number; arg is optional so existing callers can ignore it. */
  onVerified: (verifiedPhone?: string) => void;
  /** Backend route that exchanges the Firebase ID token for a verified flag. Defaults to the user route. */
  confirmEndpoint?: string;
  /** Subtitle shown under the title on the phone step. */
  reason?: string;
}

type Step = "phone" | "otp" | "success";

const COUNTRY_CODES = [
  { flag: "🇮🇳", code: "+91", label: "IN" },
  { flag: "🇦🇪", code: "+971", label: "AE" },
  { flag: "🇺🇸", code: "+1", label: "US" },
  { flag: "🇬🇧", code: "+44", label: "GB" },
];

function getFirebaseAuth() {
  const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  };
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getAuth(app);
}

export function PhoneVerificationSheet({
  open,
  onClose,
  onVerified,
  confirmEndpoint = "/api/auth/phone/confirm",
  reason = "Required to place buy orders",
}: Props) {
  const [step, setStep] = useState<Step>("phone");
  const [country, setCountry] = useState(COUNTRY_CODES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  // ≥1024px (Tailwind `lg`, matching the merchant settings breakpoint) → centered
  // desktop modal; below that → bottom sheet (user app + merchant mobile).
  const [isDesktop, setIsDesktop] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (open) {
      setStep("phone");
      setPhone("");
      setOtp("");
      setError("");
      setBusy(false);
      setResendCooldown(0);
      setShowCountryPicker(false);
    }
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, [open]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (step === "otp") setTimeout(() => otpInputRef.current?.focus(), 300);
  }, [step]);

  useEffect(() => {
    if (otp.length === 6 && step === "otp") handleVerifyOtp();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  function startCooldown() {
    setResendCooldown(30);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  const fullPhone = `${country.code}${phone.replace(/\D/g, "")}`;

  async function setupRecaptcha() {
    const authInstance = getFirebaseAuth();
    if (recaptchaVerifierRef.current) {
      try { recaptchaVerifierRef.current.clear(); } catch { /* ignore */ }
      recaptchaVerifierRef.current = null;
    }
    // Remove any previously appended container from body
    document.getElementById('blip-recaptcha-host')?.remove();
    // Append a fresh invisible div to document.body — completely outside React's
    // managed DOM so React reconciliation can never interfere with it.
    const container = document.createElement('div');
    container.id = 'blip-recaptcha-host';
    container.style.cssText = 'position:fixed;bottom:0;left:0;width:0;height:0;overflow:hidden;';
    document.body.appendChild(container);
    recaptchaVerifierRef.current = new RecaptchaVerifier(authInstance, container, {
      size: 'invisible',
      ...(RECAPTCHA_ENTERPRISE_ENABLED && RECAPTCHA_SITE_KEY ? { siteKey: RECAPTCHA_SITE_KEY } : {}),
      callback: () => {},
      'expired-callback': () => {
        recaptchaVerifierRef.current = null;
      },
    });
    await recaptchaVerifierRef.current.render();
    return recaptchaVerifierRef.current;
  }

  async function handleSendOtp() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) { setError("Enter a valid phone number"); return; }
    setBusy(true);
    setError("");
    try {
      // reCAPTCHA Enterprise assessment — opt-in, and fail open so reCAPTCHA
      // issues never block legitimate users. Skipped entirely unless enabled.
      if (RECAPTCHA_ENTERPRISE_ENABLED && RECAPTCHA_SITE_KEY) {
        try {
          const token = await getRecaptchaToken('PHONE_VERIFICATION');
          const res = await fetchWithAuth('/api/auth/phone/assess', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: fullPhone, recaptcha_token: token }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            if (res.status === 429) {
              setError(data.message ?? 'Request blocked. Please try again later.');
              setBusy(false);
              return;
            }
            // Non-429 errors: fail open and proceed
          }
        } catch {
          // Fail open — reCAPTCHA unavailable, proceed anyway
        }
      }

      const authInstance = getFirebaseAuth();
      const verifier = await setupRecaptcha();
      confirmationRef.current = await signInWithPhoneNumber(authInstance, fullPhone, verifier);
      setStep("otp");
      startCooldown();
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('invalid-phone-number') || msg.includes('invalid-phone')) {
        setError('Invalid phone number. Use format +91XXXXXXXXXX.');
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Please try again later.');
      } else {
        setError(`Failed to send OTP: ${msg || 'Unknown error'}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp() {
    if (!confirmationRef.current || otp.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      const result = await confirmationRef.current.confirm(otp);
      const token = await result.user.getIdToken();

      const res = await fetchWithAuth(confirmEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firebase_token: token, phone: fullPhone }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Verification failed"); setOtp(""); return; }
      setStep("success");
      setTimeout(() => { onVerified(fullPhone); onClose(); }, 1500);
    } catch (err: any) {
      setError(err.code === 'auth/invalid-verification-code' ? 'Wrong code. Try again.' : 'Verification failed.');
      setOtp("");
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setOtp("");
    setError("");
    await handleSendOtp();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={isDesktop ? { opacity: 0, scale: 0.96, x: "-50%", y: "-50%" } : { y: "100%" }}
            animate={isDesktop ? { opacity: 1, scale: 1, x: "-50%", y: "-50%" } : { y: 0 }}
            exit={isDesktop ? { opacity: 0, scale: 0.96, x: "-50%", y: "-50%" } : { y: "100%" }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className={
              isDesktop
                ? "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md rounded-[28px] bg-surface-raised border border-border-subtle px-5 pt-6 pb-7 shadow-2xl"
                : "fixed bottom-0 left-0 right-0 z-50 rounded-t-[28px] bg-surface-raised border-t border-border-subtle px-5 pt-5 pb-10 shadow-2xl"
            }
          >
            {/* Invisible recaptcha container */}
            <div ref={recaptchaRef} />

            {/* Drag handle — bottom-sheet affordance, mobile only */}
            {!isDesktop && (
              <div className="w-10 h-1 rounded-full bg-border-strong mx-auto mb-5" />
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-surface-active border border-border-subtle">
                  <Phone size={15} className="text-text-secondary" />
                </div>
                <div>
                  <p className="text-[16px] font-bold text-text-primary tracking-[-0.02em] leading-tight">
                    {step === "success" ? "Phone Verified" : "Verify Phone"}
                  </p>
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    {step === "phone" && reason}
                    {step === "otp" && `Code sent to ${fullPhone}`}
                    {step === "success" && "You're all set"}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-active text-text-tertiary hover:text-text-primary transition-colors">
                <X size={15} />
              </button>
            </div>

            {/* Step 1: Phone */}
            {step === "phone" && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative">
                    <button
                      onClick={() => setShowCountryPicker((v) => !v)}
                      className="h-12 px-3 rounded-[14px] bg-surface-active border border-border-subtle flex items-center gap-1.5 text-text-primary text-[14px] font-semibold whitespace-nowrap"
                    >
                      <span>{country.flag}</span>
                      <span>{country.code}</span>
                      <ChevronDown size={13} className="text-text-tertiary" />
                    </button>
                    <AnimatePresence>
                      {showCountryPicker && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                          className="absolute top-14 left-0 z-10 w-36 rounded-[14px] bg-surface-overlay border border-border-subtle shadow-xl overflow-hidden"
                        >
                          {COUNTRY_CODES.map((c) => (
                            <button key={c.code} onClick={() => { setCountry(c); setShowCountryPicker(false); }}
                              className="w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-surface-hover text-left">
                              <span className="text-[16px]">{c.flag}</span>
                              <span className="text-[13px] font-semibold text-text-secondary">{c.code}</span>
                              <span className="text-[11px] text-text-tertiary">{c.label}</span>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <input
                    type="tel" inputMode="numeric" placeholder="9876543210" maxLength={12}
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "")); setError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                    className="flex-1 h-12 rounded-[14px] bg-surface-active border border-border-subtle px-4 text-[16px] font-semibold text-text-primary placeholder:text-text-tertiary outline-none focus:border-border-strong focus:bg-surface-hover transition-colors"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-error text-[12px] font-medium">
                    <AlertCircle size={13} />{error}
                  </div>
                )}

                <motion.button whileTap={{ scale: 0.97 }} onClick={handleSendOtp}
                  disabled={busy || phone.replace(/\D/g, "").length < 7}
                  className="w-full h-12 rounded-[14px] bg-foreground text-background text-[14px] font-bold tracking-[-0.01em] flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : "Send OTP"}
                </motion.button>
              </div>
            )}

            {/* Step 2: OTP */}
            {step === "otp" && (
              <div className="space-y-3">
                <p className="text-[13px] text-text-secondary text-center -mt-2 mb-1">Enter the 6-digit code</p>

                {/* Tappable OTP boxes with invisible input overlay */}
                <div
                  className="relative flex justify-center gap-3 mb-1 cursor-text"
                  onClick={() => otpInputRef.current?.focus()}
                >
                  {[...Array(6)].map((_, i) => (
                    <div key={i}
                      className={`w-11 h-14 rounded-[12px] border flex items-center justify-center text-[22px] font-bold transition-all text-text-primary ${
                        i === otp.length
                          ? "bg-surface-active border-border-strong scale-105"
                          : otp[i]
                          ? "bg-surface-active border-border-medium"
                          : "bg-surface-hover border-border-subtle"
                      }`}>
                      {otp[i] ? "•" : ""}
                    </div>
                  ))}
                  <input
                    ref={otpInputRef}
                    type="text" inputMode="numeric" maxLength={6}
                    value={otp}
                    onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); setError(""); }}
                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    aria-label="OTP code"
                    autoComplete="one-time-code"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-error text-[12px] font-medium">
                    <AlertCircle size={13} />{error}
                  </div>
                )}

                <motion.button whileTap={{ scale: 0.97 }} onClick={handleVerifyOtp}
                  disabled={busy || otp.length !== 6}
                  className="w-full h-12 rounded-[14px] bg-foreground text-background text-[14px] font-bold tracking-[-0.01em] flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : "Verify"}
                </motion.button>

                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                    className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors">
                    ← Change number
                  </button>
                  <button onClick={handleResend} disabled={resendCooldown > 0 || busy}
                    className="text-[12px] font-semibold text-text-secondary hover:text-text-primary disabled:text-text-quaternary transition-colors">
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend OTP"}
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Success */}
            {step === "success" && (
              <div className="flex flex-col items-center py-6 gap-4">
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", damping: 14 }}
                  className="w-16 h-16 rounded-full flex items-center justify-center bg-surface-active border border-border-subtle"
                >
                  <ShieldCheck size={32} className="text-success" />
                </motion.div>
                <div className="text-center">
                  <p className="text-[18px] font-bold text-text-primary tracking-[-0.02em]">Verified!</p>
                  <p className="text-[13px] text-text-secondary mt-1">Your phone is now verified</p>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
