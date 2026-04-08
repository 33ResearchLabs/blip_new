"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Smartphone,
  Banknote,
  CreditCard,
  Plus,
  Check,
  Loader2,
  ChevronDown,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { colors } from "@/lib/design/theme";

export interface PaymentMethodItem {
  id: string;
  type: "bank" | "upi" | "cash" | "other";
  label: string;
  details: Record<string, string>;
  is_active: boolean;
}

interface PaymentMethodSelectorProps {
  userId: string | null;
  selectedId: string | null;
  onSelect: (method: PaymentMethodItem | null) => void;
}

const TYPE_CONFIG = {
  bank: { Icon: Building2, label: "Bank Account", color: "#3b82f6" },
  upi: { Icon: Smartphone, label: "UPI", color: "#22c55e" },
  cash: { Icon: Banknote, label: "Cash", color: "#f59e0b" },
  other: { Icon: CreditCard, label: "Other", color: "#8b5cf6" },
} as const;

type MethodType = keyof typeof TYPE_CONFIG;

export const PaymentMethodSelector = ({
  userId,
  selectedId,
  onSelect,
}: PaymentMethodSelectorProps) => {
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add form state
  const [addType, setAddType] = useState<MethodType>("bank");
  const [addLabel, setAddLabel] = useState("");
  const [addDetails, setAddDetails] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");

  const selected = methods.find((m) => m.id === selectedId) || null;

  // Fetch payment methods
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchWithAuth(`/api/users/${userId}/payment-methods`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setMethods(data.data);
          // Auto-select first if nothing selected
          if (!selectedId && data.data.length > 0) {
            onSelect(data.data[0]);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setAddType("bank");
    setAddLabel("");
    setAddDetails({});
    setFormError("");
  };

  const handleAdd = async () => {
    setFormError("");
    if (!addLabel.trim()) {
      setFormError("Label is required");
      return;
    }
    // Validate details per type
    if (addType === "bank") {
      if (!addDetails.bank_name || !addDetails.account_name || !addDetails.iban) {
        setFormError("Bank name, account name, and IBAN are required");
        return;
      }
      if (addDetails.iban.length < 15 || addDetails.iban.length > 34) {
        setFormError("IBAN must be 15-34 characters");
        return;
      }
    }
    if (addType === "upi" && !addDetails.upi_id) {
      setFormError("UPI ID is required");
      return;
    }
    if (!userId) return;

    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/users/${userId}/payment-methods`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: addType,
          label: addLabel.trim(),
          details: addDetails,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setMethods((prev) => [data.data, ...prev]);
        onSelect(data.data);
        resetForm();
        setShowAddForm(false);
        setExpanded(false);
      } else {
        setFormError(data.error || "Failed to add payment method");
      }
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const getSubtext = (m: PaymentMethodItem) => {
    if (m.type === "bank") {
      const iban = m.details.iban || "";
      return `${m.details.account_name || ""} \u00B7 ${iban.slice(0, 4)}...${iban.slice(-4)}`;
    }
    if (m.type === "upi") return m.details.upi_id || "";
    if (m.type === "cash") return m.details.location_name || "";
    return m.details.method_name || m.details.account_identifier || "";
  };

  if (loading) {
    return (
      <div className="w-full rounded-2xl p-4 flex items-center justify-center gap-2"
        style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
        <Loader2 className="w-4 h-4 animate-spin text-white/40" />
        <span className="text-[13px] text-white/40">Loading payment methods...</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2">
        <CreditCard className="w-4 h-4 text-white/40" />
        <span className="text-[12px] text-white/40 uppercase tracking-wide font-semibold">
          Your Payment Method
        </span>
      </div>

      {/* Selected method display / dropdown trigger */}
      {methods.length > 0 && !showAddForm && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full rounded-xl p-3 flex items-center gap-3 text-left"
          style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
        >
          {selected ? (
            <>
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${TYPE_CONFIG[selected.type].color}30` }}
              >
                {(() => {
                  const Ic = TYPE_CONFIG[selected.type].Icon;
                  return <Ic className="w-4 h-4" style={{ color: TYPE_CONFIG[selected.type].color }} />;
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-white truncate">{selected.label}</p>
                <p className="text-[12px] text-white/60 truncate">{getSubtext(selected)}</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                <CreditCard className="w-4 h-4 text-white/40" />
              </div>
              <p className="text-[14px] text-white/40">Select a payment method</p>
            </>
          )}
          <ChevronDown
            className={`w-4 h-4 text-white/40 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {/* Dropdown list */}
      <AnimatePresence>
        {expanded && !showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-1 max-h-[240px] overflow-y-auto">
              {methods.map((m) => {
                const cfg = TYPE_CONFIG[m.type];
                const Ic = cfg.Icon;
                const isSel = m.id === selectedId;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelect(m);
                      setExpanded(false);
                    }}
                    className="w-full flex items-center gap-3 rounded-xl p-3 text-left transition-colors"
                    style={isSel
                      ? { background: colors.surface.card, border: `2px solid ${colors.accent.primary}` }
                      : { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }
                    }
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${cfg.color}30` }}
                    >
                      <Ic className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-white truncate">
                        {m.label}
                        <span className="ml-1.5 text-[10px] text-white/50 font-normal">
                          {cfg.label}
                        </span>
                      </p>
                      <p className="text-[11px] text-white/50 truncate">{getSubtext(m)}</p>
                    </div>
                    {isSel && (
                      <div className="w-5 h-5 rounded-full bg-white flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-black" />
                      </div>
                    )}
                  </button>
                );
              })}

              {/* Add new button */}
              <button
                onClick={() => { resetForm(); setShowAddForm(true); }}
                className="w-full flex items-center gap-3 rounded-xl p-3 text-left transition-colors"
                style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
              >
                <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  <Plus className="w-3.5 h-3.5 text-white/40" />
                </div>
                <span className="text-[13px] text-white/50 font-medium">
                  Add New Payment Method
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No methods — show add form directly */}
      {methods.length === 0 && !showAddForm && (
        <button
          onClick={() => { resetForm(); setShowAddForm(true); }}
          className="w-full rounded-xl p-4 flex items-center gap-3 text-left transition-colors"
          style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
        >
          <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 text-white/40" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-white">Add Payment Method</p>
            <p className="text-[12px] text-white/40">
              Required to receive fiat payments
            </p>
          </div>
        </button>
      )}

      {/* Add form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl p-4 mt-1"
            style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-white">Add Payment Method</span>
              <button
                onClick={() => { setShowAddForm(false); setFormError(""); }}
                className="p-1 rounded-lg hover:bg-white/5"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>

            {/* Type selector */}
            <div className="flex gap-1.5 mb-3">
              {(Object.keys(TYPE_CONFIG) as MethodType[]).map((t) => {
                const cfg = TYPE_CONFIG[t];
                const Ic = cfg.Icon;
                const active = addType === t;
                return (
                  <button
                    key={t}
                    onClick={() => { setAddType(t); setAddDetails({}); setFormError(""); }}
                    className="flex-1 flex flex-col items-center gap-1 rounded-lg py-2 transition-colors"
                    style={active
                      ? { background: colors.surface.active, border: `1px solid ${colors.border.medium}` }
                      : { background: colors.surface.glass }
                    }
                  >
                    <Ic className="w-3.5 h-3.5" style={{ color: active ? cfg.color : "rgba(255,255,255,0.3)" }} />
                    <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: active ? "#fff" : "rgba(255,255,255,0.3)" }}>
                      {cfg.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-2.5">
              {/* Label */}
              <input
                type="text"
                value={addLabel}
                onChange={(e) => setAddLabel(e.target.value)}
                placeholder="Label (e.g. Emirates NBD - Salary)"
                className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
              />

              {/* Bank fields */}
              {addType === "bank" && (
                <>
                  <input
                    type="text"
                    value={addDetails.bank_name || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, bank_name: e.target.value })}
                    placeholder="Bank Name (e.g. Emirates NBD)"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.account_name || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, account_name: e.target.value })}
                    placeholder="Account Holder Name"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.iban || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, iban: e.target.value.toUpperCase() })}
                    placeholder="IBAN (e.g. AE070331234567890123456)"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white font-mono placeholder:text-white/25 placeholder:font-sans outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                </>
              )}

              {/* UPI fields */}
              {addType === "upi" && (
                <>
                  <input
                    type="text"
                    value={addDetails.upi_id || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, upi_id: e.target.value })}
                    placeholder="UPI ID (e.g. user@oksbi)"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white font-mono placeholder:text-white/25 placeholder:font-sans outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.provider || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, provider: e.target.value })}
                    placeholder="Provider (e.g. Google Pay, PhonePe) — optional"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                </>
              )}

              {/* Cash fields */}
              {addType === "cash" && (
                <>
                  <input
                    type="text"
                    value={addDetails.location_name || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, location_name: e.target.value })}
                    placeholder="Location Name"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.location_address || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, location_address: e.target.value })}
                    placeholder="Address"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.meeting_instructions || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, meeting_instructions: e.target.value })}
                    placeholder="Meeting instructions — optional"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                </>
              )}

              {/* Other fields */}
              {addType === "other" && (
                <>
                  <input
                    type="text"
                    value={addDetails.method_name || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, method_name: e.target.value })}
                    placeholder="Method Name (e.g. Wise, PayPal)"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.account_identifier || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, account_identifier: e.target.value })}
                    placeholder="Account ID / Email / Phone"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.instructions || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, instructions: e.target.value })}
                    placeholder="Instructions — optional"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:ring-1 focus:ring-white/20"
                    style={{ background: colors.surface.card }}
                  />
                </>
              )}

              {formError && (
                <p className="text-[12px] text-red-400">{formError}</p>
              )}

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleAdd}
                disabled={saving}
                className="w-full py-2.5 rounded-lg text-[13px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: colors.accent.primary, color: colors.accent.text }}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Save & Select
                  </>
                )}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
