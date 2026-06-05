'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Banknote,
  Building2,
  Check,
  ChevronRight,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  Smartphone,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useUserPaymentMethods } from '@/context/AppContext';
import { useUserTheme } from '@/hooks/useUserTheme';
import type { PaymentMethodItem } from './PaymentMethodSelector';

interface PaymentMethodsManagerProps {
  userId: string | null;
}

const TYPE_CONFIG = {
  bank:  { Icon: Building2,  label: 'Bank',  color: 'var(--color-info)' },
  upi:   { Icon: Smartphone, label: 'UPI',   color: 'var(--color-success)' },
  cash:  { Icon: Banknote,   label: 'Cash',  color: 'var(--color-warning)' },
  other: { Icon: CreditCard, label: 'Other', color: 'var(--color-text-secondary)' },
} as const;

type MethodType = keyof typeof TYPE_CONFIG;

type FormMode = { kind: 'closed' } | { kind: 'add' } | { kind: 'edit'; method: PaymentMethodItem };

/**
 * Profile-screen "Payment Methods" manager.
 *
 * Unlike PaymentMethodSelector (used in trade flows as a dropdown picker)
 * this renders the full list inline as one grouped card, surfaces the
 * default at the top with a "Default" pill, exposes per-row star/edit/
 * delete actions, and opens add/edit in a centered modal sheet.
 *
 * Wire-compatible with the same /api/users/[id]/payment-methods routes —
 * adds one new dependency: PUT /payment-methods/[methodId]/default.
 */
