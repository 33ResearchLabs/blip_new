"use client";

// Pixel-port of the futureStick register form body
// (/Users/zzz/Projects/Blip-money-futureStick/blip-protocol-ui/src/pages/Waitlist/Register.tsx,
// the <form> through privacy-line section, lines ~370–660).
//
// All chrome above and below the form (title, segmented control,
// altMode link, terms text) is owned by WaitlistAuthShell so this
// file stays focused on the form body itself.
//
// Backend wiring is preserved from the previous version:
//   - POSTs to /api/auth/user or /api/auth/merchant with action=register
//     and waitlist=true so setupWaitlistForActor still runs.
//   - Username for users: derived from the email prefix on submit (the
//     UI input is removed to match futureStick, but the settle backend
//     still requires a username via validateUserUsername — see
//     /api/auth/user/route.ts).
//   - Device fingerprint + signup behaviour telemetry are still
//     collected for the threat pipeline.

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  Eye,
  EyeOff,
  Mail,
  Lock,
  Loader2,
  CheckCircle,
  XCircle,
  Shield,
  Check,
} from "lucide-react";
import { rememberRole } from "@/lib/waitlist/roleCache";
import { collectFingerprint, type FingerprintPayload } from "@/lib/threat/clientFingerprint";
import { SignupBehaviorCollector } from "@/lib/threat/clientTelemetry";
import GoogleSignInButton from "@/components/auth/GoogleSignInButton";
import OrDivider from "@/components/auth/OrDivider";

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

function deriveUsernameFromEmail(email: string): string {
  // Settle backend's validateUserUsername requires 3–30 chars,
  // alphanumeric + underscore. The email prefix usually fits; sanitise
  // anything else by stripping non-allowed chars and padding to 3.
  const raw = email.trim().split("@")[0] || "user";
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 30);
  return cleaned.length >= 3 ? cleaned : `${cleaned}_user`.slice(0, 30);
}

