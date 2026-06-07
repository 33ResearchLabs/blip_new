"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Send,
  ChevronDown,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

const T = {
  bg: "#08080a",
  surface: "#161618",
  text: "#f5f5f7",
  muted: "#86868b",
  muted2: "#aeaeb2",
  faint: "#5a5a60",
  hair: "rgba(255,255,255,0.09)",
  glass: "rgba(255,255,255,0.055)",
  mint: "#b8e9d4",
  mintBg: "rgba(184,233,212,0.12)",
};

interface MerchantSupportSheetProps {
  open: boolean;
  onClose: () => void;
  merchantId?: string | null;
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

type CategoryKey = "payment" | "backend" | "other";

interface TicketForm {
  categoryLabel: string;
  apiCategory: CategoryKey;
  subject: string;
  description: string;
  orderId: string;
}

const TICKET_CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: "payment", label: "Payment not released / stuck escrow" },
  { key: "payment", label: "Wrong amount received" },
  { key: "other", label: "User dispute not resolving" },
  { key: "other", label: "Account flagged / suspended" },
  { key: "other", label: "Tier upgrade issue" },
  { key: "other", label: "Something else" },
];

const INITIAL_FORM: TicketForm = {
  categoryLabel: "",
  apiCategory: "other",
  subject: "",
  description: "",
  orderId: "",
};

