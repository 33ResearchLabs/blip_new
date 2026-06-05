"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Phone, ShieldCheck, Loader2, AlertCircle, ChevronDown } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";

interface Props {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
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

export function PhoneVerificationSheet({ open, onClose, onVerified }: Props) {
  const [step, setStep] = useState<Step>("phone");
  const [country, setCountry] = useState(COUNTRY_CODES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
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
      recaptchaVerifierRef.current.clear();
      recaptchaVerifierRef.current = null;
    }
    recaptchaVerifierRef.current = new RecaptchaVerifier(authInstance, recaptchaRef.current!, {
      size: 'invisible',
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
      const authInstance = getFirebaseAuth();
      const verifier = await setupRecaptcha();
      confirmationRef.current = await signInWithPhoneNumber(authInstance, fullPhone, verifier);
      setStep("otp");
      startCooldown();
    } catch (err: any) {
      setError(err.message?.includes('invalid-phone') ? 'Invalid phone number.' : 'Failed to send OTP. Try again.');
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

      const res = await fetchWithAuth("/api/auth/phone/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firebase_token: token, phone: fullPhone }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "Verification failed"); setOtp(""); return; }
      setStep("success");
      setTimeout(() => { onVerified(); onClose(); }, 1500);
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
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-[28px] bg-[#111] border-t border-white/[0.08] px-5 pt-5 pb-10 shadow-2xl"
          >
            {/* Invisible recaptcha container */}
            <div ref={recaptchaRef} />

            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-5" />

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-[12px] flex items-center justify-center bg-white/[0.06] border border-white/[0.08]">
                  <Phone size={15} className="text-white/70" />
                </div>
                <div>
                  <p className="text-[16px] font-bold text-white/95 tracking-[-0.02em] leading-tight">
                    {step === "success" ? "Phone Verified" : "Verify Phone"}
                  </p>
                  <p className="text-[11px] text-white/40 mt-0.5">
                    {step === "phone" && "Required to place buy orders"}
                    {step === "otp" && `Code sent to ${fullPhone}`}
                    {step === "success" && "You're all set"}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.06] text-white/50 hover:text-white/80 transition-colors">
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
                      className="h-12 px-3 rounded-[14px] bg-white/[0.06] border border-white/[0.08] flex items-center gap-1.5 text-white/90 text-[14px] font-semibold whitespace-nowrap"
                    >
                      <span>{country.flag}</span>
                      <span>{country.code}</span>
                      <ChevronDown size={13} className="text-white/40" />
                    </button>
                    <AnimatePresence>
                      {showCountryPicker && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                          className="absolute top-14 left-0 z-10 w-36 rounded-[14px] bg-[#1a1a1a] border border-white/[0.08] shadow-xl overflow-hidden"
                        >
                          {COUNTRY_CODES.map((c) => (
                            <button key={c.code} onClick={() => { setCountry(c); setShowCountryPicker(false); }}
                              className="w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-white/[0.06] text-left">
                              <span className="text-[16px]">{c.flag}</span>
                              <span className="text-[13px] font-semibold text-white/80">{c.code}</span>
                              <span className="text-[11px] text-white/40">{c.label}</span>
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
                    className="flex-1 h-12 rounded-[14px] bg-white/[0.06] border border-white/[0.08] px-4 text-[16px] font-semibold text-white/95 placeholder:text-white/25 outline-none focus:border-white/20 focus:bg-white/[0.08] transition-colors"
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-red-400 text-[12px] font-medium">
                    <AlertCircle size={13} />{error}
                  </div>
                )}

                <motion.button whileTap={{ scale: 0.97 }} onClick={handleSendOtp}
                  disabled={busy || phone.replace(/\D/g, "").length < 7}
                  className="w-full h-12 rounded-[14px] bg-white text-black text-[14px] font-bold tracking-[-0.01em] flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : "Send OTP"}
                </motion.button>
              </div>
            )}

            {/* Step 2: OTP */}
            {step === "otp" && (
              <div className="space-y-3">
                <p className="text-[13px] text-white/50 text-center -mt-2 mb-1">Enter the 6-digit code</p>

                {/* Tappable OTP boxes with invisible input overlay */}
                <div
                  className="relative flex justify-center gap-3 mb-1 cursor-text"
                  onClick={() => otpInputRef.current?.focus()}
                >
                  {[...Array(6)].map((_, i) => (
                    <div key={i}
                      className={`w-11 h-14 rounded-[12px] border flex items-center justify-center text-[22px] font-bold transition-all ${
                        i === otp.length
                          ? "bg-white/[0.08] border-white/40 scale-105"
                          : otp[i]
                          ? "bg-white/[0.08] border-white/20 text-white"
                          : "bg-white/[0.04] border-white/[0.08]"
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
                  <div className="flex items-center gap-2 text-red-400 text-[12px] font-medium">
                    <AlertCircle size={13} />{error}
                  </div>
                )}

                <motion.button whileTap={{ scale: 0.97 }} onClick={handleVerifyOtp}
                  disabled={busy || otp.length !== 6}
                  className="w-full h-12 rounded-[14px] bg-white text-black text-[14px] font-bold tracking-[-0.01em] flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : "Verify"}
                </motion.button>

                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                    className="text-[12px] text-white/40 hover:text-white/60 transition-colors">
                    ← Change number
                  </button>
                  <button onClick={handleResend} disabled={resendCooldown > 0 || busy}
                    className="text-[12px] font-semibold text-white/60 hover:text-white/90 disabled:text-white/30 transition-colors">
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
                  className="w-16 h-16 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.1]"
                >
                  <ShieldCheck size={32} className="text-green-400" />
                </motion.div>
                <div className="text-center">
                  <p className="text-[18px] font-bold text-white/95 tracking-[-0.02em]">Verified!</p>
                  <p className="text-[13px] text-white/50 mt-1">Your phone is now verified</p>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
