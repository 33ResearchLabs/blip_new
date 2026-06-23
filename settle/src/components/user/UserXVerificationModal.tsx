"use client";

// User-side X (Twitter) follow verification, shown in the user Limits screen.
// Two-step, self-attested flow mirroring MerchantXVerificationModal but themed
// with the user app's design tokens (light/dark aware) instead of the merchant
// dark-only surface. Backed by the same /api/limits/x-verification endpoint,
// which binds the handle to the authenticated actor — here, the user.
// Display-only: this does NOT change trade limits.

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, Loader2, AlertCircle, ExternalLink } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

const X_PROFILE_URL = "https://x.com/blip_money";

// Inline X (formerly Twitter) wordmark — Lucide ships only the legacy bird.
function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

const inputClass =
  "w-full pl-8 pr-4 py-2.5 bg-surface-base border border-border-subtle rounded-xl text-[13px] text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-border-medium focus:ring-1 focus:ring-accent/30 transition-all";

interface UserXVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-fills the handle field if the user has verified before. */
  currentHandle?: string;
  /** Called with the verified handle once verification succeeds. */
  onVerified: (xUsername: string) => void;
}

type Step = "follow" | "confirm" | "success";

export function UserXVerificationModal({
  isOpen,
  onClose,
  currentHandle,
  onVerified,
}: UserXVerificationModalProps) {
  const [step, setStep] = useState<Step>("follow");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Reset to a clean state whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) {
      setStep("follow");
      setHandle(currentHandle || "");
      setError("");
      setIsBusy(false);
    }
  }, [isOpen, currentHandle]);

  function followNow() {
    window.open(X_PROFILE_URL, "_blank", "noopener,noreferrer");
    setStep("confirm");
  }

  async function verify() {
    setError("");
    const trimmed = handle.trim().replace(/^@/, "");
    if (!trimmed) {
      setError("Enter your X/Twitter username.");
      return;
    }
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(trimmed)) {
      setError("Invalid username format. Enter your handle without @.");
      return;
    }
    setIsBusy(true);
    try {
      const res = await fetchWithAuth("/api/limits/x-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x_username: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Verification failed. Try again.");
      }
      setStep("success");
      onVerified(data.data?.x_username || trimmed);
      // Brief success beat, then close.
      setTimeout(onClose, 1300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!isOpen) return null;

  const subtitle =
    step === "follow"
      ? "Follow @blip_money on X"
      : step === "confirm"
        ? "Confirm your X username"
        : "X account verified";

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md bg-surface-card rounded-2xl border border-border-subtle shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4 border-b border-border-subtle">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-active border border-border-medium flex items-center justify-center">
                  <XLogo className="w-4 h-4 text-text-primary" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-text-primary">
                    Verify your X account
                  </h2>
                  <p className="text-[11px] text-text-tertiary mt-0.5">{subtitle}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="p-2 hover:bg-surface-hover rounded-xl transition-colors"
              >
                <X className="w-4 h-4 text-text-tertiary" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="relative p-5">
            <AnimatePresence mode="wait">
              {step === "follow" && (
                <motion.div
                  key="follow"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-4"
                >
                  <p className="text-[13px] text-text-secondary leading-[1.55]">
                    Follow our official X (Twitter) account to stay updated on
                    announcements and rewards, then confirm your handle.
                  </p>

                  <button
                    onClick={followNow}
                    className="w-full py-3 rounded-xl bg-accent text-accent-text font-bold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                  >
                    <XLogo className="w-3.5 h-3.5" />
                    Follow @blip_money
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => setStep("confirm")}
                    className="block w-full text-center text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
                  >
                    I already follow — continue
                  </button>
                </motion.div>
              )}

              {step === "confirm" && (
                <motion.div
                  key="confirm"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-4"
                >
                  <div>
                    <label className="text-xs text-text-tertiary uppercase tracking-wider mb-2 block">
                      Your X Username
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary text-[14px]">
                        @
                      </span>
                      <input
                        type="text"
                        autoFocus
                        value={handle}
                        onChange={(e) => setHandle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !isBusy && verify()}
                        placeholder="your_username"
                        maxLength={15}
                        className={inputClass}
                      />
                    </div>
                    <p className="text-[10px] text-text-quaternary mt-1.5">
                      Enter your handle without the @, so we can verify your follow.
                    </p>
                  </div>

                  {error && (
                    <div className="flex items-center gap-2 text-[12px] text-error">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {error}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        setStep("follow");
                        setError("");
                      }}
                      className="px-4 py-3 rounded-xl bg-surface-active border border-border-subtle text-[13px] font-medium text-text-secondary hover:bg-surface-hover transition-colors"
                    >
                      Back
                    </button>
                    <button
                      onClick={verify}
                      disabled={isBusy || !handle.trim()}
                      className="flex-1 py-3 rounded-xl bg-accent text-accent-text font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                      {isBusy ? "Verifying…" : "Verify follow"}
                    </button>
                  </div>
                </motion.div>
              )}

              {step === "success" && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center text-center py-6"
                >
                  <div className="w-14 h-14 rounded-full bg-surface-active border border-border-medium flex items-center justify-center mb-3">
                    <Check className="w-7 h-7 text-text-primary" />
                  </div>
                  <p className="text-sm font-bold text-text-primary">X account verified</p>
                  <p className="text-[12px] text-text-tertiary mt-1">
                    @{handle.trim().replace(/^@/, "")} is now verified.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
