"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Smartphone, Check, Loader2, AlertCircle } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

const inputClass =
  "w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/[0.12] focus:ring-1 focus:ring-white/20 transition-all";

const RESEND_COOLDOWN_SEC = 60;

interface PhoneVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fills the number field (the merchant's current phone, if any). */
  currentPhone?: string;
  /** Called with the verified number once verification succeeds. */
  onVerified: (phone: string) => void;
}

type Step = "enter-phone" | "enter-code" | "success";

export function PhoneVerificationModal({
  isOpen,
  onClose,
  currentPhone,
  onVerified,
}: PhoneVerificationModalProps) {
  const [step, setStep] = useState<Step>("enter-phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Reset to a clean state whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setStep("enter-phone");
      setPhone(currentPhone || "");
      setCode("");
      setError("");
      setIsBusy(false);
      setCooldown(0);
    }
  }, [isOpen, currentPhone]);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = useCallback(async () => {
    setError("");
    const trimmed = phone.trim();
    if (trimmed.length < 7) {
      setError("Enter a valid phone number");
      return;
    }
    setIsBusy(true);
    try {
      const res = await fetchWithAuth("/api/merchant/phone/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to send code. Try again.");
      }
      setStep("enter-code");
      setCode("");
      setCooldown(RESEND_COOLDOWN_SEC);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code.");
    } finally {
      setIsBusy(false);
    }
  }, [phone]);

  const verifyCode = useCallback(async () => {
    setError("");
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code");
      return;
    }
    setIsBusy(true);
    try {
      const res = await fetchWithAuth("/api/merchant/phone/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Verification failed.");
      }
      setStep("success");
      onVerified(data.data?.phone || phone.trim());
      // Brief success beat, then close.
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setIsBusy(false);
    }
  }, [code, phone, onVerified, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {/* z-[70] to sit above the settings page and any nested overlay. */}
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md bg-card-solid rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden"
        >
          {/* Ambient glow */}
          

          {/* Header */}
          <div className="relative px-6 pt-6 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-white/70 to-white/60 border border-white/[0.12] flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-[#f5f5f7]" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-white">
                    Verify your phone
                  </h2>
                  <p className="text-[11px] text-white/30 font-mono mt-0.5">
                    {step === "enter-phone"
                      ? "We'll text you a 6-digit code"
                      : step === "enter-code"
                        ? "Enter the code we sent"
                        : "Phone verified"}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-card rounded-xl transition-colors"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="relative p-5">
            <AnimatePresence mode="wait">
              {step === "enter-phone" && (
                <motion.div
                  key="enter-phone"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">
                      Mobile Number
                    </label>
                    <input
                      type="tel"
                      inputMode="tel"
                      autoFocus
                      value={phone}
                      onChange={(e) =>
                        setPhone(e.target.value.replace(/[^\d+\s]/g, ""))
                      }
                      onKeyDown={(e) => e.key === "Enter" && !isBusy && sendCode()}
                      placeholder="+971 50 123 4567"
                      maxLength={20}
                      className={inputClass}
                    />
                    <p className="text-[10px] text-white/25 mt-1.5">
                      Use international format, including your country code.
                    </p>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-[12px] text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {error}
                    </div>
                  )}

                  <button
                    onClick={sendCode}
                    disabled={isBusy}
                    className="w-full py-3 rounded-xl bg-[#f5f5f7] text-background font-bold text-sm hover:bg-white/[0.08] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                    Send code
                  </button>
                </motion.div>
              )}

              {step === "enter-code" && (
                <motion.div
                  key="enter-code"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-xs text-white/40 font-mono uppercase tracking-wider mb-2 block">
                      6-Digit Code
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, ""))
                      }
                      onKeyDown={(e) => e.key === "Enter" && !isBusy && verifyCode()}
                      placeholder="123456"
                      maxLength={6}
                      className={`${inputClass} font-mono tracking-[0.4em] text-center text-lg`}
                    />
                    <p className="text-[10px] text-white/25 mt-1.5">
                      Sent to {phone.trim()}.
                    </p>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-[12px] text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {error}
                    </div>
                  )}

                  <button
                    onClick={verifyCode}
                    disabled={isBusy}
                    className="w-full py-3 rounded-xl bg-[#f5f5f7] text-background font-bold text-sm hover:bg-white/[0.08] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                    Verify
                  </button>

                  <div className="flex items-center justify-between text-[11px]">
                    <button
                      onClick={() => {
                        setStep("enter-phone");
                        setError("");
                      }}
                      className="text-white/40 hover:text-white/70 transition-colors"
                    >
                      ← Change number
                    </button>
                    <button
                      onClick={sendCode}
                      disabled={isBusy || cooldown > 0}
                      className="text-[#f5f5f7] hover:opacity-80 transition-opacity disabled:text-white/25 disabled:cursor-not-allowed"
                    >
                      {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                    </button>
                  </div>
                </motion.div>
              )}

              {step === "success" && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center text-center py-6"
                >
                  <div className="w-14 h-14 rounded-full bg-white/[0.06] border border-white/[0.09] flex items-center justify-center mb-3">
                    <Check className="w-7 h-7 text-[#f5f5f7]" />
                  </div>
                  <p className="text-sm font-bold text-white">Phone verified</p>
                  <p className="text-[12px] text-white/40 mt-1">
                    {phone.trim()} is now verified.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
