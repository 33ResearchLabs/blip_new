"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Lock,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import EmailFlowShell, {
  EmailFlowPrimaryCta,
  EmailFlowAccentPill,
} from "@/components/email-flow/EmailFlowShell";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get("token");
  const merchantId = searchParams.get("id");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Merchant min password length is stricter than user (8 vs 6).
  const isValid = password.length >= 8 && password === confirmPassword;

  if (!token || !merchantId) {
    return (
      <div className="space-y-5">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
          <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Invalid reset link</p>
          <p className="text-[12.5px] text-[#6e6e73] leading-relaxed">
            This link is invalid or has expired. Reset links are good for 15 minutes —
            please request a fresh one.
          </p>
        </div>
        <EmailFlowPrimaryCta href="/market/forgot-password">
          Request new link →
        </EmailFlowPrimaryCta>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/merchant/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, merchantId, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push("/waitlist/merchant-login"), 3000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22 }}
        className="space-y-5"
      >
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-[#f5f5f7]" />
            </div>
          </div>
          <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Password updated</p>
          <p className="text-[12.5px] text-[#6e6e73] leading-relaxed">
            Your merchant password is ready. Sending you to sign in…
          </p>
        </div>

        <EmailFlowAccentPill
          icon={<ShieldCheck className="w-4 h-4" />}
          title="Signed out everywhere for safety"
          body="Sign back in with your new password on every device that runs the merchant app."
        />

        <EmailFlowPrimaryCta href="/waitlist/merchant-login">
          Go to merchant sign in →
        </EmailFlowPrimaryCta>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="form"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-4"
    >
      <p className="text-[13.5px] text-[#3a3a3c] leading-relaxed">
        Choose a strong password — at least 8 characters.
      </p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-[12.5px] text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="text-[10px] text-[#6e6e73] uppercase tracking-[0.18em] font-semibold mb-2 block">
          New password
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0a0a4]" />
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            maxLength={24}
            className="w-full bg-black/[0.04] border border-black/[0.06] rounded-xl px-4 py-3 pl-10 pr-11 text-[14px] text-[#1d1d1f] outline-none placeholder:text-[#a0a0a4] focus:ring-1 focus:ring-[#cc785c]/40 focus:border-[#cc785c]/40"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a8e] hover:text-[#1d1d1f] transition-colors"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {password && password.length < 8 && (
          <p className="text-[11px] text-red-600 mt-1">Must be at least 8 characters</p>
        )}
      </div>

      <div>
        <label className="text-[10px] text-[#6e6e73] uppercase tracking-[0.18em] font-semibold mb-2 block">
          Confirm password
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0a0a4]" />
          <input
            type={showConfirm ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            maxLength={24}
            className="w-full bg-black/[0.04] border border-black/[0.06] rounded-xl px-4 py-3 pl-10 pr-11 text-[14px] text-[#1d1d1f] outline-none placeholder:text-[#a0a0a4] focus:ring-1 focus:ring-[#cc785c]/40 focus:border-[#cc785c]/40"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <button
            type="button"
            onClick={() => setShowConfirm(!showConfirm)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a8e] hover:text-[#1d1d1f] transition-colors"
          >
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {confirmPassword && password !== confirmPassword && (
          <p className="text-[11px] text-red-600 mt-1">Passwords don't match</p>
        )}
      </div>

      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={handleSubmit}
        disabled={isSubmitting || !isValid}
        className="w-full py-3.5 rounded-full text-[14.5px] font-semibold text-white transition-transform hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0 inline-flex items-center justify-center gap-2"
        style={{
          background: "#0a0a0a",
          boxShadow: "0 8px 22px -10px rgba(10,10,10,0.45)",
        }}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Updating…
          </>
        ) : (
          <>Reset password →</>
        )}
      </motion.button>

      <div className="text-center pt-1">
        <Link
          href="/waitlist/merchant-login"
          className="text-[11.5px] text-[#8a8a8e] hover:text-[#1d1d1f] transition-colors"
        >
          Back to sign in
        </Link>
      </div>
    </motion.div>
  );
}

export default function MerchantResetPasswordPage() {
  return (
    <EmailFlowShell
      heroSrc="/illustrations/reset-password-hero.png"
      eyebrow="Set a new password"
      headlineLead="A fresh key for"
      headlineAccent="your merchant account."
    >
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-black/40" />
          </div>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </EmailFlowShell>
  );
}