export function PaymentMethodsManager({ userId }: PaymentMethodsManagerProps) {
  // Seed from the login-time preload so the profile list shows instantly with
  // no loading flash; refresh() still runs as a background sync + fallback.
  const { paymentMethods: preloaded, paymentMethodsLoaded, fetchPaymentMethods: syncPreloaded } = useUserPaymentMethods();
  const [methods, setMethods] = useState<PaymentMethodItem[]>(preloaded);
  const [loading, setLoading] = useState(!paymentMethodsLoaded);

  // Per-row pending states so several rows can be acted on without their
  // spinners stomping on each other.
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [form, setForm] = useState<FormMode>({ kind: 'closed' });

  const refresh = useCallback(async () => {
    if (!userId) return;
    // Only show the loading state when there's nothing preloaded to display.
    if (!paymentMethodsLoaded) setLoading(true);
    try {
      const res = await fetchWithAuth(`/api/users/${userId}/payment-methods`);
      const data = await res.json();
      if (data?.success && Array.isArray(data.data)) {
        setMethods(data.data);
      }
    } catch {
      /* leave previous list in place */
    } finally {
      setLoading(false);
    }
  }, [userId, paymentMethodsLoaded]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-disarm the two-tap delete confirmation after 4 seconds.
  useEffect(() => {
    if (!confirmDeleteId) return;
    const id = setTimeout(() => setConfirmDeleteId(null), 4000);
    return () => clearTimeout(id);
  }, [confirmDeleteId]);

  const handleSetDefault = async (method: PaymentMethodItem) => {
    if (!userId || method.is_default) return;
    setSettingDefaultId(method.id);
    try {
      const res = await fetchWithAuth(
        `/api/users/${userId}/payment-methods/${method.id}/default`,
        { method: 'PUT' },
      );
      const data = await res.json();
      if (data?.success) {
        setMethods((prev) =>
          [...prev]
            .map((m) => ({ ...m, is_default: m.id === method.id }))
            .sort((a, b) => Number(b.is_default ?? false) - Number(a.is_default ?? false)),
        );
        void syncPreloaded(userId ?? undefined);
      }
    } catch {
      /* swallow — next refresh will reconcile */
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleDelete = async (methodId: string) => {
    if (!userId) return;
    setDeletingId(methodId);
    try {
      const res = await fetchWithAuth(
        `/api/users/${userId}/payment-methods/${methodId}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        setMethods((prev) => prev.filter((m) => m.id !== methodId));
        void syncPreloaded(userId ?? undefined);
      }
    } catch {
      /* leave the row in place */
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  };

  const closeForm = () => setForm({ kind: 'closed' });

  const onFormSaved = (saved: PaymentMethodItem) => {
    setMethods((prev) => {
      const exists = prev.some((m) => m.id === saved.id);
      const next = exists
        ? prev.map((m) => (m.id === saved.id ? saved : m))
        : [saved, ...prev];
      // Keep default-first ordering after edits.
      return [...next].sort(
        (a, b) => Number(b.is_default ?? false) - Number(a.is_default ?? false),
      );
    });
    // Keep the login-time cache fresh so other screens stay consistent.
    void syncPreloaded();
    closeForm();
  };

  if (!userId) return null;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5 text-white/40" />
          <span className="text-[10px] font-bold tracking-[0.22em] text-text-secondary-strong uppercase">
            Payment Methods
          </span>
        </div>
        <button
          type="button"
          onClick={() => setForm({ kind: 'add' })}
          aria-label="Add payment method"
          className="h-7 px-2.5 flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-[10.5px] font-bold tracking-[0.04em] uppercase text-white/80 hover:bg-white/[0.10] transition"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      <div className="rounded-[20px] overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.025)_0%,rgba(255,255,255,0.015)_100%)] border border-white/[0.07] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)] divide-y divide-white/[0.05]">
        {loading && methods.length === 0 && (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12px] text-white/45">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading payment methods…
          </div>
        )}

        {!loading && methods.length === 0 && (
          <button
            type="button"
            onClick={() => setForm({ kind: 'add' })}
            className="w-full px-4 py-5 flex items-center gap-3 text-left hover:bg-white/[0.025] transition"
          >
            <span className="w-9 h-9 rounded-[11px] flex items-center justify-center bg-white/[0.04] border border-white/[0.06] text-white/55">
              <Plus className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-semibold text-white/95">
                Add a payment method
              </span>
              <span className="mt-0.5 block text-[11.5px] text-white/45">
                Required to receive fiat from buyers
              </span>
            </span>
            <ChevronRight className="w-[15px] h-[15px] text-white/30" />
          </button>
        )}

        {methods.map((m) => {
          const cfg = TYPE_CONFIG[m.type];
          const Icon = cfg.Icon;
          const isDefault = !!m.is_default;
          const isSettingDefault = settingDefaultId === m.id;
          const isDeleting = deletingId === m.id;
          const isArmed = confirmDeleteId === m.id;
          return (
            <div key={m.id} className="px-4 py-3.5 flex items-center gap-3">
              <span
                className="w-9 h-9 shrink-0 rounded-[11px] flex items-center justify-center border border-white/[0.06] shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]"
                style={{ background: `color-mix(in srgb, ${cfg.color} 12%, transparent)` }}
              >
                <Icon className="w-4 h-4" style={{ color: cfg.color }} />
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[14px] font-semibold tracking-[-0.01em] text-white/95 truncate">
                    {m.label}
                  </span>
                  {isDefault && (
                    <span className="shrink-0 inline-flex items-center gap-1 h-[18px] px-1.5 rounded-full text-[9px] font-bold tracking-[0.06em] uppercase text-emerald-300/95 bg-emerald-400/[0.10] border border-emerald-400/20">
                      <Star className="w-2.5 h-2.5 fill-current" />
                      Default
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11.5px] text-white/45 truncate font-mono">
                  {getSubtext(m)}
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!isDefault && (
                  <button
                    type="button"
                    onClick={() => handleSetDefault(m)}
                    disabled={isSettingDefault}
                    aria-label="Set as default"
                    title="Set as default"
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white/40 hover:text-emerald-300 hover:bg-white/[0.04] transition disabled:opacity-50"
                  >
                    {isSettingDefault ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Star className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setForm({ kind: 'edit', method: m })}
                  aria-label="Edit payment method"
                  className="w-8 h-8 rounded-[10px] flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.04] transition"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => (isArmed ? handleDelete(m.id) : setConfirmDeleteId(m.id))}
                  disabled={isDeleting}
                  aria-label={isArmed ? 'Confirm delete' : 'Delete payment method'}
                  className={`h-8 px-2 rounded-[10px] flex items-center justify-center gap-1 transition text-[11px] font-semibold ${
                    isArmed
                      ? 'bg-red-500/[0.10] text-red-300 border border-red-500/20'
                      : 'text-white/40 hover:text-red-300 hover:bg-red-500/[0.08]'
                  }`}
                >
                  {isDeleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isArmed ? (
                    'Confirm'
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <PaymentMethodFormSheet
        mode={form}
        userId={userId}
        onClose={closeForm}
        onSaved={onFormSaved}
      />
    </section>
  );
}

function getSubtext(m: PaymentMethodItem) {
  if (m.type === 'bank') {
    const account = m.details.account_number || m.details.iban || '';
    const name = m.details.account_name || '';
    return [name, account].filter(Boolean).join(' · ');
  }
  if (m.type === 'upi') return m.details.upi_id || '';
  if (m.type === 'cash') return m.details.location_name || '';
  return m.details.method_name || m.details.account_identifier || '';
}

// ─── Form sheet ─────────────────────────────────────────────────────────

interface FormSheetProps {
  mode: FormMode;
  userId: string;
  onClose: () => void;
  onSaved: (saved: PaymentMethodItem) => void;
}

function PaymentMethodFormSheet({ mode, userId, onClose, onSaved }: FormSheetProps) {
  const { theme: userTheme } = useUserTheme();
  const isLight = userTheme === 'light';
  const open = mode.kind !== 'closed';
  const editing = mode.kind === 'edit' ? mode.method : null;

  const [type, setType] = useState<MethodType>('bank');
  const [label, setLabel] = useState('');
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset / hydrate when the mode flips. Keeps the form state synced with
  // whichever row the user tapped without leaking previous values.
  useEffect(() => {
    if (mode.kind === 'closed') return;
    if (mode.kind === 'edit') {
      setType(mode.method.type);
      setLabel(mode.method.label);
      setDetails({ ...mode.method.details });
    } else {
      setType('bank');
      setLabel('');
      setDetails({});
    }
    setError('');
  }, [mode]);

  const handleSubmit = async () => {
    setError('');
    if (!label.trim()) {
      setError('Label is required');
      return;
    }
    if (type === 'bank') {
      if (!details.bank_name || !details.account_name) {
        setError('Bank name and account name are required');
        return;
      }
      if (!details.account_number && !details.iban) {
        setError('Account number or IBAN is required');
        return;
      }
      if (details.iban && (details.iban.length < 15 || details.iban.length > 34)) {
        setError('IBAN must be 15-34 characters');
        return;
      }
    }
    if (type === 'upi' && !details.upi_id) {
      setError('UPI ID is required');
      return;
    }

    setSaving(true);
    try {
      const isEdit = editing !== null;
      const url = isEdit
        ? `/api/users/${userId}/payment-methods/${editing.id}`
        : `/api/users/${userId}/payment-methods`;
      const body = isEdit
        ? { label: label.trim(), details }
        : { type, label: label.trim(), details };
      const res = await fetchWithAuth(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data?.success && data.data) {
        onSaved(data.data);
        return;
      }
      if (res.status === 401 || data?.code === 'SESSION_EXPIRED') {
        setError('Your session has expired. Please log in again.');
      } else if (res.status === 403) {
        setError(data?.error || "You don't have permission to do this.");
      } else if (res.status === 429) {
        setError('Too many requests. Please wait a moment and try again.');
      } else if (res.status >= 500) {
        setError('Server error. Please try again in a moment.');
      } else {
        setError(data?.error || 'Failed to save payment method');
      }
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // z-[55]: above the BottomNav (z-50) so the nav is dimmed behind
            // the backdrop while this sheet is open (it shares the Profile
            // Panel's stacking context, so an equal z-index let the nav paint
            // over the sheet's save button).
            className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[55]"
            onClick={onClose}
          />
          <motion.div
            key="sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 36, stiffness: 380 }}
            className="fixed inset-x-0 bottom-0 z-[60] flex justify-center pointer-events-none"
          >
            <div
              className="pointer-events-auto w-full max-w-[440px] md:max-w-[720px] max-h-[92dvh] overflow-y-auto rounded-t-[24px] shadow-[0_-20px_60px_-12px_rgba(0,0,0,0.5)]"
              style={{
                background: isLight
                  ? 'linear-gradient(180deg,#ffffff 0%,#f7f8fa 100%)'
                  : 'linear-gradient(180deg,rgba(28,28,32,0.98) 0%,rgba(18,18,22,0.98) 100%)',
                border: `1px solid ${isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.08)'}`,
                borderBottom: 'none',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle — bottom-sheet affordance */}
              <div className="flex justify-center pt-3 pb-1">
                <span
                  className="block w-9 h-1 rounded-full"
                  style={{ background: isLight ? 'rgba(15,23,42,0.18)' : 'rgba(255,255,255,0.18)' }}
                />
              </div>
              <div
                className="flex items-center justify-between px-5 py-4"
                style={{ borderBottom: `1px solid ${isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.06)'}` }}
              >
                <p
                  className="text-[15px] font-bold tracking-[-0.01em]"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {editing ? 'Edit Payment Method' : 'Add Payment Method'}
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-[10px] flex items-center justify-center transition-colors"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-3">
                {/* Type selector — locked during edit (server PUT rejects `type`). */}
                <div className="flex gap-1.5">
                  {(Object.keys(TYPE_CONFIG) as MethodType[]).map((t) => {
                    const cfg = TYPE_CONFIG[t];
                    const Icon = cfg.Icon;
                    const active = type === t;
                    const disabled = editing !== null && !active;
                    const activeBg = isLight ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.06)';
                    const activeBorder = isLight ? 'rgba(15,23,42,0.16)' : 'rgba(255,255,255,0.14)';
                    const idleBg = isLight ? 'rgba(15,23,42,0.025)' : 'rgba(255,255,255,0.02)';
                    const idleBorder = isLight ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.05)';
                    const idleIcon = isLight ? 'rgba(15,23,42,0.45)' : 'rgba(255,255,255,0.45)';
                    return (
                      <button
                        key={t}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (editing) return;
                          setType(t);
                          setDetails({});
                          setError('');
                        }}
                        className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-[10px] border transition ${
                          disabled ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                        style={{
                          background: active ? activeBg : idleBg,
                          borderColor: active ? activeBorder : idleBorder,
                        }}
                      >
                        <Icon
                          className="w-3.5 h-3.5"
                          style={{ color: active ? cfg.color : idleIcon }}
                        />
                        <span
                          className="text-[9px] font-bold tracking-[0.08em] uppercase"
                          style={{
                            color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                          }}
                        >
                          {cfg.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <FormInput
                  value={label}
                  onChange={setLabel}
                  placeholder="Label (e.g. Emirates NBD — Salary)"
                  maxLength={100}
                  isLight={isLight}
                />

                {type === 'bank' && (
                  <>
                    <FormInput
                      value={details.bank_name || ''}
                      onChange={(v) => setDetails({ ...details, bank_name: v })}
                      placeholder="Bank Name"
                      maxLength={100}
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.account_name || ''}
                      onChange={(v) => setDetails({ ...details, account_name: v })}
                      placeholder="Account Holder Name"
                      maxLength={100}
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.account_number || ''}
                      onChange={(v) => setDetails({ ...details, account_number: v })}
                      placeholder="Account Number"
                      maxLength={34}
                      mono
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.ifsc || ''}
                      onChange={(v) =>
                        setDetails({ ...details, ifsc: v.toUpperCase() })
                      }
                      placeholder="IFSC / SWIFT — optional"
                      maxLength={20}
                      mono
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.iban || ''}
                      onChange={(v) =>
                        setDetails({ ...details, iban: v.toUpperCase() })
                      }
                      placeholder="IBAN — optional"
                      maxLength={34}
                      mono
                      isLight={isLight}
                    />
                  </>
                )}

                {type === 'upi' && (
                  <>
                    <FormInput
                      value={details.upi_id || ''}
                      onChange={(v) => setDetails({ ...details, upi_id: v })}
                      placeholder="UPI ID (e.g. user@oksbi)"
                      maxLength={50}
                      mono
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.provider || ''}
                      onChange={(v) => setDetails({ ...details, provider: v })}
                      placeholder="Provider — optional (e.g. Google Pay)"
                      maxLength={50}
                      isLight={isLight}
                    />
                  </>
                )}

                {type === 'cash' && (
                  <>
                    <FormInput
                      value={details.location_name || ''}
                      onChange={(v) => setDetails({ ...details, location_name: v })}
                      placeholder="Location Name"
                      maxLength={100}
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.location_address || ''}
                      onChange={(v) => setDetails({ ...details, location_address: v })}
                      placeholder="Address"
                      maxLength={200}
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.meeting_instructions || ''}
                      onChange={(v) => setDetails({ ...details, meeting_instructions: v })}
                      placeholder="Meeting instructions — optional"
                      maxLength={200}
                      isLight={isLight}
                    />
                  </>
                )}

                {type === 'other' && (
                  <>
                    <FormInput
                      value={details.method_name || ''}
                      onChange={(v) => setDetails({ ...details, method_name: v })}
                      placeholder="Method Name (e.g. Wise, PayPal)"
                      maxLength={50}
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.account_identifier || ''}
                      onChange={(v) => setDetails({ ...details, account_identifier: v })}
                      placeholder="Account ID / Email / Phone"
                      maxLength={100}
                      isLight={isLight}
                    />
                    <FormInput
                      value={details.instructions || ''}
                      onChange={(v) => setDetails({ ...details, instructions: v })}
                      placeholder="Instructions — optional"
                      maxLength={200}
                      isLight={isLight}
                    />
                  </>
                )}

                {error && (
                  <p className="text-[12px] text-red-300/95">{error}</p>
                )}
              </div>

              <div className="px-5 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSubmit}
                  disabled={saving}
                  className="w-full h-11 rounded-[12px] flex items-center justify-center gap-2 text-[14px] font-bold tracking-[-0.01em] bg-accent text-accent-text disabled:opacity-50"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : editing ? (
                    <>
                      <Check className="w-4 h-4" />
                      Save Changes
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Save & Add
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function FormInput({
  value,
  onChange,
  placeholder,
  maxLength,
  mono = false,
  isLight = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  maxLength: number;
  mono?: boolean;
  isLight?: boolean;
}) {
  const bg = isLight ? 'rgba(15,23,42,0.04)' : 'rgba(255,255,255,0.04)';
  const border = isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.06)';
  const focusBorder = isLight ? 'rgba(15,23,42,0.25)' : 'rgba(255,255,255,0.18)';
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className={`w-full rounded-[10px] px-3 py-2.5 text-[13px] outline-none transition placeholder:text-text-tertiary ${
        mono ? 'font-mono placeholder:font-sans' : ''
      }`}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        color: 'var(--color-text-primary)',
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = focusBorder;
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = border;
      }}
    />
  );
}
