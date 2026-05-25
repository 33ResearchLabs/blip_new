"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  Zap,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Mail,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";

type VerifyState = "verifying" | "success" | "already" | "error";

// Allow-list for the `next` query param so a malicious link can't redirect
// the user off-site (open-redirect protection). Anything not on this list
// falls back to the user login PAGE — NOT `/`, which is the gated app
// root (landing there with no cookies trips fetchWithAuth's force-logout
// and appends a spurious ?reason=session_expired).
const ALLOWED_NEXT = new Set(["/login", "/waitlist/login"]);

function safeNext(raw: string | null): string {
  if (raw && ALLOWED_NEXT.has(raw)) return raw;
  // Default lands on the waitlist surface — the app is not yet live, so
  // anyone clicking through from a verify email should arrive at the
  // waitlist sign-in, not the gated app login.
  return "/waitlist/login";
}

// Delay before auto-redirecting on a successful verification — short
// enough that it doesn't feel like a wait, long enough that the success
// animation reads as confirmation rather than a flash.
const AUTO_REDIRECT_MS = 2000;

function VerifyEmailContent({ nextHref }: { nextHref: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<VerifyState>("verifying");
  const [errorMsg, setErrorMsg] = useState("");
  // Guard against React 18 StrictMode double-invocation in dev, which would
  // otherwise hit the API twice — the second call hits an already-used token
  // and flips the screen to "error" after the first call succeeded.
  const ran = useRef(false);

  // Auto-redirect to the matching login once the verify call resolves to a
  // success (fresh confirmation OR already-verified). Error state stays put
  // so the user can read the failure and act on it.
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
          `/api/auth/user/verify-email?token=${encodeURIComponent(
            token
          )}&id=${encodeURIComponent(id)}`,
          { method: "GET", credentials: "include" }
        );
        const data = await res.json().catch(() => ({} as any));

        if (res.ok && data?.success) {
          setState(data?.data?.alreadyVerified ? "already" : "success");
          return;
        }

        setErrorMsg(
          data?.error || "This verification link is invalid or has expired."
        );
        setState("error");
      } catch {
        setErrorMsg("Network error. Please try again.");
        setState("error");
      }
    })();
  }, [searchParams]);

  return (
    <div className="bg-white/[0.02] rounded-2xl border border-white/[0.04] p-6 space-y-5">
      {state === "verifying" && (
        <div className="text-center py-6 space-y-4">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-white/[0.04] flex items-center justify-center">
              <Loader2 className="w-7 h-7 text-white/70 animate-spin" />
            </div>
          </div>
          <div>
            <p className="text-sm text-white mb-1">Verifying your email</p>
            <p className="text-xs text-foreground/35">
              Hang tight — this only takes a second.
            </p>
          </div>
        </div>
      )}

      {(state === "success" || state === "already") && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="text-center py-4 space-y-5"
        >
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-base font-semibold text-white">
              {state === "already" ? "Already verified" : "Email verified"}
            </p>
            <p className="text-xs text-foreground/40 leading-relaxed">
              {state === "already"
                ? "Your email is already confirmed on this account. Redirecting you to sign in…"
                : "Your email has been verified successfully. Redirecting you to sign in…"}
            </p>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 flex items-center gap-3 text-left">
            <ShieldCheck className="w-4 h-4 text-emerald-400/80 shrink-0" />
            <p className="text-[11px] text-foreground/45 leading-relaxed">
              Verified emails help us protect your funds and recover access if
              you ever lose your device.
            </p>
          </div>

          <Link
            href={nextHref}
            className="block w-full py-3 rounded-xl text-sm font-bold bg-white text-background hover:bg-accent transition-colors"
          >
            Continue to sign in
          </Link>
        </motion.div>
      )}

      {state === "error" && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="text-center py-4 space-y-5"
        >
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-base font-semibold text-white">
              Verification failed
            </p>
            <p className="text-xs text-foreground/40 leading-relaxed">
              {errorMsg}
            </p>
          </div>

          <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 flex items-start gap-3 text-left">
            <Mail className="w-4 h-4 text-white/40 shrink-0 mt-0.5" />
            <p className="text-[11px] text-foreground/45 leading-relaxed">
              Verification links expire 24 hours after they are sent. Sign in
              and we&apos;ll send you a fresh link.
            </p>
          </div>

          <Link
            href={nextHref}
            className="block w-full py-3 rounded-xl text-sm font-bold bg-white text-background hover:bg-accent transition-colors"
          >
            Back to sign in
          </Link>
        </motion.div>
      )}
    </div>
  );
}

function UserVerifyEmailInner() {
  // Wrapper inside Suspense so the search-params hook doesn't bail the
  // whole page out of static rendering.
  const nextHref = safeNext(useSearchParams().get("next"));
  return (
    <>
      <VerifyEmailContent nextHref={nextHref} />
      <div className="mt-6 text-center">
        <Link
          href={nextHref}
          className="inline-flex items-center gap-1.5 text-xs text-white/30 hover:text-foreground/60 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </Link>
      </div>
    </>
  );
}

export default function UserVerifyEmailPage() {
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
          <h1 className="text-xl font-bold mb-2">Confirm your email</h1>
          <p className="text-sm text-foreground/35">
            We&apos;re checking your verification link.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="bg-white/[0.02] rounded-2xl border border-white/[0.04] p-6">
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-white/30" />
              </div>
            </div>
          }
        >
          <UserVerifyEmailInner />
        </Suspense>
      </div>
    </div>
  );
}
