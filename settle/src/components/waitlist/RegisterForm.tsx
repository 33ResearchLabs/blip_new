"use client";

// Email-only waitlist signup for both user and merchant roles. Username
// (user) and business_name (merchant) are derived from the email prefix
// on submit so the form mirrors the marketing screenshots (no extra
// fields). Posts to /api/auth/user or /api/auth/merchant with
// action='register' and waitlist=true so the existing waitlist setup
// flow runs (credits 200/2000 REGISTER points and assigns a referral
// code).

import { useEffect, useRef, useState } from "react";
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
  Check,
  Shield,
} from "lucide-react";
import { rememberRole } from "@/lib/waitlist/roleCache";
import { collectFingerprint, type FingerprintPayload } from "@/lib/threat/clientFingerprint";
import { SignupBehaviorCollector } from "@/lib/threat/clientTelemetry";

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
  const initialRef = params.get("ref") ?? "";

  // Shared fields — email, password, confirm, referral code only.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState(initialRef);

  // Username is required by the settle backend (validateUserUsername in
  // /api/auth/user) but we no longer surface it in the form — the design
  // is email-only, matching the merchant flow. We derive a username from
  // the email prefix on submit (same approach merchant uses for
  // business_name) so the schema is satisfied without an extra field.

  // UI state
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [robotChecked, setRobotChecked] = useState(false);

  // Pre-collect the device fingerprint on mount so it's ready by submit.
  // Failures are non-fatal — register proceeds with no fp on the body.
  const fpRef = useRef<FingerprintPayload | null>(null);
  useEffect(() => {
    let alive = true;
    void collectFingerprint().then(fp => { if (alive) fpRef.current = fp; });
    return () => { alive = false; };
  }, []);

  // Behavioural telemetry collector — attaches to the form root on mount,
  // captures fill time / mouse entropy / keystroke cadence / paste events /
  // tab-switches / scrolls. Detaches on unmount. Failures are non-fatal —
  // register proceeds with no telemetry on the body.
  const formRef = useRef<HTMLFormElement | null>(null);
  const telemetryRef = useRef<SignupBehaviorCollector | null>(null);
  useEffect(() => {
    if (!formRef.current) return;
    const collector = new SignupBehaviorCollector();
    const detach = collector.attach(formRef.current);
    telemetryRef.current = collector;
    return () => {
      detach();
      telemetryRef.current = null;
    };
  }, []);

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

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // Derive a backend-valid username from the email prefix. The settle
  // backend enforces length >= 3 and a charset of [a-z0-9_]; we lowercase,
  // strip invalid characters, then pad/fall back so very short prefixes
  // (e.g. "a@x.com") still satisfy the rule.
  function deriveUsername(rawEmail: string): string {
    const prefix = rawEmail.trim().split("@")[0] ?? "";
    const cleaned = prefix.toLowerCase().replace(/[^a-z0-9_]/g, "");
    const base = cleaned || "user";
    return (base.length < 3 ? `${base}user` : base).slice(0, 50);
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

      // If the fingerprint wasn't ready at mount, give it one last best-effort
      // chance here. Still non-fatal — register proceeds without it on failure.
      const fp = fpRef.current ?? await collectFingerprint().catch(() => null);
      // Snapshot the behavioural telemetry right before submit so fill_time
      // captures the full session. Returns null if the collector never
      // attached (SSR / unmount race).
      const behavior = telemetryRef.current?.snapshot() ?? null;

      const body: Record<string, unknown> = isMerchant
        ? {
            action: "register",
            email: email.trim(),
            password,
            business_name: defaultBusinessName,
            referral_code: referralCode.trim() || undefined,
            waitlist: true,
            source: "waitlist_merchant_form",
            device_fp: fp ?? undefined,
            behavior: behavior ?? undefined,
          }
        : {
            action: "register",
            username: deriveUsername(email),
            email: email.trim(),
            password,
            referral_code: referralCode.trim() || undefined,
            waitlist: true,
            source: "waitlist_user_form",
            device_fp: fp ?? undefined,
            behavior: behavior ?? undefined,
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
    <div>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
        {/* Email-only signup for both roles — username (user) /
            business_name (merchant) are derived from the email prefix
            on submit so the form mirrors the marketing screenshots. */}

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
              placeholder="Password (min 8 characters)"
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

        {/* Referral code — borderless caption-style field to match the
            marketing screenshots (no label, single placeholder). */}
        <div>
          <input
            id="reg-referral"
            type="text"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            maxLength={32}
            disabled={isLoading}
            className={`${inputClass(false)} uppercase`}
            placeholder="Referral code (optional)"
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
            className="waitlist-auth-submit w-full py-3 font-semibold rounded-xl transition-all duration-200 ease-out hover:opacity-90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />{" "}
                {isMerchant
                  ? "Joining Merchant Waitlist…"
                  : "Joining Waitlist…"}
              </>
            ) : (
              <>
                {isMerchant ? "Join Merchant Waitlist" : "Join Waitlist"}
                <span aria-hidden className="text-base">→</span>
              </>
            )}
          </button>
          <p className="mt-3 text-center text-[11.5px] text-black/70 dark:text-white/80 flex items-center justify-center gap-1.5">
            <Shield className="w-3 h-3" strokeWidth={2} />
            We respect your privacy. No spam, ever.
          </p>
        </div>
      </form>

      <p className="mt-4 text-[11.5px] text-black/50 dark:text-white/50 leading-relaxed text-center">
        By creating an account, you agree to our{" "}
        <Link
          href="/terms"
          className="underline underline-offset-2 hover:text-black/80 dark:hover:text-white/80 transition-colors duration-200"
        >
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link
          href="/privacy"
          className="underline underline-offset-2 hover:text-black/80 dark:hover:text-white/80 transition-colors duration-200"
        >
          Privacy Policy
        </Link>
      </p>
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
      className={`flex w-full items-center gap-3 px-4 py-2 rounded-md bg-white dark:bg-[#f9f9f9] border border-black/10 select-none cursor-pointer ${disabled ? "opacity-60 cursor-wait" : ""}`}
    >
      <div
        className={`w-5 h-5 rounded border ${checked ? "border-emerald-500 bg-white" : "border-black/30 bg-white"} flex items-center justify-center transition-colors shrink-0`}
      >
        {checked && <Check className="w-3.5 h-3.5 text-emerald-500" />}
      </div>
      <span className="text-sm text-black/80 flex-1">
        I&apos;m not a robot
      </span>
      <div className="flex flex-col items-center pl-2 border-l border-black/10 shrink-0">
        <svg
          width="24"
          height="24"
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
        <span className="text-[7px] font-bold text-black/40 mt-0.5">
          reCAPTCHA
        </span>
        <span className="text-[6px] text-black/30 leading-none">
          Privacy&nbsp;-&nbsp;Terms
        </span>
      </div>
    </div>
  );
}

function FieldWithIcon({
  id,
  icon,
  error,
  children,
}: {
  id: string;
  // `label` is unused now (we use placeholders only) but kept as an optional
  // prop so callers don't all need to change signatures at once.
  label?: string;
  icon: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  void id;
  return (
    <div>
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
