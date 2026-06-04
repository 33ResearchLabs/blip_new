"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, CheckCircle2, AlertCircle, ShieldCheck, Mail } from "lucide-react";
import EmailFlowShell, {
  EmailFlowPrimaryCta,
  EmailFlowAccentPill,
} from "@/components/email-flow/EmailFlowShell";

type VerifyState = "verifying" | "success" | "already" | "error";

const ALLOWED_NEXT = new Set(["/market/login", "/waitlist/merchant-login"]);

function safeNext(raw: string | null): string {
  if (raw && ALLOWED_NEXT.has(raw)) return raw;
  return "/waitlist/merchant-login";
}

const AUTO_REDIRECT_MS = 2000;

function VerifyEmailBody({ nextHref }: { nextHref: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<VerifyState>("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (state !== "success" && state !== "already") return;
    const t = setTimeout(() => router.replace(nextHref), AUTO_REDIRECT_MS);
    return () => clearTimeout(t);
  }, [state, router, nextHref]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const token = searchParams.get("token");
    const id = searchParams.get("id");
    if (!token || !id) {
      setErrorMsg("This verification link is missing required information.");
      setState("error");
      return;
    }

    (async () => {
      try {
        const res = await fetch(
          `/api/auth/merchant/verify-email?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`,
          { method: "GET", credentials: "include" }
        );
        const data = await res.json().catch(() => ({} as any));
        if (res.ok && data?.success) {
          setState(data?.data?.alreadyVerified ? "already" : "success");
          return;
        }
        setErrorMsg(data?.error || "This verification link is invalid or has expired.");
        setState("error");
      } catch {
        setErrorMsg("Network error. Please try again.");
        setState("error");
      }
    })();
  }, [searchParams]);

  if (state === "verifying") {
    return (
      <div className="text-center py-4 space-y-4">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-full bg-black/[0.04] flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-black/55 animate-spin" />
          </div>
        </div>
        <div>
          <p className="text-[14.5px] font-semibold text-[#1d1d1f]">Verifying your email</p>
          <p className="text-[12.5px] text-[#6e6e73] mt-1">Hang tight — only takes a moment.</p>
        </div>
      </div>
    );
  }

  if (state === "success" || state === "already") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-5"
      >
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-white/[0.06] flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-[#f5f5f7]" />
            </div>
          </div>
          <p className="text-[15.5px] font-semibold text-[#1d1d1f]">
            {state === "already" ? "Already verified" : "Email verified"}
          </p>
          <p className="text-[12.5px] text-[#6e6e73] leading-relaxed">
            {state === "already"
              ? "Your merchant email is already confirmed. Sending you to sign in…"
              : "You're all set. Sending you to sign in…"}
          </p>
        </div>

        <EmailFlowAccentPill
          icon={<ShieldCheck className="w-4 h-4" />}
          title="Verified merchants get priority routing"
          body="Faster matching, fewer abandoned orders, founder-tier perks at launch."
        />

        <EmailFlowPrimaryCta href={nextHref}>Continue to sign in →</EmailFlowPrimaryCta>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-5"
    >
      <div className="text-center space-y-2">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
        </div>
        <p className="text-[15.5px] font-semibold text-[#1d1d1f]">Verification failed</p>
        <p className="text-[12.5px] text-[#6e6e73] leading-relaxed">{errorMsg}</p>
      </div>

      <EmailFlowAccentPill
        icon={<Mail className="w-4 h-4" />}
        title="Need a fresh link?"
        body="Links expire 24 hours after they're sent. Sign in and we'll send a new one."
      />

      <EmailFlowPrimaryCta href={nextHref}>Back to sign in →</EmailFlowPrimaryCta>
    </motion.div>
  );
}

function Inner() {
  const nextHref = safeNext(useSearchParams().get("next"));
  return (
    <EmailFlowShell
      heroSrc="/illustrations/verify-email-hero.png"
      eyebrow="Confirm your merchant email"
      headlineLead="One tap to"
      headlineAccent="go live."
    >
      <VerifyEmailBody nextHref={nextHref} />
    </EmailFlowShell>
  );
}

export default function MerchantVerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#FAF8F5]" />}>
      <Inner />
    </Suspense>
  );
}
