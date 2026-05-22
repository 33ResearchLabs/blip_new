"use client";

// Ported from futureStick blip-protocol-ui/src/pages/Waitlist/Login.tsx.
//
// Same visual treatment (icon + label, eye toggle, white solid CTA button,
// inline red error pills, "Don't have an account?" footer link). Adapted to
// settle's auth: POSTs to /api/auth/{user,merchant} with action='login'.
// 2FA + recovery-code branches are deliberately omitted for the waitlist
// scope — those re-use the existing /api/2fa/verify-login flow on the main
// app once the user is activated.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, Loader2, AlertCircle } from "lucide-react";
import { rememberRole } from "@/lib/waitlist/roleCache";

interface LoginFormProps {
  role: "user" | "merchant";
}

export default function LoginForm({ role }: LoginFormProps) {
  const router = useRouter();
  const isMerchant = role === "merchant";
  const registerPath = isMerchant ? "/waitlist/merchant" : "/waitlist/user";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  // EMAIL_NOT_VERIFIED state: the API returned a 403 because the account
  // exists but hasn't clicked the verification link yet. The server has
  // already auto-resent a fresh email (with a 60s per-account throttle);
  // we surface a banner + countdown + manual resend so the user knows
  // what to do and isn't blocked silently.
  const [unverifiedActorId, setUnverifiedActorId] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [verificationCooldownUntil, setVerificationCooldownUntil] = useState<number | null>(null);
  const [verificationCooldownSeconds, setVerificationCooldownSeconds] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [resentNotice, setResentNotice] = useState(false);

  // Show "your session expired" banner when /waitlist/dashboard kicked the
  // user back here after a 401. Reads window.location.search inside an effect
  // to avoid the Suspense bailout that useSearchParams would trigger on a
  // statically-prerenderable page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowExpired(new URLSearchParams(window.location.search).get("expired") === "1");
  }, []);

  // Tick the resend-verification countdown. Computes from the absolute
  // deadline so a backgrounded tab catches up correctly on resume.
  useEffect(() => {
    if (verificationCooldownUntil == null) {
      setVerificationCooldownSeconds(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((verificationCooldownUntil - Date.now()) / 1000),
      );
      setVerificationCooldownSeconds(remaining);
      if (remaining === 0) setVerificationCooldownUntil(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [verificationCooldownUntil]);

  async function handleResend() {
    if (!unverifiedActorId) return;
    if (verificationCooldownUntil && verificationCooldownUntil > Date.now()) return;
    setIsResending(true);
    setResentNotice(false);
    // Optimistically arm the 60s timer — server enforces the same window.
    setVerificationCooldownUntil(Date.now() + 60_000);
    try {
      const endpoint = isMerchant
        ? "/api/auth/merchant/resend-verification"
        : "/api/auth/user/resend-verification";
      const idField = isMerchant ? "merchantId" : "userId";
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [idField]: unverifiedActorId }),
      });
      setResentNotice(true);
    } catch (err) {
      console.error("resend verification failed", err);
    } finally {
      setIsResending(false);
    }
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!email) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Invalid email format";
    if (!password) next.password = "Password is required";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);
    setUnverifiedActorId(null);
    setResentNotice(false);
    setIsLoading(true);
    try {
      const endpoint = isMerchant ? "/api/auth/merchant" : "/api/auth/user";
      // User login accepts `identifier` (email-or-username); merchant accepts `email`.
      // `waitlist: true` opts the actor into the waitlist on this login: the
      // server lazily runs setupWaitlistForActor (idempotent) so an existing
      // pre-waitlist account that signs in here picks up a referral_code and
      // the REGISTER bonus the first time, and is a no-op on subsequent
      // logins. `source` tags the dashboard analytics.
      const body = isMerchant
        ? { action: "login", email: email.trim(), password, waitlist: true, source: "waitlist_merchant_login" }
        : { action: "login", identifier: email.trim(), password, waitlist: true, source: "waitlist_user_login" };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        // The login route returns 403 + code='EMAIL_NOT_VERIFIED' (plus
        // userId/merchantId + cooldownSeconds) when the account exists
        // but the email hasn't been verified. Surface the dedicated
        // banner + countdown rather than the generic red error.
        if (data?.code === "EMAIL_NOT_VERIFIED") {
          const actorId = isMerchant ? data.merchantId : data.userId;
          setUnverifiedActorId(typeof actorId === "string" ? actorId : null);
          setUnverifiedEmail(email.trim());
          const cd = typeof data.cooldownSeconds === "number" ? data.cooldownSeconds : 60;
          setVerificationCooldownUntil(cd > 0 ? Date.now() + cd * 1000 : null);
          return;
        }
        setSubmitError(data.error ?? "Sign in failed");
        return;
      }
      // Stamp the actor type so a future 401 on the dashboard can redirect
      // back to the matching login page.
      rememberRole(role);
      router.push("/waitlist/dashboard");
    } catch (err) {
      console.error(err);
      setSubmitError("Network error — please try again");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex">
      <div className="w-full max-w-lg">
        {showExpired && (
          <div className="mb-5 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>Your session expired. Sign in again to continue.</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-2">
          {/* Email */}
          <div>
            <label
              htmlFor="login-email"
              className="block text-[13px] font-medium text-black/70 dark:text-white/70 mb-2"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-black/30 dark:text-white/30" />
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => validate()}
                maxLength={254}
                disabled={isLoading}
                className={`w-full pl-12 pr-4 py-3.5 bg-black/[0.02] dark:bg-white/[0.03] border ${
                  errors.email
                    ? "border-red-500/50 ring-2 ring-red-500/10"
                    : "border-black/10 dark:border-white/10"
                } rounded-xl text-black dark:text-white placeholder:text-black/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 focus:border-transparent transition-all duration-200`}
                placeholder="you@example.com"
              />
            </div>
            {errors.email && (
              <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">
                {errors.email}
              </p>
            )}
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label
                htmlFor="login-password"
                className="block text-[13px] font-medium text-black/70 dark:text-white/70"
              >
                Password
              </label>
              <Link
                href={
                  isMerchant ? "/merchant/forgot-password" : "/forgot-password"
                }
                className="text-xs text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors duration-200"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-black/30 dark:text-white/30" />
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => validate()}
                maxLength={100}
                disabled={isLoading}
                className={`w-full pl-12 pr-12 py-3.5 bg-black/[0.02] dark:bg-white/[0.03] border ${
                  errors.password
                    ? "border-red-500/50 ring-2 ring-red-500/10"
                    : "border-black/10 dark:border-white/10"
                } rounded-xl text-black dark:text-white placeholder:text-black/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 focus:border-transparent transition-all duration-200`}
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 transition-colors duration-200"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="w-[18px] h-[18px]" />
                ) : (
                  <Eye className="w-[18px] h-[18px]" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">
                {errors.password}
              </p>
            )}
          </div>

          {unverifiedActorId ? (
            <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium">Verify your email before signing in.</p>
                  <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/70">
                    We just sent a fresh verification link
                    {unverifiedEmail ? (
                      <> to <span className="font-semibold break-all">{unverifiedEmail}</span></>
                    ) : null}.
                    Click it from your inbox, then come back to sign in.
                  </p>
                </div>
              </div>
              {resentNotice && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                  Verification email sent. Check your inbox.
                </p>
              )}
              <button
                type="button"
                onClick={handleResend}
                disabled={isResending || verificationCooldownSeconds > 0}
                className="w-full py-2 rounded-lg text-[11px] font-semibold bg-amber-100 dark:bg-amber-500/15 border border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isResending ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                ) : verificationCooldownSeconds > 0 ? (
                  `Resend available in ${verificationCooldownSeconds}s`
                ) : (
                  "Resend verification email"
                )}
              </button>
            </div>
          ) : submitError ? (
            <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl p-3">
              {submitError}
            </div>
          ) : null}

          <div className="pt-1">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-white text-black border border-black/10 font-semibold rounded-xl transition-all duration-200 ease-out hover:scale-[1.01] hover:bg-gray-50 hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Signing In…
                </>
              ) : isMerchant ? (
                "Sign In as Merchant"
              ) : (
                "Sign In"
              )}
            </button>
          </div>
        </form>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-sm text-black/50 dark:text-white/40">
            Don&apos;t have an account?{" "}
            <Link
              href={registerPath}
              className="text-black dark:text-white font-semibold hover:underline underline-offset-4 transition-colors duration-200"
            >
              {isMerchant ? "Register as Merchant" : "Create one"}
            </Link>
          </p>
          {!isMerchant ? (
            <p className="text-xs text-black/40 dark:text-white/40 mt-3">
              Are you a business?{" "}
              <Link
                href="/waitlist/merchant-login"
                className="underline underline-offset-4 hover:text-black dark:hover:text-white"
              >
                Sign in as merchant
              </Link>
            </p>
          ) : (
            <p className="text-xs text-black/40 dark:text-white/40 mt-3">
              Looking for the user portal?{" "}
              <Link
                href="/waitlist/login"
                className="underline underline-offset-4 hover:text-black dark:hover:text-white"
              >
                Sign in as user
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