export default function RegisterForm({ role }: RegisterFormProps) {
  const router = useRouter();
  const params = useSearchParams();
  const isMerchant = role === "merchant";
  const initialRef = params.get("ref") ?? "";

  // Form state — matches futureStick Register.tsx formData shape.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referralCode, setReferralCode] = useState(initialRef);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [robotChecked, setRobotChecked] = useState(false);

  // Threat-pipeline plumbing — preserved from the previous implementation.
  const fpRef = useRef<FingerprintPayload | null>(null);
  useEffect(() => {
    let alive = true;
    void collectFingerprint().then((fp) => { if (alive) fpRef.current = fp; });
    return () => { alive = false; };
  }, []);

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
      const trimmedEmail = email.trim();
      const defaultBusinessName =
        trimmedEmail.split("@")[0].slice(0, 100) || "Merchant";

      const fp = fpRef.current ?? (await collectFingerprint().catch(() => null));
      const behavior = telemetryRef.current?.snapshot() ?? null;

      const body: Record<string, unknown> = isMerchant
        ? {
            action: "register",
            email: trimmedEmail,
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
            // Derived from email so the futureStick-style email-only UI
            // still satisfies the settle backend's validateUserUsername.
            username: deriveUsernameFromEmail(trimmedEmail),
            email: trimmedEmail,
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

      rememberRole(role);
      router.push(
        `/waitlist/check-email?email=${encodeURIComponent(trimmedEmail)}&role=${role}`,
      );
    } catch (err) {
      console.error("register failed", err);
      setSubmitError("Network error — please try again");
    } finally {
      setIsLoading(false);
    }
  }

  // futureStick uses bg-[#F2F2F5] for the input fill, transparent
  // border, and a focus ring that's 12% of the foreground. Keeping
  // those literal values here so the inputs look identical to the
  // production page.
  function inputCls(hasError: boolean, extra = ""): string {
    return [
      "w-full py-3.5 rounded-xl",
      "bg-[#F2F2F5] dark:bg-white/[0.06]",
      "text-black dark:text-white",
      "placeholder:text-[#6e6e73] dark:placeholder:text-white/55",
      "focus:outline-none focus:ring-2 focus:bg-white dark:focus:bg-white/[0.10]",
      "focus:ring-black/[0.12] dark:focus:ring-white/20",
      "border",
      hasError
        ? "border-red-500/50 ring-2 ring-red-500/10"
        : "border-transparent",
      "transition-all duration-200",
      extra,
    ].join(" ");
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      {/* Email */}
      <div>
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-black/30 dark:text-white/70" />
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => validate()}
            maxLength={254}
            disabled={isLoading}
            className={inputCls(!!errors.email, "pl-11 pr-4")}
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
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-black/30 dark:text-white/70" />
          <input
            id="reg-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => validate()}
            onFocus={() => setShowRequirements(true)}
            maxLength={50}
            disabled={isLoading}
            className={inputCls(!!errors.password, "pl-11 pr-11")}
            placeholder="Min 8 characters"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/70 hover:text-black/60 dark:hover:text-white transition-colors duration-200"
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
          <div className="mt-3 space-y-2.5">
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

            <div>
              <button
                type="button"
                onClick={() => setShowRequirements((v) => !v)}
                aria-expanded={showRequirements}
                className="w-full flex items-center justify-between gap-2 text-[11px] font-medium text-black/50 dark:text-white/50 hover:text-black/70 dark:hover:text-white/70 transition-colors duration-200"
              >
                <span>
                  Requirements ({strength.score}/
                  {Object.keys(strength.checks).length})
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${
                    showRequirements ? "rotate-180" : ""
                  }`}
                />
              </button>
              <div
                className={`grid transition-all duration-200 ease-out ${
                  showRequirements
                    ? "grid-rows-[1fr] opacity-100 mt-2"
                    : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
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
                          className={`text-[11px] ${
                            item.ok
                              ? "text-emerald-500 dark:text-emerald-400"
                              : "text-black/30 dark:text-white/30"
                          }`}
                        >
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Password */}
      <div>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-black/30 dark:text-white/70" />
          <input
            id="reg-confirm"
            type={showConfirmPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onBlur={() => validate()}
            maxLength={50}
            disabled={isLoading}
            className={inputCls(!!errors.confirmPassword, "pl-11 pr-11")}
            placeholder="Confirm your password"
          />
          <button
            type="button"
            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/70 hover:text-black/60 dark:hover:text-white transition-colors duration-200"
            aria-label={showConfirmPassword ? "Hide password" : "Show password"}
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

      {/* Referral code — borderless caption, no icon, no separate label */}
      <div>
        <input
          id="reg-referral"
          type="text"
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value)}
          maxLength={32}
          disabled={isLoading}
          className="w-full px-4 py-3.5 bg-[#F2F2F5] dark:bg-white/[0.06] border-0 rounded-xl text-black dark:text-white placeholder:text-[#6e6e73] dark:placeholder:text-white/55 focus:outline-none focus:ring-2 focus:ring-black/[0.12] dark:focus:ring-white/20 focus:bg-white dark:focus:bg-white/[0.10] transition-all duration-200"
          placeholder="Referral code (optional)"
        />
      </div>

      {/* reCAPTCHA-styled bot check — visual only, no Google integration */}
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

      {/* Submit button + privacy line — copied from futureStick
          Register.tsx 633–657. Note rounded-FULL (not xl), font-bold,
          text-[15px], and inline → glyph.

          Inline color styles bypass the globals.css `[class*="bg-black"]`
          / `[class*="text-white"]` substring rewrites that would otherwise
          repaint the button to the page background + dark text in light
          theme — producing a "white pill with black text" instead of the
          intended solid-black CTA. We use hex literals (#000000/#ffffff)
          here for the same reason `accentText` was switched to
          `text-[#ffffff]` in WaitlistThemeContext. */}
      <div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 font-bold text-[15px] tracking-tight rounded-full shadow-[0_10px_28px_-12px_rgba(0,0,0,0.55)] hover:-translate-y-[1px] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
          style={{
            background: '#000000',
            color: '#ffffff',
          }}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              {isMerchant ? "Joining Merchant Waitlist..." : "Joining Waitlist..."}
            </>
          ) : (
            <>
              {isMerchant ? "Join Merchant Waitlist" : "Join Waitlist"}
              <span aria-hidden className="text-base">→</span>
            </>
          )}
        </button>
        <p className="mt-3 text-center text-[11.5px] text-[#1d1d1f] dark:text-white/80 flex items-center justify-center gap-1.5">
          <Shield className="w-3 h-3" strokeWidth={2} />
          We respect your privacy. No spam, ever.
        </p>
      </div>

      <div className="pt-1 space-y-2">
        <OrDivider />
        <GoogleSignInButton
          role={role}
          source={isMerchant ? "waitlist_merchant_register_google" : "waitlist_user_register_google"}
          waitlist
          referralCode={referralCode.trim() || undefined}
          theme="light"
          onSuccess={() => {
            rememberRole(role);
            router.push("/waitlist/dashboard");
          }}
          onError={(msg) => setSubmitError(msg)}
          disabled={isLoading}
        />
      </div>
    </form>
  );
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
      className={`flex w-full items-center gap-3 px-4 py-2 rounded-xl bg-[#F2F2F5] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 select-none cursor-pointer ${disabled ? "opacity-60 cursor-wait" : ""}`}
    >
      <div
        className={`w-5 h-5 rounded border ${checked ? "border-emerald-500 bg-white" : "border-black/30 bg-white dark:bg-white/90"} flex items-center justify-center transition-colors shrink-0`}
      >
        {checked && <Check className="w-3.5 h-3.5 text-emerald-500" />}
      </div>
      <span className="text-sm text-black/80 flex-1">I&apos;m not a robot</span>
      <div className="flex flex-col items-center pl-2 border-l border-black/10 shrink-0">
        <svg width="24" height="24" viewBox="0 0 32 32" aria-label="reCAPTCHA">
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
        <span className="text-[7px] font-bold text-black/40 mt-0.5">reCAPTCHA</span>
        <span className="text-[6px] text-black/30 leading-none">Privacy&nbsp;-&nbsp;Terms</span>
      </div>
    </div>
  );
}
