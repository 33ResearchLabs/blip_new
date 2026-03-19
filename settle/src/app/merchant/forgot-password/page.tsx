"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Zap, ArrowLeft, Mail, CheckCircle, Loader2 } from "lucide-react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!email) return;
    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/auth/merchant/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#060606] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-orange-500/[0.03] rounded-full blur-[150px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-4">
            <Zap className="w-7 h-7 text-white fill-white" />
            <span className="text-[22px] leading-none">
              <span className="font-bold text-white">Blip</span>{" "}
              <span className="italic text-white/90">money</span>
            </span>
          </div>
          <h1 className="text-xl font-bold mb-2">Reset Password</h1>
          <p className="text-sm text-gray-500">
            {submitted
              ? "Check your email for a reset link"
              : "Enter your email to receive a reset link"}
          </p>
        </div>

        <div className="bg-white/[0.02] rounded-2xl border border-white/[0.04] p-6 space-y-4">
          {submitted ? (
            /* Success state */
            <div className="text-center py-4 space-y-4">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-emerald-400" />
                </div>
              </div>
              <div>
                <p className="text-sm text-white mb-1">Email sent!</p>
                <p className="text-xs text-gray-500">
                  If an account with <span className="text-white/70">{email}</span> exists,
                  you&apos;ll receive a password reset link within a few minutes.
                </p>
              </div>
              <p className="text-[11px] text-gray-600">
                Didn&apos;t receive it? Check your spam folder or try again.
              </p>
              <button
                onClick={() => { setSubmitted(false); setEmail(""); }}
                className="text-xs text-white/40 hover:text-white transition-colors"
              >
                Try another email
              </button>
            </div>
          ) : (
            /* Form state */
            <>
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-2 block">
                  Email Address
                </label>
                <div className="relative">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="merchant@email.com"
                    className="w-full bg-white/[0.04] rounded-xl px-4 py-3 pl-10 text-sm outline-none placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  />
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600" />
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleSubmit}
                disabled={isSubmitting || !email}
                className="w-full py-3 rounded-xl text-sm font-bold bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </motion.button>
            </>
          )}
        </div>

        {/* Back link */}
        <div className="mt-6 text-center">
          <Link
            href="/merchant"
            className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
