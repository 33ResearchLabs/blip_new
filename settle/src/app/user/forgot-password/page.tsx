"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, CheckCircle2, Loader2, ShieldCheck, ArrowLeft } from "lucide-react";
import Link from "next/link";
import EmailFlowShell, {
  EmailFlowAccentPill,
} from "@/components/email-flow/EmailFlowShell";

// POSTs to /api/auth/user/forgot-password. Always shows the same "if an
// account exists, you'll get an email" copy so registered addresses
// don't leak via timing/messaging differences.
export default function UserForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!email) return;
    setIsSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/user/forgot-password", {
        method: "POST",
        credentials: "include",
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
    <EmailFlowShell
      heroSrc="/illustrations/reset-password-hero.png"
      eyebrow={submitted ? "Check your inbox" : "Reset your password"}
      headlineLead={submitted ? "Sent." : "A fresh key for"}
      headlineAccent={submitted ? "Check your inbox." : "your account."}
    >
      <AnimatePresence mode="wait">
        {submitted ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="space-y-5"
          >
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
              </div>
              <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Email sent</p>
              <p className="text-[12.5px] text-[#6e6e73] leading-relaxed">
                If an account with{" "}
                <span className="font-semibold text-[#1d1d1f]">{email}</span> exists,
                you'll receive a password reset link within a few minutes.
              </p>
            </div>

            <EmailFlowAccentPill
              icon={<ShieldCheck className="w-4 h-4" />}
              title="Single-use link, 15-min window"
              body="We never email your password — only a one-time link to set a new one."
            />

            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                setEmail("");
              }}
              className="block w-full text-center text-[12px] text-[#8a8a8e] hover:text-[#1d1d1f] transition-colors"
            >
              Didn't receive it? Try another email
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="space-y-4"
          >
            <p className="text-[13.5px] text-[#3a3a3c] leading-relaxed">
              Enter the email on your Blip account. We'll send a one-time link to set a
              new password.
            </p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-[12.5px] text-red-700">
                {error}
              </div>
            )}

            <div>
              <label className="text-[10px] text-[#6e6e73] uppercase tracking-[0.18em] font-semibold mb-2 block">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  maxLength={254}
                  className="w-full bg-black/[0.04] border border-black/[0.06] rounded-xl px-4 py-3 pl-10 text-[14px] text-[#1d1d1f] outline-none placeholder:text-[#a0a0a4] focus:ring-1 focus:ring-[#cc785c]/40 focus:border-[#cc785c]/40"
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                />
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a0a0a4]" />
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleSubmit}
              disabled={isSubmitting || !email}
              className="w-full py-3.5 rounded-full text-[14.5px] font-semibold text-white transition-transform hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0 inline-flex items-center justify-center gap-2"
              style={{
                background: "#0a0a0a",
                boxShadow: "0 8px 22px -10px rgba(10,10,10,0.45)",
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>Send reset link →</>
              )}
            </motion.button>

            <div className="text-center pt-1">
              <Link
                href="/waitlist/login"
                className="inline-flex items-center gap-1.5 text-[11.5px] text-[#8a8a8e] hover:text-[#1d1d1f] transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to sign in
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </EmailFlowShell>
  );
}
