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
  Trash2,
  Pencil,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { colors } from "@/lib/design/theme";

export interface PaymentMethodItem {
  id: string;
  type: "bank" | "upi" | "cash" | "other";
  label: string;
  details: Record<string, string>;
  is_active: boolean;
  /** True for the user's primary method (migration 127). Pickers should
   *  preselect this; managers should pin it to the top with a "Default"
   *  pill. Older API responses may omit this field — treat as false. */
  is_default?: boolean;
}

interface PaymentMethodSelectorProps {
  userId: string | null;
  selectedId: string | null;
  onSelect: (method: PaymentMethodItem | null) => void;
  /** Hide the internal "Your Payment Method" header. Use when the caller
   *  already renders a section title above (e.g. ProfileScreen) so the
   *  same title doesn't appear twice. */
  hideHeader?: boolean;
  /** Wrap everything in a single unified rounded card and drop the
   *  per-item border treatment, so the section reads as one "group
   *  container" matching the AppLockSettingsCard pattern on the profile
   *  screen. Trade / Escrow screens keep their default loose-cards look. */
  groupContainer?: boolean;
  /** Render the method list open and skip the collapsed dropdown trigger, so
   *  the in-list "Add New Payment Method" button is always visible. Used when
   *  the selector lives in a dedicated sheet/modal (e.g. the Trade screen's
   *  Payment methods bottom sheet) where there's nothing to collapse into. */
  alwaysExpanded?: boolean;
}

// Each method type maps to a semantic token via its CSS variable.
// "other" reuses text-text-secondary since the reference has no purple slot.
const TYPE_CONFIG = {
  bank:  { Icon: Building2,  label: "Bank Account", color: "var(--color-info)" },
  upi:   { Icon: Smartphone, label: "UPI",          color: "var(--color-success)" },
  cash:  { Icon: Banknote,   label: "Cash",         color: "var(--color-warning)" },
  other: { Icon: CreditCard, label: "Other",        color: "var(--color-text-secondary)" },
} as const;

type MethodType = keyof typeof TYPE_CONFIG;

