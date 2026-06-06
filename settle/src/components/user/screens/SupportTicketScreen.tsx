"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  Wallet,
  Lock,
  TrendingUp,
  HelpCircle,
  ChevronDown,
  Send,
  Loader2,
  IndianRupee,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import type { Screen } from "./types";

const CARD = "bg-surface-card border border-border-subtle";

interface SupportTicketScreenProps {
  setScreen: (s: Screen) => void;
  previousScreen?: Screen;
  userId?: string;
}

interface RecentOrder {
  id: string;
  order_number: string;
  type: "buy" | "sell";
  fiat_amount: number;
  fiat_currency: string;
  crypto_amount: number;
  status: string;
  created_at: string;
}

const TICKET_CATEGORIES = [
  { key: "payment", label: "Payment stuck / not received", icon: IndianRupee },
  { key: "payment", label: "Wrong amount sent", icon: Wallet },
  { key: "other", label: "Escrow release delayed", icon: Lock },
  { key: "other", label: "Account locked / flagged", icon: AlertTriangle },
  { key: "other", label: "Tier upgrade not reflected", icon: TrendingUp },
  { key: "other", label: "Something else", icon: HelpCircle },
] as const;

type CategoryKey = "payment" | "backend" | "other";

interface TicketForm {
  categoryLabel: string;
  apiCategory: CategoryKey;
  subject: string;
  description: string;
  orderId: string;
}

const SAFE_BACK: Set<Screen> = new Set(["home", "orders", "profile", "support"]);