export function MerchantSupportSheet({
  open,
  onClose,
  merchantId,
}: MerchantSupportSheetProps) {
  const [step, setStep] = useState<"category" | "form" | "success">("category");
  const [form, setForm] = useState<TicketForm>(INITIAL_FORM);
  const [orders, setOrders] = useState<RecentOrder[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  // Reset state whenever sheet opens
  useEffect(() => {
    if (!open) return;
    setStep("category");
    setForm(INITIAL_FORM);
    setError(null);
    setCreatedId(null);
    setSubmitting(false);
  }, [open]);

  // Fetch recent merchant orders
  useEffect(() => {
    if (!open || !merchantId) return;
    fetchWithAuth(`/api/orders?merchant_id=${merchantId}&limit=10`)
      .then((r) => r.json())
      .then((d) => {
        const rows = d?.data?.orders ?? d?.data ?? [];
        setOrders(Array.isArray(rows) ? rows.slice(0, 10) : []);
      })
      .catch(() => {});
  }, [open, merchantId]);

  if (!open) return null;

  const selectCategory = (label: string, apiCategory: CategoryKey) => {
    setForm((f) => ({ ...f, categoryLabel: label, apiCategory }));
    setStep("form");
  };

  const handleBack = () => {
    if (step === "form") {
      setStep("category");
    } else {
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (!form.subject.trim() || !form.description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const metadata: Record<string, unknown> = {
        category_label: form.categoryLabel,
        source: "merchant-in-app-support",
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
        throw new Error(
          "Support tickets are temporarily unavailable. Please contact us via Telegram."
        );
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 14,
    background: T.surface,
    border: `1px solid ${T.hair}`,
    color: T.text,
    fontSize: 13.5,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: T.faint,
    marginBottom: 8,
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 79,
              background: "rgba(0,0,0,0.72)",
            }}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 80,
              maxHeight: "88vh",
              borderRadius: "24px 24px 0 0",
              background: T.bg,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Drag handle */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                paddingTop: 12,
                paddingBottom: 4,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 99,
                  background: T.faint,
                }}
              />
            </div>

            {/* Header */}
            <div
              style={{
                padding: "12px 20px 12px",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 12,
                borderBottom: `1px solid ${T.hair}`,
              }}
            >
              {step === "form" ? (
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={handleBack}
                  aria-label="Back"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: T.surface,
                    border: `1px solid ${T.hair}`,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <ChevronLeft
                    style={{ width: 18, height: 18, color: T.muted2 }}
                  />
                </motion.button>
              ) : step !== "success" ? (
                <motion.button
                  whileTap={{ scale: 0.92 }}
                  onClick={onClose}
                  aria-label="Close"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: T.surface,
                    border: `1px solid ${T.hair}`,
                    cursor: "pointer",
                    flexShrink: 0,
                    fontSize: 18,
                    color: T.muted2,
                    lineHeight: 1,
                  }}
                >
                  ✕
                </motion.button>
              ) : (
                <div style={{ width: 36, flexShrink: 0 }} />
              )}

              <p
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  color: T.text,
                  margin: 0,
                  flex: 1,
                }}
              >
                {step === "success" ? "Ticket Raised" : "Raise a Ticket"}
              </p>
            </div>

            {/* Scrollable content */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 20px 32px",
              }}
            >
              <AnimatePresence mode="wait">
                {/* Step 1: Category selection */}
                {step === "category" && (
                  <motion.div
                    key="category"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    style={{ display: "flex", flexDirection: "column", gap: 10 }}
                  >
                    <p
                      style={{
                        fontSize: 13,
                        color: T.muted,
                        marginBottom: 6,
                        marginTop: 0,
                      }}
                    >
                      What do you need help with?
                    </p>
                    {TICKET_CATEGORIES.map(({ key, label }) => (
                      <motion.button
                        key={label}
                        whileTap={{ scale: 0.98 }}
                        whileHover={{ y: -1 }}
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 28,
                        }}
                        onClick={() => selectCategory(label, key)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          borderRadius: 16,
                          padding: "14px 16px",
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          background: T.surface,
                          border: `1px solid ${T.hair}`,
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            flex: 1,
                            fontSize: 13.5,
                            fontWeight: 700,
                            color: T.text,
                          }}
                        >
                          {label}
                        </span>
                        <ChevronDown
                          style={{
                            width: 16,
                            height: 16,
                            color: T.faint,
                            transform: "rotate(-90deg)",
                            flexShrink: 0,
                          }}
                          strokeWidth={2}
                        />
                      </motion.button>
                    ))}
                  </motion.div>
                )}

                {/* Step 2: Form */}
                {step === "form" && (
                  <motion.div
                    key="form"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    style={{ display: "flex", flexDirection: "column", gap: 20 }}
                  >
                    {/* Category badge */}
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "6px 12px",
                        borderRadius: 99,
                        background: T.mintBg,
                        border: `1px solid rgba(184,233,212,0.2)`,
                        alignSelf: "flex-start",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: T.mint,
                        }}
                      >
                        {form.categoryLabel}
                      </span>
                    </div>

                    {/* Subject */}
                    <div>
                      <label style={labelStyle}>Subject</label>
                      <input
                        type="text"
                        value={form.subject}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, subject: e.target.value }))
                        }
                        maxLength={200}
                        placeholder="Brief summary of your issue"
                        style={inputStyle}
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label style={labelStyle}>Description</label>
                      <textarea
                        value={form.description}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            description: e.target.value,
                          }))
                        }
                        maxLength={1000}
                        rows={5}
                        placeholder="Describe what happened — include order IDs, amounts, and any steps you've already tried…"
                        style={{
                          ...inputStyle,
                          resize: "none",
                          fontFamily: "inherit",
                        }}
                      />
                      <p
                        style={{
                          fontSize: 10,
                          color: T.faint,
                          marginTop: 4,
                          textAlign: "right",
                        }}
                      >
                        {form.description.length}/1000
                      </p>
                    </div>

                    {/* Link order (optional) */}
                    {orders.length > 0 && (
                      <div>
                        <label style={labelStyle}>
                          Linked order{" "}
                          <span
                            style={{
                              color: T.faint,
                              textTransform: "none",
                              letterSpacing: 0,
                              fontWeight: 500,
                            }}
                          >
                            (optional)
                          </span>
                        </label>
                        <div style={{ position: "relative" }}>
                          <select
                            value={form.orderId}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, orderId: e.target.value }))
                            }
                            style={{
                              ...inputStyle,
                              appearance: "none",
                              paddingRight: 36,
                            }}
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
                          <ChevronDown
                            style={{
                              pointerEvents: "none",
                              position: "absolute",
                              right: 12,
                              top: "50%",
                              transform: "translateY(-50%)",
                              width: 16,
                              height: 16,
                              color: T.faint,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Error */}
                    {error && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "12px 16px",
                          borderRadius: 12,
                          background: "rgba(239,68,68,0.10)",
                          border: "1px solid rgba(239,68,68,0.20)",
                        }}
                      >
                        <AlertTriangle
                          style={{
                            width: 16,
                            height: 16,
                            color: "#f87171",
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ fontSize: 12.5, color: "#fca5a5" }}>
                          {error}
                        </span>
                      </div>
                    )}

                    {/* Submit */}
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={handleSubmit}
                      disabled={!canSubmit}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                        padding: "14px 0",
                        borderRadius: 16,
                        background: canSubmit ? T.mint : T.surface,
                        color: canSubmit ? "#08080a" : T.faint,
                        fontWeight: 700,
                        fontSize: 14,
                        border: "none",
                        cursor: canSubmit ? "pointer" : "not-allowed",
                        opacity: canSubmit ? 1 : 0.5,
                        transition: "background 0.15s, color 0.15s, opacity 0.15s",
                      }}
                    >
                      {submitting ? (
                        <Loader2
                          style={{ width: 16, height: 16 }}
                          className="animate-spin"
                        />
                      ) : (
                        <Send style={{ width: 16, height: 16 }} />
                      )}
                      {submitting ? "Submitting…" : "Submit Ticket"}
                    </motion.button>

                    <p
                      style={{
                        fontSize: 11,
                        color: T.faint,
                        textAlign: "center",
                        marginTop: -8,
                      }}
                    >
                      Our team typically responds within 24 hours.
                    </p>
                  </motion.div>
                )}

                {/* Step 3: Success */}
                {step === "success" && (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      paddingTop: 32,
                      gap: 20,
                    }}
                  >
                    <div
                      style={{
                        width: 80,
                        height: 80,
                        borderRadius: "50%",
                        background: T.mintBg,
                        border: `1px solid rgba(184,233,212,0.25)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <CheckCircle2
                        style={{ width: 36, height: 36, color: T.mint }}
                        strokeWidth={1.8}
                      />
                    </div>

                    <div>
                      <p
                        style={{
                          fontSize: 20,
                          fontWeight: 800,
                          color: T.text,
                          letterSpacing: "-0.02em",
                          margin: 0,
                        }}
                      >
                        Ticket Raised
                      </p>
                      <p
                        style={{
                          fontSize: 13,
                          color: T.muted,
                          marginTop: 8,
                          maxWidth: 260,
                          lineHeight: 1.5,
                        }}
                      >
                        We&apos;ve received your ticket and will get back to you
                        within 24 hours.
                      </p>
                      {createdId && (
                        <p
                          style={{
                            marginTop: 8,
                            fontSize: 11,
                            fontFamily: "monospace",
                            color: T.faint,
                          }}
                        >
                          Ref: {createdId.slice(0, 8).toUpperCase()}
                        </p>
                      )}
                    </div>

                    <div
                      style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                        marginTop: 8,
                      }}
                    >
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={onClose}
                        style={{
                          width: "100%",
                          padding: "14px 0",
                          borderRadius: 16,
                          background: T.mint,
                          color: "#08080a",
                          fontWeight: 700,
                          fontSize: 14,
                          border: "none",
                          cursor: "pointer",
                        }}
                      >
                        Done
                      </motion.button>
                      <motion.button
                        whileTap={{ scale: 0.97 }}
                        onClick={() => {
                          setStep("category");
                          setForm(INITIAL_FORM);
                          setCreatedId(null);
                          setError(null);
                        }}
                        style={{
                          width: "100%",
                          padding: "14px 0",
                          borderRadius: 16,
                          background: T.surface,
                          border: `1px solid ${T.hair}`,
                          color: T.muted2,
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: "pointer",
                        }}
                      >
                        Raise Another Ticket
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