export const PaymentMethodSelector = ({
  userId,
  selectedId,
  onSelect,
  hideHeader = false,
  groupContainer = false,
  alwaysExpanded = false,
}: PaymentMethodSelectorProps) => {
  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(alwaysExpanded);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  // Two-tap delete: first tap arms `confirmDeleteId`, second tap within
  // 4s actually deletes. Avoids the jarring `window.confirm()` modal.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add / edit form state. When `editingId` is set, the form acts as
  // an editor for that method (PUT) instead of a creator (POST). The type
  // is locked while editing because the server's update schema does not
  // accept `type` — switching type requires delete + re-add.
  const [addType, setAddType] = useState<MethodType>("bank");
  const [addLabel, setAddLabel] = useState("");
  const [addDetails, setAddDetails] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const selected = methods.find((m) => m.id === selectedId) || null;

  // Show the default / selected method first in the expanded list so users
  // can recognise their primary at a glance. Stable order is preserved for
  // the rest of the methods.
  const sortedMethods = selected
    ? [selected, ...methods.filter((m) => m.id !== selected.id)]
    : methods;

  // Fetch payment methods
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchWithAuth(`/api/users/${userId}/payment-methods`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setMethods(data.data);
          // Auto-select the user's default if nothing selected — falls back
          // to the first row (API already returns is_default DESC, created_at DESC).
          if (!selectedId && data.data.length > 0) {
            const def = data.data.find((m: PaymentMethodItem) => m.is_default) ?? data.data[0];
            onSelect(def);
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
    setEditingId(null);
  };

  const startEdit = (m: PaymentMethodItem) => {
    setEditingId(m.id);
    setAddType(m.type);
    setAddLabel(m.label);
    // Clone so user edits don't mutate the list row prior to save.
    setAddDetails({ ...m.details });
    setFormError("");
    setShowAddForm(true);
    setExpanded(false);
  };

  // Auto-clear the "tap again to confirm" arming after a few seconds so a
  // forgotten arm doesn't fire a delete on a stray tap minutes later.
  useEffect(() => {
    if (!confirmDeleteId) return;
    const id = setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => clearTimeout(id);
  }, [confirmDeleteId]);

  const handleDelete = async (methodId: string) => {
    if (!userId) return;
    setDeletingId(methodId);
    try {
      const res = await fetchWithAuth(
        `/api/users/${userId}/payment-methods/${methodId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setMethods((prev) => prev.filter((m) => m.id !== methodId));
        // If the deleted one was selected, clear the selection so callers
        // don't render a stale chip.
        if (selectedId === methodId) onSelect(null);
      }
    } catch {
      // Best-effort — leave the row in place if the API call failed.
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const handleAdd = async () => {
    setFormError("");
    if (!addLabel.trim()) {
      setFormError("Label is required");
      return;
    }
    // Validate details per type
    if (addType === "bank") {
      if (!addDetails.bank_name || !addDetails.account_name) {
        setFormError("Bank name and account name are required");
        return;
      }
      if (!addDetails.account_number && !addDetails.iban) {
        setFormError("Account number or IBAN is required");
        return;
      }
      if (addDetails.iban && (addDetails.iban.length < 15 || addDetails.iban.length > 34)) {
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
      // Editing an existing method → PUT (label + details only). Creating a
      // new one → POST (with type). The server rejects `type` on PUT so we
      // omit it deliberately even though `addType` is still in state.
      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/users/${userId}/payment-methods/${editingId}`
        : `/api/users/${userId}/payment-methods`;
      const body = isEdit
        ? { label: addLabel.trim(), details: addDetails }
        : { type: addType, label: addLabel.trim(), details: addDetails };
      const res = await fetchWithAuth(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success && data.data) {
        if (isEdit) {
          setMethods((prev) => prev.map((m) => (m.id === data.data.id ? data.data : m)));
          // Keep the edited row selected if it already was.
          if (selectedId === data.data.id) onSelect(data.data);
        } else {
          setMethods((prev) => [data.data, ...prev]);
          onSelect(data.data);
        }
        resetForm();
        setShowAddForm(false);
        setExpanded(false);
      } else {
        // Map machine codes / HTTP status to friendly messages
        if (res.status === 401 || data.code === 'SESSION_EXPIRED') {
          setFormError('Your session has expired. Please log in again.');
        } else if (res.status === 403) {
          setFormError(data.error || "You don't have permission to do this.");
        } else if (res.status === 429) {
          setFormError('Too many requests. Please wait a moment and try again.');
        } else if (res.status >= 500) {
          setFormError('Server error. Please try again in a moment.');
        } else {
          setFormError(data.error || 'Failed to add payment method');
        }
      }
    } catch {
      setFormError("Network error. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const getSubtext = (m: PaymentMethodItem) => {
    if (m.type === "bank") {
      const accountNum =
        m.details.account_number || m.details.iban || "";
      const name = m.details.account_name || "";
      return [name, accountNum].filter(Boolean).join(" \u00B7 ");
    }
    if (m.type === "upi") return m.details.upi_id || "";
    if (m.type === "cash") return m.details.location_name || "";
    return m.details.method_name || m.details.account_identifier || "";
  };

  if (loading) {
    return (
      <div className="w-full rounded-2xl p-4 flex items-center justify-center gap-2"
        style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}>
        <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
        <span className="text-[13px] text-text-tertiary">Loading payment methods...</span>
      </div>
    );
  }

  return (
    <div
      className={
        groupContainer
          ? "w-full rounded-xl bg-white/[0.02] border border-white/[0.06] p-3"
          : "w-full"
      }
    >
      {!hideHeader && (
        <div className="flex items-center gap-2 mb-2">
          <CreditCard className="w-4 h-4 text-text-tertiary" />
          <span className="text-[12px] text-text-tertiary uppercase tracking-wide font-semibold">
            Your Payment Method
          </span>
        </div>
      )}

      {/* Selected method display / dropdown trigger — sized + styled to
          match the legacy Bank Accounts card row (ProfileScreen) so both
          render as visually identical sibling cards in the unified
          Payment Methods group container. */}
      {methods.length > 0 && !showAddForm && !alwaysExpanded && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full rounded-2xl px-4 py-3 flex items-start gap-3 text-left bg-surface-card border border-border-subtle"
        >
          {selected ? (
            <>
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: `${TYPE_CONFIG[selected.type].color}30` }}
              >
                {(() => {
                  const Ic = TYPE_CONFIG[selected.type].Icon;
                  return <Ic className="w-4 h-4" style={{ color: TYPE_CONFIG[selected.type].color }} />;
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-text-primary tracking-[-0.01em] truncate">{selected.label}</p>
                <p className="text-[11px] text-text-tertiary font-mono truncate">{getSubtext(selected)}</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-9 h-9 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
                <CreditCard className="w-4 h-4 text-text-tertiary" />
              </div>
              <p className="text-[14px] text-text-tertiary">Select a payment method</p>
            </>
          )}
          <ChevronDown
            className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}

      {/* Dropdown list */}
      <AnimatePresence>
        {(expanded || alwaysExpanded) && !showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-1 space-y-1 max-h-[240px] overflow-y-auto">
              {/* All methods listed — default / selected first (see
                  `sortedMethods` above) so users see their primary at a
                  glance. Selected gets a "Default" pill + check mark. */}
              {sortedMethods.map((m) => {
                const cfg = TYPE_CONFIG[m.type];
                const Ic = cfg.Icon;
                const armed = confirmDeleteId === m.id;
                const deleting = deletingId === m.id;
                const isSelected = m.id === selectedId;
                return (
                  <div
                    key={m.id}
                    className="w-full flex items-center gap-2 rounded-xl p-3 text-left transition-colors"
                    style={groupContainer ? {} : { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
                  >
                    <button
                      onClick={() => {
                        onSelect(m);
                        setExpanded(false);
                      }}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: `${cfg.color}30` }}
                      >
                        <Ic className="w-3.5 h-3.5" style={{ color: cfg.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-text-primary truncate flex items-center gap-1.5">
                          <span className="truncate">{m.label}</span>
                          {isSelected && (
                            <>
                              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/25">
                                Default
                              </span>
                              <Check className="w-3 h-3 text-success shrink-0" />
                            </>
                          )}
                          <span className="ml-1.5 text-[10px] text-text-secondary font-normal">
                            {cfg.label}
                          </span>
                        </p>
                        <p className="text-[11px] text-text-secondary truncate">{getSubtext(m)}</p>
                      </div>
                    </button>
                    {/* Edit — opens the form pre-filled with this method */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(m);
                      }}
                      aria-label="Edit payment method"
                      className="shrink-0 h-8 px-2 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {/* Two-tap delete — first tap arms, second confirms */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (armed) handleDelete(m.id);
                        else setConfirmDeleteId(m.id);
                      }}
                      disabled={deleting}
                      aria-label={armed ? "Confirm delete" : "Delete payment method"}
                      className={`shrink-0 h-8 px-2 rounded-lg flex items-center justify-center gap-1 transition-colors text-[11px] font-semibold ${
                        armed
                          ? "bg-error-dim text-error border border-error-border"
                          : "text-text-tertiary hover:text-error hover:bg-error-dim"
                      }`}
                    >
                      {deleting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : armed ? (
                        <>Confirm</>
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                );
              })}

              {/* Add new button */}
              <button
                onClick={() => { resetForm(); setShowAddForm(true); }}
                className="w-full flex items-center gap-3 rounded-xl p-3 text-left transition-colors"
                style={groupContainer ? {} : { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
              >
                <div className="w-8 h-8 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
                  <Plus className="w-3.5 h-3.5 text-text-tertiary" />
                </div>
                <span className="text-[13px] text-text-secondary font-medium">
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
          style={groupContainer ? {} : { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
        >
          <div className="w-9 h-9 rounded-lg bg-surface-hover flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 text-text-tertiary" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-text-primary">Add Payment Method</p>
            <p className="text-[12px] text-text-tertiary">
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
            style={groupContainer ? {} : { background: colors.surface.card, border: `1px solid ${colors.border.subtle}` }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-text-primary">
                {editingId ? "Edit Payment Method" : "Add Payment Method"}
              </span>
              <button
                onClick={() => { resetForm(); setShowAddForm(false); }}
                className="p-1 rounded-lg hover:bg-surface-hover"
              >
                <X className="w-4 h-4 text-text-tertiary" />
              </button>
            </div>

            {/* Type selector — locked while editing because the server's PUT
                schema does not accept `type`. Users who need a different type
                should delete and re-add. */}
            <div className="flex gap-1.5 mb-3">
              {(Object.keys(TYPE_CONFIG) as MethodType[]).map((t) => {
                const cfg = TYPE_CONFIG[t];
                const Ic = cfg.Icon;
                const active = addType === t;
                const disabled = editingId !== null && !active;
                return (
                  <button
                    key={t}
                    disabled={disabled}
                    title={disabled ? "Type can't be changed — delete and re-add to switch type" : undefined}
                    onClick={() => {
                      if (editingId) return;
                      setAddType(t); setAddDetails({}); setFormError("");
                    }}
                    className={`flex-1 flex flex-col items-center gap-1 rounded-lg py-2 transition-colors ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                    style={active
                      ? { background: colors.surface.active, border: `1px solid ${colors.border.medium}` }
                      : { background: colors.surface.glass }
                    }
                  >
                    <Ic className="w-3.5 h-3.5" style={{ color: active ? cfg.color : "var(--color-text-tertiary)" }} />
                    <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
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
                className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
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
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.account_name || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, account_name: e.target.value })}
                    placeholder="Account Holder Name"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.account_number || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, account_number: e.target.value })}
                    placeholder="Account Number"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono placeholder:text-text-primary/25 placeholder:font-sans outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.ifsc || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, ifsc: e.target.value.toUpperCase() })}
                    placeholder="IFSC / SWIFT code — optional"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono placeholder:text-text-primary/25 placeholder:font-sans outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.iban || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, iban: e.target.value.toUpperCase() })}
                    placeholder="IBAN — optional (for international transfers)"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono placeholder:text-text-primary/25 placeholder:font-sans outline-none focus:ring-1 focus:ring-border-strong"
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
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary font-mono placeholder:text-text-primary/25 placeholder:font-sans outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.provider || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, provider: e.target.value })}
                    placeholder="Provider (e.g. Google Pay, PhonePe) — optional"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
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
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.location_address || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, location_address: e.target.value })}
                    placeholder="Address"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.meeting_instructions || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, meeting_instructions: e.target.value })}
                    placeholder="Meeting instructions — optional"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
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
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.account_identifier || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, account_identifier: e.target.value })}
                    placeholder="Account ID / Email / Phone"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                  <input
                    type="text"
                    value={addDetails.instructions || ""}
                    onChange={(e) => setAddDetails({ ...addDetails, instructions: e.target.value })}
                    placeholder="Instructions — optional"
                    className="w-full rounded-lg px-3 py-2.5 text-[13px] text-text-primary placeholder:text-text-primary/25 outline-none focus:ring-1 focus:ring-border-strong"
                    style={{ background: colors.surface.card }}
                  />
                </>
              )}

              {formError && (
                <p className="text-[12px] text-error">{formError}</p>
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
                ) : editingId ? (
                  <>
                    <Check className="w-4 h-4" />
                    Save Changes
                  </>
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
