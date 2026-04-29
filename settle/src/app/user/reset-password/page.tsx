"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Zap, Eye, EyeOff, CheckCircle, Loader2, AlertCircle } from "lucide-react";
import Link from "next/link";

// Reads ?token=xxx&id=xxx from the password-reset email link the
// /api/auth/user/forgot-password route emits, then POSTs the new password
// to /api/auth/user/reset-password. Min length matches the user register
// flow (6 chars).
function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get("token");
  const userId = searchParams.get("id");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const isValid = password.length >= 6 && password === confirmPassword;

  if (!token || !userId) {
    return (
      <div className="text-center py-6 space-y-4">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
        </div>
        <div>
          <p className="text-sm text-white mb-1">Invalid Reset Link</p>
          <p className="text-xs text-foreground/35">
            This link is invalid or has expired. Please request a new password reset.
          </p>
        </div>
        <Link
          href="/user/forgot-password"
          className="inline-block text-xs text-white/50 hover:text-foreground transition-colors"
        >
          Request new reset link
        </Link>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/auth/user/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, userId, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setSuccess(true);
      // Send the user back to the landing page where they can sign in
      // with the new password.
      setTimeout(() => router.push("/"), 3000);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="text-center py-6 space-y-4">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
        </div>
        <div>
          <p className="text-sm text-white mb-1">Password Reset!</p>
          <p className="text-xs text-foreground/35">
            Your password has been updated. Redirecting to sign in...
          </p>
        </div>
        <Link
          href="/"
          className="inline-block text-xs text-white/50 hover:text-foreground transition-colors"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div>
        <label className="text-xs text-foreground/35 uppercase tracking-wide mb-2 block">
          New Password
        </label>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 6 characters"
            maxLength={24}
            className="w-full bg-white/[0.04] rounded-xl px-4 py-3 pr-11 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/35 hover:text-foreground transition-colors"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {password && password.length < 6 && (
          <p className="text-[11px] text-red-400 mt-1">Must be at least 6 characters</p>
        )}
      </div>

      <div>
        <label className="text-xs text-foreground/35 uppercase tracking-wide mb-2 block">
          Confirm Password
        </label>
        <div className="relative">
          <input
            type={showConfirm ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            maxLength={24}
            className="w-full bg-white/[0.04] rounded-xl px-4 py-3 pr-11 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          />
          <button
            type="button"
            onClick={() => setShowConfirm(!showConfirm)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/35 hover:text-foreground transition-colors"
          >
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {confirmPassword && password !== confirmPassword && (
          <p className="text-[11px] text-red-400 mt-1">Passwords don&apos;t match</p>
        )}
      </div>

      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={handleSubmit}
        disabled={isSubmitting || !isValid}
        className="w-full py-3 rounded-xl text-sm font-bold bg-white text-background hover:bg-accent transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Resetting...
          </>
        ) : (
          "Reset Password"
        )}
      </motion.button>
    </>
  );
}

export default function UserResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/[0.03] rounded-full blur-[150px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <Zap className="w-7 h-7 text-white fill-white" />
            <span className="text-[22px] leading-none">
              <span className="font-bold text-white">Blip</span>{" "}
              <span className="italic text-white/90">money</span>
            </span>
          </div>
          <h1 className="text-xl font-bold mb-2">Set New Password</h1>
          <p className="text-sm text-foreground/35">Choose a strong password for your account</p>
        </div>

        <div className="bg-white/[0.02] rounded-2xl border border-white/[0.04] p-6 space-y-4">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-white/30" />
              </div>
            }
          >
            <ResetPasswordForm />
          </Suspense>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-xs text-white/30 hover:text-foreground/60 transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
