"use client";

// Ported from futureStick blip-protocol-ui/src/pages/Waitlist/Register.tsx.
//
// Two role variants:
//   - user: email + username + password (with strength meter) + confirm + referral_code
//   - merchant: same + business_name + business_category + expected_volume + country
//
// Posts to /api/auth/user or /api/auth/merchant with action='register' and
// waitlist=true so the existing waitlist setup flow runs (credits 200/2000
// REGISTER points and assigns a referral code).

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  Loader2,
  CheckCircle,
  XCircle,
  User as UserIcon,
  Check,
} from "lucide-react";
import { rememberRole } from "@/lib/waitlist/roleCache";

interface RegisterFormProps {
  role: "user" | "merchant";
}

function checkPasswordStrength(password: string) {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { checks, score };
}

export default function RegisterForm({ role }: RegisterFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const isMerchant = role === "merchant";
  const loginPath = isMerchant ? "/waitlist/merchant-login" : "/waitlist/login";
  const initialRef = params.get("ref") ?? "";

  // Shared fields — email, password, confirm, referral code only.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState(initialRef);

  // User-only — username is still required by the settle backend
  // (validateUserUsername in /api/auth/user). Merchant register derives a
  // default business_name from the email prefix on submit, so no extra
  // input is needed for merchants.
  const [username, setUsername] = useState("");

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [robotChecked, setRobotChecked] = useState(false);

  const strength = checkPasswordStrength(password);

  function validate(): boolean {
    const next: Record<string, string> = {};

    if (!email) next.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      next.email = "Invalid email format";

    if (!password) next.password = "Password is required";
    else if (password.length < 8)
      next.password = "Password must be at least 8 characters";
    else if (!strength.checks.uppercase)
      next.password = "Password must contain an uppercase letter";
    else if (!strength.checks.number)
      next.password = "Password must contain a number";

    if (!confirmPassword) next.confirmPassword = "Please confirm your password";
    else if (password !== confirmPassword)
      next.confirmPassword = "Passwords do not match";

    if (!isMerchant) {
      if (!username.trim()) next.username = "Username is required";
      else if (username.trim().length < 3)
        next.username = "Username must be at least 3 characters";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    if (!robotChecked) {
      setSubmitError("Please confirm you're not a robot");
      return;
    }
    setSubmitError(null);
    setIsLoading(true);

    try {
      const endpoint = isMerchant ? "/api/auth/merchant" : "/api/auth/user";

      // For merchant, the settle backend requires business_name (NOT NULL on
      // the merchants table). We derive a default from the email prefix so
      // the simplified form mirrors futureStick's Register.tsx while still
      // satisfying the schema. The user can edit it later from settings.
      const defaultBusinessName =
        email.trim().split("@")[0].slice(0, 100) || "Merchant";

      const body: Record<string, unknown> = isMerchant
        ? {
            action: "register",
            email: email.trim(),
            password,
            business_name: defaultBusinessName,
            referral_code: referralCode.trim() || undefined,
            waitlist: true,
            source: "waitlist_merchant_form",
          }
        : {
            action: "register",
            username: username.trim(),
            email: email.trim(),
            password,
            referral_code: referralCode.trim() || undefined,
            waitlist: true,
            source: "waitlist_user_form",
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSubmitError(data.error ?? "Registration failed");
        return;
      }

      // Stamp the actor type for the post-verification login flow.
      rememberRole(role);
      router.push(
        `/waitlist/check-email?email=${encodeURIComponent(email.trim())}&role=${role}`,
      );
    } catch (err) {
      console.error("register failed", err);
      setSubmitError("Network error — please try again");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* USER ONLY: Username — merchant signup is email-only (business_name
            is auto-derived from email prefix server-side). */}
        {!isMerchant && (
          <FieldWithIcon
            id="reg-username"
            label="Username"
            icon={<UserIcon className="w-[18px] h-[18px]" />}
            error={errors.username}
          >
            <input
              id="reg-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => validate()}
              maxLength={50}
              disabled={isLoading}
              className={inputClass(!!errors.username)}
              placeholder="trader_01"
            />
          </FieldWithIcon>
        )}

        {/* Email */}
        <FieldWithIcon
          id="reg-email"
          label="Email Address"
          icon={<Mail className="w-[18px] h-[18px]" />}
          error={errors.email}
        >
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => validate()}
            maxLength={254}
            disabled={isLoading}
            className={inputClass(!!errors.email)}
            placeholder="you@example.com"
          />
        </FieldWithIcon>

        {/* Password */}
        <div>
          <label
            htmlFor="reg-password"
            className="block text-[13px] font-medium text-black/70 dark:text-white/70 mb-2"
          >
            Password
          </label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-black/30 dark:text-white/30" />
            <input
              id="reg-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => validate()}
              maxLength={50}
              disabled={isLoading}
              className={inputClass(!!errors.password, "pr-12")}
              placeholder="Min 8 characters"
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

          {password && (
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ease-out ${
                      strength.score <= 2
                        ? "bg-red-400 w-1/3"
                        : strength.score === 3
                          ? "bg-amber-400 w-2/3"
                          : "bg-emerald-400 w-full"
                    }`}
                  />
                </div>
                <span
                  className={`text-[11px] font-medium ${
                    strength.score <= 2
                      ? "text-red-400"
                      : strength.score === 3
                        ? "text-amber-400"
                        : "text-emerald-400"
                  }`}
                >
                  {strength.score <= 2
                    ? "Weak"
                    : strength.score === 3
                      ? "Medium"
                      : "Strong"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                {[
                  { ok: strength.checks.length, label: "8+ characters" },
                  { ok: strength.checks.uppercase, label: "Uppercase" },
                  { ok: strength.checks.number, label: "Number" },
                  { ok: strength.checks.lowercase, label: "Lowercase" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    {item.ok ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-black/15 dark:text-white/15" />
                    )}
                    <span
                      className={`text-[11px] ${item.ok ? "text-emerald-500 dark:text-emerald-400" : "text-black/30 dark:text-white/30"}`}
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Confirm Password */}
        <div>
          <label
            htmlFor="reg-confirm"
            className="block text-[13px] font-medium text-black/70 dark:text-white/70 mb-2"
          >
            Confirm Password
          </label>
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-black/30 dark:text-white/30" />
            <input
              id="reg-confirm"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => validate()}
              maxLength={50}
              disabled={isLoading}
              className={inputClass(!!errors.confirmPassword, "pr-12")}
              placeholder="Confirm your password"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 transition-colors duration-200"
              aria-label={
                showConfirmPassword ? "Hide password" : "Show password"
              }
            >
              {showConfirmPassword ? (
                <EyeOff className="w-[18px] h-[18px]" />
              ) : (
                <Eye className="w-[18px] h-[18px]" />
              )}
            </button>
          </div>
          {errors.confirmPassword && (
            <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">
              {errors.confirmPassword}
            </p>
          )}
        </div>

        {/* Referral code */}
        <div>
          <label
            htmlFor="reg-referral"
            className="block text-[13px] font-medium text-black/70 dark:text-white/70 mb-2"
          >
            Referral Code{" "}
            <span className="text-black/30 dark:text-white/30 font-normal">
              (Optional)
            </span>
          </label>
          <input
            id="reg-referral"
            type="text"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            maxLength={32}
            disabled={isLoading}
            className={`${inputClass(false)} uppercase`}
            placeholder="BLIPXXXXXX"
          />
        </div>

        {/* reCAPTCHA-styled bot check — visual only (no Google integration
            wired up here). Mirrors the reCAPTCHA v2 widget shape so the
            page matches the futureStick screenshot exactly. */}
        <RecaptchaTile
          checked={robotChecked}
          onChange={setRobotChecked}
          disabled={isLoading}
        />

        {submitError && (
          <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-xl p-3">
            {submitError}
          </div>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-white text-black border border-black/10 font-semibold rounded-xl transition-all duration-200 ease-out hover:scale-[1.01] hover:bg-gray-50 hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />{" "}
                {isMerchant
                  ? "Joining Merchant Waitlist…"
                  : "Joining Waitlist…"}
              </>
            ) : isMerchant ? (
              "Join Merchant Waitlist"
            ) : (
              "Join User Waitlist"
            )}
          </button>
        </div>
      </form>

      {/* Footer links */}
      <div className="mt-4 text-center space-y-2">
        <p className="text-sm text-black/50 dark:text-white/40">
          Already have an account?{" "}
          <Link
            href={loginPath}
            className="text-black dark:text-white font-semibold hover:underline underline-offset-4 transition-colors duration-200"
          >
            {isMerchant ? "Merchant Sign In" : "Sign in"}
          </Link>
        </p>
        <p className="text-xs text-black/30 dark:text-white/30 leading-relaxed">
          By creating an account, you agree to our{" "}
          <Link
            href="/terms"
            className="underline underline-offset-2 hover:text-black/60 dark:hover:text-white/60 transition-colors duration-200"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="underline underline-offset-2 hover:text-black/60 dark:hover:text-white/60 transition-colors duration-200"
          >
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}

function inputClass(hasError: boolean, extra = ""): string {
  const errCls = hasError
    ? "border-red-500/50 ring-2 ring-red-500/10"
    : "border-black/10 dark:border-white/10";
  return `w-full pl-12 pr-4 py-2.5 bg-black/[0.02] dark:bg-white/[0.03] border ${errCls} rounded-xl text-black dark:text-white placeholder:text-black/30 dark:placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 focus:border-transparent transition-all duration-200 ${extra}`;
}

function RecaptchaTile({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex justify-start">
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onChange(!checked);
          }
        }}
        className={`inline-flex items-center gap-3 px-4 py-3 rounded-md bg-white dark:bg-[#f9f9f9] border border-black/10 select-none cursor-pointer ${disabled ? "opacity-60 cursor-wait" : ""}`}
        style={{ minWidth: 304 }}
      >
        <div
          className={`w-6 h-6 rounded border ${checked ? "border-emerald-500 bg-white" : "border-black/30 bg-white"} flex items-center justify-center transition-colors`}
        >
          {checked && <Check className="w-4 h-4 text-emerald-500" />}
        </div>
        <span className="text-sm text-black/80 flex-1">
          I&apos;m not a robot
        </span>
        <div className="flex flex-col items-center pl-2 border-l border-black/10">
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            aria-label="reCAPTCHA"
          >
            <circle
              cx="16"
              cy="16"
              r="11"
              fill="none"
              stroke="#4285F4"
              strokeWidth="2.5"
              strokeDasharray="55 100"
              transform="rotate(-90 16 16)"
            />
            <circle cx="16" cy="16" r="3.5" fill="#4285F4" />
          </svg>
          <span className="text-[8px] font-bold text-black/40 mt-0.5">
            reCAPTCHA
          </span>
          <span className="text-[7px] text-black/30 leading-none">
            Privacy&nbsp;-&nbsp;Terms
          </span>
        </div>
      </div>
    </div>
  );
}

function FieldWithIcon({
  id,
  label,
  icon,
  error,
  children,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium text-black/70 dark:text-white/70 mb-2"
      >
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30">
          {icon}
        </span>
        {children}
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
