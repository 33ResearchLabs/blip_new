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
import { formatFiat, formatCrypto } from "@/lib/format";
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
  const [orderExpanded, setOrderExpanded] = useState(false); // expand selected order's details
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
        {step !== "success" && (
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={handleBack}
            aria-label="Back"
            className="w-9 h-9 rounded-[14px] flex items-center justify-center bg-surface-card border border-border-subtle mb-3"
          >
            <ChevronLeft className="w-5 h-5 text-text-secondary" />
          </motion.button>
        )}
        <p className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-none">
          {step === "success" ? "Ticket Submitted" : "Raise a Ticket"}
        </p>
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
                    <div className="rounded-[14px] border border-border-subtle divide-y divide-border-subtle overflow-hidden max-h-72 overflow-y-auto">
                      {/* No specific order */}
                      <button
                        type="button"
                        onClick={() => {
                          setForm((f) => ({ ...f, orderId: "" }));
                          setOrderExpanded(false);
                        }}
                        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors ${
                          form.orderId === "" ? "bg-surface-hover" : "hover:bg-surface-hover"
                        }`}
                      >
                        <span className="text-[13px] text-text-primary">No specific order</span>
                        <span
                          className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${
                            form.orderId === "" ? "border-accent" : "border-border-medium"
                          }`}
                        >
                          {form.orderId === "" && (
                            <span className="w-2 h-2 rounded-full bg-accent" />
                          )}
                        </span>
                      </button>

                      {orders.map((o) => {
                        const selected = form.orderId === o.id;
                        return (
                          <div key={o.id} className={selected ? "bg-surface-hover" : ""}>
                            <div className="flex items-stretch">
                              <button
                                type="button"
                                onClick={() => {
                                  setForm((f) => ({ ...f, orderId: o.id }));
                                  setOrderExpanded(false);
                                }}
                                className="flex-1 min-w-0 flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover transition-colors"
                              >
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[13px] font-bold text-text-primary">
                                      #{o.order_number}
                                    </span>
                                    <span
                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                        o.type === "buy"
                                          ? "bg-emerald-500/15 text-emerald-400"
                                          : "bg-blue-500/15 text-blue-400"
                                      }`}
                                    >
                                      {o.type.toUpperCase()}
                                    </span>
                                    <span className="text-[11px] text-text-tertiary">{o.status}</span>
                                  </div>
                                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-tertiary">
                                    <span className="tabular-nums text-text-secondary">
                                      {formatFiat(Number(o.fiat_amount), o.fiat_currency)}
                                    </span>
                                    <span>·</span>
                                    <span className="tabular-nums">
                                      {new Date(o.created_at).toLocaleDateString("en-US", {
                                        day: "2-digit",
                                        month: "short",
                                      })}
                                    </span>
                                  </div>
                                </div>
                                <span
                                  className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${
                                    selected ? "border-accent" : "border-border-medium"
                                  }`}
                                >
                                  {selected && <span className="w-2 h-2 rounded-full bg-accent" />}
                                </span>
                              </button>
                              {selected && (
                                <button
                                  type="button"
                                  onClick={() => setOrderExpanded((v) => !v)}
                                  aria-label="Order details"
                                  className="px-3 flex items-center justify-center text-text-tertiary hover:text-text-secondary border-l border-border-subtle"
                                >
                                  <ChevronDown
                                    className={`w-4 h-4 transition-transform ${orderExpanded ? "rotate-180" : ""}`}
                                  />
                                </button>
                              )}
                            </div>
                            {selected && orderExpanded && (
                              <div className="px-4 pb-3 pt-1 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] border-t border-border-subtle">
                                <div>
                                  <div className="text-text-tertiary">Crypto</div>
                                  <div className="text-text-primary tabular-nums">
                                    {formatCrypto(Number(o.crypto_amount))} USDT
                                  </div>
                                </div>
                                <div>
                                  <div className="text-text-tertiary">Fiat</div>
                                  <div className="text-text-primary tabular-nums">
                                    {formatFiat(Number(o.fiat_amount), o.fiat_currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-text-tertiary">Status</div>
                                  <div className="text-text-primary">{o.status}</div>
                                </div>
                                <div>
                                  <div className="text-text-tertiary">Date</div>
                                  <div className="text-text-primary tabular-nums">
                                    {new Date(o.created_at).toLocaleString("en-US", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      hour12: false,
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 px-4 py-3 rounded-[12px] bg-error-dim border border-error-border">
                    <AlertTriangle className="w-4 h-4 text-error shrink-0" />
                    <span className="text-[12.5px] text-error">{error}</span>
                  </div>
                )}

                {/* Submit */}
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[16px] bg-accent text-accent-text font-bold text-[14px] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
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
                    className="w-full py-3.5 rounded-[16px] bg-accent text-accent-text text-[14px] font-bold"
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
