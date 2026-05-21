"use client";

// Ported from futureStick blip-protocol-ui/src/pages/Waitlist/Login.tsx.
//
// Same visual treatment (icon + label, eye toggle, white solid CTA button,
// inline red error pills, "Don't have an account?" footer link). Adapted to
// settle's auth: POSTs to /api/auth/{user,merchant} with action='login'.
// 2FA + recovery-code branches are deliberately omitted for the waitlist
// scope — those re-use the existing /api/2fa/verify-login flow on the main
// app once the user is activated.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, Loader2 } from "lucide-react";

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
    setIsLoading(true);
    try {
      const endpoint = isMerchant ? "/api/auth/merchant" : "/api/auth/user";
      // User login accepts `identifier` (email-or-username); merchant accepts `email`.
      const body = isMerchant
        ? { action: "login", email: email.trim(), password }
        : { action: "login", identifier: email.trim(), password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSubmitError(data.error ?? "Sign in failed");
        return;
      }
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

          {submitError && (
            <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl p-3">
              {submitError}
            </div>
          )}

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