export function SupportTicketScreen({
  setScreen,
  previousScreen,
  userId,
}: SupportTicketScreenProps) {
  const [step, setStep] = useState<"category" | "form" | "success">("category");
  const [form, setForm] = useState<TicketForm>({
    categoryLabel: "",
    apiCategory: "other",
    subject: "",
    description: "",
    orderId: "",
  });
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    fetchWithAuth(`/api/orders?user_id=${userId}&limit=10`)
      .then((r) => r.json())
      .then((d) => {
        const rows = d?.data?.orders ?? d?.data ?? [];
        setOrders(Array.isArray(rows) ? rows.slice(0, 10) : []);
      })
      .catch(() => {});
  }, [userId]);

  const handleBack = () => {
    if (step === "form") {
      setStep("category");
      return;
    }
    const target =
      previousScreen && SAFE_BACK.has(previousScreen)
        ? previousScreen
        : "support";
    setScreen(target);
  };

  const selectCategory = (label: string, apiCategory: CategoryKey) => {
    setForm((f) => ({ ...f, categoryLabel: label, apiCategory }));
    setStep("form");
  };

  const handleSubmit = async () => {
    if (!form.subject.trim() || !form.description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const metadata: Record<string, unknown> = {
        category_label: form.categoryLabel,
        source: "in-app-support",
      };
      if (form.orderId) metadata.linked_order_id = form.orderId;

      const res = await fetchWithAuth("/api/issues/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.subject.trim(),
          category: form.apiCategory,
          description: form.description.trim(),
          metadata,
        }),
      });
      if (res.status === 204) {
        throw new Error("Support tickets are temporarily unavailable. Please contact us via Telegram.");
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setCreatedId(data.data?.id ?? null);
      setStep("success");
    } catch (e) {
      setError((e as Error).message || "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    form.subject.trim().length > 0 &&
    form.description.trim().length >= 10 &&
    !submitting;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* Header */}
      <header className="px-5 pt-4 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          {step !== "success" && (
            <motion.button
              whileTap={{ scale: 0.92 }}
              onClick={handleBack}
              aria-label="Back"
              className="w-9 h-9 rounded-[14px] flex items-center justify-center shrink-0 bg-surface-card border border-border-subtle"
            >
              <ChevronLeft className="w-5 h-5 text-text-secondary" />
            </motion.button>
          )}
          <div>
            <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
              {step === "success" ? "Ticket Submitted" : "Raise a Ticket"}
            </p>
            {step === "category" && (
              <p className="text-[12px] text-text-tertiary mt-0.5">
                What&apos;s the issue?
              </p>
            )}
            {step === "form" && (
              <p className="text-[12px] text-text-tertiary mt-0.5 truncate max-w-[220px]">
                {form.categoryLabel}
              </p>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 px-5 pb-10 overflow-y-auto scrollbar-hide">
        <div className="mx-auto w-full max-w-[440px]">
          <AnimatePresence mode="wait">
            {/* ── Step 1: Category selection ── */}
            {step === "category" && (
              <motion.div
                key="category"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-2.5"
              >
                {TICKET_CATEGORIES.map(({ key, label, icon: Icon }) => (
                  <motion.button
                    key={label}
                    whileTap={{ scale: 0.98 }}
                    whileHover={{ y: -1 }}
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                    onClick={() => selectCategory(label, key as CategoryKey)}
                    className={`w-full text-left rounded-[16px] p-4 flex items-center gap-3 ${CARD} hover:bg-surface-hover transition-colors`}
                  >
                    <span className="w-10 h-10 rounded-full bg-surface-raised border border-border-subtle flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-text-secondary" strokeWidth={2} />
                    </span>
                    <span className="flex-1 text-[13.5px] font-bold text-text-primary">
                      {label}
                    </span>
                    <ChevronDown className="w-4 h-4 text-text-tertiary rotate-[-90deg] shrink-0" strokeWidth={2} />
                  </motion.button>
                ))}
              </motion.div>
            )}

            {/* ── Step 2: Form ── */}
            {step === "form" && (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-4"
              >
                {/* Subject */}
                <div>
                  <label className="block text-[11px] font-bold tracking-[0.12em] uppercase text-text-tertiary mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, subject: e.target.value }))
                    }
                    maxLength={200}
                    placeholder="Brief summary of your issue"
                    className={`w-full px-4 py-3 rounded-[14px] ${CARD} text-[13.5px] text-text-primary placeholder:text-text-tertiary bg-transparent outline-none focus:border-border-medium transition-colors`}
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[11px] font-bold tracking-[0.12em] uppercase text-text-tertiary mb-2">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, description: e.target.value }))
                    }
                    maxLength={1000}
                    rows={5}
                    placeholder="Describe what happened, steps to reproduce, amounts involved..."
                    className={`w-full px-4 py-3 rounded-[14px] ${CARD} text-[13.5px] text-text-primary placeholder:text-text-tertiary bg-transparent outline-none focus:border-border-medium transition-colors resize-none`}
                  />
                  <p className="text-[10px] text-text-tertiary mt-1 text-right">
                    {form.description.length}/1000
                  </p>
                </div>

                {/* Link order (optional) */}
                {orders.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-bold tracking-[0.12em] uppercase text-text-tertiary mb-2">
                      Linked order{" "}
                      <span className="text-text-tertiary normal-case font-medium tracking-normal">
                        (optional)
                      </span>
                    </label>
                    <div className="relative">
                      <select
                        value={form.orderId}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, orderId: e.target.value }))
                        }
                        className={`w-full appearance-none px-4 py-3 pr-9 rounded-[14px] ${CARD} text-[13px] text-text-primary bg-transparent outline-none focus:border-border-medium transition-colors`}
                      >
                        <option value="">No specific order</option>
                        {orders.map((o) => (
                          <option key={o.id} value={o.id}>
                            #{o.order_number} · {o.type.toUpperCase()} ·{" "}
                            {o.fiat_currency}{" "}
                            {Number(o.fiat_amount).toLocaleString()} ·{" "}
                            {o.status}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-[12px] bg-red-500/10 border border-red-500/20">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="text-[12.5px] text-red-300">{error}</span>
                  </div>
                )}

                {/* Submit */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[16px] bg-accent text-white font-bold text-[14px] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {submitting ? "Submitting…" : "Submit Ticket"}
                </motion.button>

                <p className="text-[11px] text-text-tertiary text-center">
                  Our team typically responds within 24 hours.
                </p>
              </motion.div>
            )}

            {/* ── Step 3: Success ── */}
            {step === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-center text-center pt-8 gap-5"
              >
                <div className="w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-emerald-400" strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[20px] font-extrabold text-text-primary tracking-[-0.02em]">
                    Ticket Raised
                  </p>
                  <p className="text-[13px] text-text-secondary mt-1.5 max-w-[260px] mx-auto">
                    We&apos;ve received your ticket and will get back to you
                    within 24 hours.
                  </p>
                  {createdId && (
                    <p className="mt-2 text-[11px] font-mono text-text-tertiary">
                      Ref: {createdId.slice(0, 8).toUpperCase()}
                    </p>
                  )}
                </div>

                <div className="w-full space-y-2.5 mt-2">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setScreen("support")}
                    className={`w-full py-3.5 rounded-[16px] ${CARD} text-[14px] font-bold text-text-primary hover:bg-surface-hover transition-colors`}
                  >
                    View My Tickets
                  </motion.button>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setScreen("home")}
                    className="w-full py-3.5 rounded-[16px] bg-accent text-white text-[14px] font-bold"
                  >
                    Back to Home
                  </motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
