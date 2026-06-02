"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Plus,
  Building2,
  Wallet,
  CreditCard,
  DollarSign,
  Check,
  Loader2,
  AlertCircle,
  Trash2,
  Star,
  Smartphone,
  Pencil,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { useOnboarding } from "@/contexts/OnboardingContext";

export interface PaymentMethod {
  id: string;
  type: "bank" | "upi" | "cash" | "crypto" | "card" | "mobile";
  name: string;
  details: string;
  is_default: boolean;
}

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
  // When set, the modal opens directly into the rich edit form for this
  // method (skipping the list). Type chips are locked while editing.
  editingMethod?: PaymentMethod | null;
}

type FormData = {
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  swiftCode: string;
  location: string;
  walletAddress: string;
  cardNumber: string;
  cardholderName: string;
  mobileNumber: string;
  mobileProvider: string;
  upiId: string;
  upiProvider: string;
};

const EMPTY_FORM: FormData = {
  bankName: "",
  accountName: "",
  accountNumber: "",
  iban: "",
  swiftCode: "",
  location: "",
  walletAddress: "",
  cardNumber: "",
  cardholderName: "",
  mobileNumber: "",
  mobileProvider: "",
  upiId: "",
  upiProvider: "",
};

// Inverse of the composition that happens in handleSaveMethod when a method
// is saved. Methods are stored as `{name, details}` strings, so to put their
// values back into the rich form we have to parse the composed details string
// using the format the writer used. If parsing fails (older row, unexpected
// shape, manual edit), we fall back to leaving the field empty so the user
// can re-enter it — never throw.
function parseDetailsForEdit(method: PaymentMethod): FormData {
  const f = { ...EMPTY_FORM };
  switch (method.type) {
    case "bank": {
      // name = bankName; details = `${accountName} - ${accountNumber} (IBAN)`
      f.bankName = method.name;
      const ibanMatch = method.details.match(/\(([^)]+)\)\s*$/);
      const withoutIban = method.details.replace(/\s*\([^)]+\)\s*$/, "");
      if (ibanMatch) f.iban = ibanMatch[1].trim();
      const dashIdx = withoutIban.lastIndexOf(" - ");
      if (dashIdx >= 0) {
        f.accountName = withoutIban.slice(0, dashIdx).trim();
        f.accountNumber = withoutIban.slice(dashIdx + 3).trim();
      } else {
        f.accountName = withoutIban.trim();
      }
      break;
    }
    case "cash":
      // name = "Cash Meeting" (constant); details = location
      f.location = method.details;
      break;
    case "crypto":
      // name = "Crypto Wallet" (constant); details = walletAddress
      f.walletAddress = method.details;
      break;
    case "card": {
      // name = "Card Payment"; details = `${cardholderName} - **** ${last4}`
      const m = method.details.match(/^(.*?)\s*-\s*\*+\s*(\d{4})\s*$/);
      if (m) {
        f.cardholderName = m[1].trim();
        f.cardNumber = m[2];
      } else {
        f.cardholderName = method.details;
      }
      break;
    }
    case "mobile":
      // name = mobileProvider; details = mobileNumber
      f.mobileProvider = method.name;
      f.mobileNumber = method.details;
      break;
    case "upi": {
      // name = upiProvider (or "UPI"); details = `${upiId}` optionally `${upiId} (provider)`
      // If name === "UPI" we treat it as no explicit provider.
      f.upiProvider = method.name === "UPI" ? "" : method.name;
      const provMatch = method.details.match(/\(([^)]+)\)\s*$/);
      const idPart = method.details.replace(/\s*\([^)]+\)\s*$/, "").trim();
      f.upiId = idPart;
      if (provMatch && !f.upiProvider) f.upiProvider = provMatch[1].trim();
      break;
    }
  }
  return f;
}

const PAYMENT_METHOD_TYPES = [
  {
    type: "bank" as const,
    label: "Bank Account",
    desc: "Wire & local transfers",
    icon: Building2,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/70",
    ring: "ring-white/20",
  },

  {
    type: "upi" as const,
    label: "UPI",
    desc: "Instant India payments",
    icon: Smartphone,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/70",
    ring: "ring-white/20",
  },
  {
    type: "cash" as const,
    label: "Cash Meeting",
    desc: "In-person exchange",
    icon: DollarSign,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/70",
    ring: "ring-white/20",
  },
  {
    type: "card" as const,
    label: "Card Payment",
    desc: "Debit or credit card",
    icon: CreditCard,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/70",
    ring: "ring-white/20",
  },
  {
    type: "mobile" as const,
    label: "Mobile Money",
    desc: "Digital wallet apps",
    icon: Smartphone,
    gradient: "from-white/[0.06] to-white/[0.02]",
    border: "border-white/[0.12]",
    text: "text-white/70",
    ring: "ring-white/20",
  },
];

const inputClass =
  "w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/10 transition-all";

// Per-field validation. Rejects junk like "kdnfsnjakmokpdijjnewoekfwpolm..."
// or a 40-digit "account number". Length caps match the server (route.ts)
// so the same rules apply whether the input comes from this modal or anywhere
// else. Keep patterns permissive enough for real-world inputs (Arabic/Hindi
// names transliterated, bank names with & . - ' ( ) / etc.).
const NAME_RE = /^[A-Za-z0-9 &.,'\-()/]{2,60}$/;
const PERSON_RE = /^[A-Za-z .'\-]{2,60}$/;
const DIGITS_RE = /^\d+$/;
const IBAN_RE = /^[A-Z0-9]{15,34}$/;
const SWIFT_RE = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;
const WALLET_RE = /^[A-Za-z0-9]{20,100}$/;
const PHONE_RE = /^\+?\d{7,15}$/;
// UPI handle (VPA) — `localpart@psp`. NPCI spec is permissive; we keep it
// strict enough to reject obvious junk but allow real-world handles like
// `user.name@oksbi`, `9876543210@upi`, `abc-1@axl`.
const UPI_RE = /^[A-Za-z0-9.\-_]{2,50}@[A-Za-z][A-Za-z0-9.\-]{1,30}$/;

function trimAll<T extends Record<string, string>>(obj: T): T {
  const out: Record<string, string> = {};
  for (const k of Object.keys(obj)) out[k] = String(obj[k] ?? "").trim();
  return out as T;
}

function validateBank(f: {
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  swiftCode: string;
}): string | null {
  if (!NAME_RE.test(f.bankName))
    return "Bank name must be 2–60 chars (letters, numbers, basic punctuation).";
  if (!PERSON_RE.test(f.accountName))
    return "Account holder name must be 2–60 letters.";
  if (
    !DIGITS_RE.test(f.accountNumber) ||
    f.accountNumber.length < 4 ||
    f.accountNumber.length > 24
  ) {
    return "Account number must be 4–24 digits.";
  }
  if (f.iban && !IBAN_RE.test(f.iban.toUpperCase()))
    return "IBAN must be 15–34 uppercase letters/digits.";
  if (f.swiftCode && !SWIFT_RE.test(f.swiftCode.toUpperCase()))
    return "SWIFT code must be 8 or 11 letters/digits.";
  return null;
}
function validateCrypto(addr: string): string | null {
  if (!WALLET_RE.test(addr))
    return "Wallet address must be 20–100 alphanumeric characters.";
  return null;
}
function validateCard(f: {
  cardholderName: string;
  cardNumber: string;
}): string | null {
  if (!PERSON_RE.test(f.cardholderName))
    return "Cardholder name must be 2–60 letters.";
  if (!DIGITS_RE.test(f.cardNumber) || f.cardNumber.length !== 4)
    return "Enter the last 4 digits of the card.";
  return null;
}
function validateMobile(f: {
  mobileProvider: string;
  mobileNumber: string;
}): string | null {
  if (f.mobileProvider.length < 2 || f.mobileProvider.length > 30)
    return "Provider name must be 2–30 chars.";
  if (!PHONE_RE.test(f.mobileNumber))
    return "Mobile number must be 7–15 digits (optional leading +).";
  return null;
}
function validateCash(location: string): string | null {
  if (location.length < 5 || location.length > 120)
    return "Location must be 5–120 characters.";
  return null;
}
function validateUpi(f: {
  upiId: string;
  upiProvider: string;
}): string | null {
  if (!UPI_RE.test(f.upiId))
    return "UPI ID must look like name@psp (e.g., user@oksbi).";
  if (f.upiProvider && (f.upiProvider.length < 2 || f.upiProvider.length > 30))
    return "Provider name must be 2–30 chars.";
  return null;
}

export function PaymentMethodModal({
  isOpen,
  onClose,
  merchantId,
  editingMethod,
}: PaymentMethodModalProps) {
  const { refresh } = useOnboarding();
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedType, setSelectedType] = useState<
    "bank" | "cash" | "crypto" | "card" | "mobile" | "upi"
  >("bank");
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode. When set, the form acts as an editor for that method (PUT)
  // instead of a creator (POST). The type is locked because changing it
  // requires re-validating details against a different shape and could
  // collide with the unique-default-method constraint when defaults move.
  // `editingId` may be set either via the `editingMethod` prop (parent
  // opened us in edit mode) or by clicking the Pencil on a row inside the
  // modal's own list — both paths converge here.
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);

  // Fetch existing payment methods from API
  const fetchMethods = useCallback(async () => {
    if (!merchantId) return;
    setIsFetching(true);
    try {
      const res = await fetchWithAuth(
        `/api/merchant/${merchantId}/payment-methods`,
      );
      const json = await res.json();
      if (json.success && json.data) {
        setPaymentMethods(
          json.data.map((m: any) => ({
            id: m.id,
            type: m.type,
            name: m.name,
            details: m.details,
            is_default: m.is_default,
          })),
        );
      }
    } catch {
      // Silent fail on load — user will see empty list
    } finally {
      setIsFetching(false);
    }
  }, [merchantId]);

  // Load methods when modal opens
  useEffect(() => {
    if (isOpen && merchantId) {
      fetchMethods();
    }
  }, [isOpen, merchantId, fetchMethods]);

  // When the parent opens us in edit mode (editingMethod prop), drop into
  // the rich form pre-filled with the method's parsed values. We mirror
  // this for in-modal Pencil clicks via `startEdit` below — both paths land
  // on the same form so the UX is identical.
  useEffect(() => {
    if (!isOpen) return;
    if (editingMethod) {
      setEditingId(editingMethod.id);
      setSelectedType(editingMethod.type);
      setFormData(parseDetailsForEdit(editingMethod));
      setShowAddForm(true);
      setError(null);
    }
  }, [isOpen, editingMethod]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setError(null);
    setEditingId(null);
  };

  const startEdit = (m: PaymentMethod) => {
    setEditingId(m.id);
    setSelectedType(m.type);
    setFormData(parseDetailsForEdit(m));
    setShowAddForm(true);
    setError(null);
  };

  const handleSaveMethod = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Trim before validating so trailing spaces don't squeak past length caps.
      const f = trimAll(formData);
      let name = "";
      let details = "";

      switch (selectedType) {
        case "bank": {
          if (!f.bankName || !f.accountName || !f.accountNumber) {
            throw new Error("Please fill in all bank details");
          }
          const err = validateBank({
            bankName: f.bankName,
            accountName: f.accountName,
            accountNumber: f.accountNumber,
            iban: f.iban,
            swiftCode: f.swiftCode,
          });
          if (err) throw new Error(err);
          name = f.bankName;
          details = `${f.accountName} - ${f.accountNumber}`;
          if (f.iban) details += ` (${f.iban.toUpperCase()})`;
          break;
        }
        case "cash": {
          if (!f.location) throw new Error("Please specify meeting location");
          const err = validateCash(f.location);
          if (err) throw new Error(err);
          name = "Cash Meeting";
          details = f.location;
          break;
        }
        case "crypto": {
          if (!f.walletAddress)
            throw new Error("Please provide wallet address");
          const err = validateCrypto(f.walletAddress);
          if (err) throw new Error(err);
          name = "Crypto Wallet";
          details = f.walletAddress;
          break;
        }
        case "card": {
          if (!f.cardNumber || !f.cardholderName)
            throw new Error("Please provide card details");
          const err = validateCard({
            cardholderName: f.cardholderName,
            cardNumber: f.cardNumber,
          });
          if (err) throw new Error(err);
          name = "Card Payment";
          details = `${f.cardholderName} - **** ${f.cardNumber.slice(-4)}`;
          break;
        }
        case "mobile": {
          if (!f.mobileNumber || !f.mobileProvider)
            throw new Error("Please provide mobile payment details");
          const err = validateMobile({
            mobileProvider: f.mobileProvider,
            mobileNumber: f.mobileNumber,
          });
          if (err) throw new Error(err);
          name = f.mobileProvider;
          details = f.mobileNumber;
          break;
        }
        case "upi": {
          if (!f.upiId) throw new Error("Please provide your UPI ID");
          const err = validateUpi({
            upiId: f.upiId,
            upiProvider: f.upiProvider,
          });
          if (err) throw new Error(err);
          name = f.upiProvider || "UPI";
          details = f.upiProvider
            ? `${f.upiId} (${f.upiProvider})`
            : f.upiId;
          break;
        }
      }

      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/merchant/${merchantId}/payment-methods/${editingId}`
        : `/api/merchant/${merchantId}/payment-methods`;
      // Editing only sends `name` + `details`; the server's PUT route does
      // not accept `type` (locked) or `is_default` (separate PATCH).
      const body: Record<string, unknown> = isEdit
        ? { name, details }
        : {
            type: selectedType,
            name,
            details,
            is_default: paymentMethods.length === 0,
          };

      const res = await fetchWithAuth(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(
          json.error ||
            (Array.isArray(json.errors)
              ? json.errors.join(", ")
              : "Failed to save payment method"),
        );
      }

      const saved = json.data;
      if (isEdit) {
        setPaymentMethods((prev) =>
          prev.map((m) =>
            m.id === saved.id
              ? { ...m, name: saved.name, details: saved.details }
              : m,
          ),
        );
      } else {
        setPaymentMethods([
          ...paymentMethods,
          {
            id: saved.id,
            type: saved.type,
            name: saved.name,
            details: saved.details,
            is_default: saved.is_default,
          },
        ]);
      }
      void refresh();
      resetForm();
      setShowAddForm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save payment method",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMethod = async (id: string) => {
    try {
      const res = await fetchWithAuth(
        `/api/merchant/${merchantId}/payment-methods?method_id=${id}`,
        {
          method: "DELETE",
        },
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods(paymentMethods.filter((m) => m.id !== id));
      }
    } catch {
      // Silent fail — method stays in UI
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetchWithAuth(
        `/api/merchant/${merchantId}/payment-methods`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method_id: id }),
        },
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods(
          paymentMethods.map((m) => ({ ...m, is_default: m.id === id })),
        );
      }
    } catch {
      // Silent fail
    }
  };

  const selectedTypeInfo = PAYMENT_METHOD_TYPES.find(
    (t) => t.type === selectedType,
  )!;

  const renderFormFields = () => {
    switch (selectedType) {
      case "bank":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Bank Name (e.g., Emirates NBD)"
              value={formData.bankName}
              maxLength={60}
              onChange={(e) =>
                setFormData({ ...formData, bankName: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Account Holder Name"
              value={formData.accountName}
              maxLength={60}
              onChange={(e) =>
                setFormData({ ...formData, accountName: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              placeholder="Account Number (4–24 digits)"
              value={formData.accountNumber}
              maxLength={24}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  accountNumber: e.target.value.replace(/\D/g, ""),
                })
              }
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="IBAN (Optional)"
                value={formData.iban}
                maxLength={34}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    iban: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ""),
                  })
                }
                className={inputClass}
              />
              <input
                type="text"
                placeholder="SWIFT Code (Optional)"
                value={formData.swiftCode}
                maxLength={11}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    swiftCode: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ""),
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
        );
      case "upi":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="UPI ID (e.g., user@oksbi)"
              value={formData.upiId}
              maxLength={50}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  // No spaces inside a VPA; lowercase the PSP half is
                  // conventional but we accept either to stay forgiving.
                  upiId: e.target.value.replace(/\s+/g, ""),
                })
              }
              className={`${inputClass} font-mono`}
            />
            <input
              type="text"
              placeholder="Provider (Optional, e.g., Google Pay)"
              value={formData.upiProvider}
              maxLength={30}
              onChange={(e) =>
                setFormData({ ...formData, upiProvider: e.target.value })
              }
              className={inputClass}
            />
          </div>
        );
      case "cash":
        return (
          <textarea
            placeholder="Meeting Location (e.g., Dubai Mall, Burj Khalifa entrance)"
            value={formData.location}
            maxLength={120}
            onChange={(e) =>
              setFormData({ ...formData, location: e.target.value })
            }
            rows={3}
            className={`${inputClass} resize-none`}
          />
        );
      case "crypto":
        return (
          <input
            type="text"
            placeholder="Wallet Address (e.g., 0x...)"
            value={formData.walletAddress}
            maxLength={100}
            onChange={(e) =>
              setFormData({
                ...formData,
                walletAddress: e.target.value.replace(/[^A-Za-z0-9]/g, ""),
              })
            }
            className={`${inputClass} font-mono text-[12px]`}
          />
        );
      case "card":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Cardholder Name"
              value={formData.cardholderName}
              maxLength={60}
              onChange={(e) =>
                setFormData({ ...formData, cardholderName: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              placeholder="Last 4 digits"
              value={formData.cardNumber}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  cardNumber: e.target.value.replace(/\D/g, ""),
                })
              }
              maxLength={4}
              className={inputClass}
            />
          </div>
        );
      case "mobile":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Provider (e.g., PayTM, Google Pay)"
              value={formData.mobileProvider}
              maxLength={30}
              onChange={(e) =>
                setFormData({ ...formData, mobileProvider: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="tel"
              inputMode="tel"
              placeholder="Mobile Number (e.g., +971501234567)"
              value={formData.mobileNumber}
              maxLength={16}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  mobileNumber: e.target.value.replace(/[^\d+]/g, ""),
                })
              }
              className={inputClass}
            />
          </div>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {/* z-[60] so this overlay sits above the TradeFormModal (z-50) when
          opened from inside it via the "+ Add payment method" affordance. */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg bg-card-solid rounded-2xl border border-white/[0.08] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="relative px-6 pt-6 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/[0.055] border border-white/[0.12] flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-white/60" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-white">
                    {editingId ? "Edit Payment Method" : "Payment Methods"}
                  </h2>
                  <p className="text-[11px] text-white/30 font-mono mt-0.5">
                    {editingId
                      ? "Update fields and save"
                      : isFetching
                        ? "Loading..."
                        : `${paymentMethods.length} method${paymentMethods.length !== 1 ? "s" : ""} configured`}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-card rounded-xl transition-colors"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            <AnimatePresence mode="wait">
              {!showAddForm ? (
                <motion.div
                  key="list"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-3"
                >
                  {paymentMethods.length === 0 && !isFetching ? (
                    <div className="text-center py-10">
                      <div className="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mx-auto mb-4">
                        <CreditCard className="w-6 h-6 text-white/15" />
                      </div>
                      <p className="text-[13px] text-white/40 font-medium">
                        No payment methods yet
                      </p>
                      <p className="text-[11px] text-white/20 mt-1">
                        Add your first method to start trading
                      </p>
                    </div>
                  ) : (
                    paymentMethods.map((method, i) => {
                      const methodType = PAYMENT_METHOD_TYPES.find(
                        (t) => t.type === method.type,
                      );
                      const Icon = methodType?.icon || CreditCard;
                      return (
                        <motion.div
                          key={method.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className={`group relative p-3.5 rounded-xl border transition-all overflow-hidden ${
                            method.is_default
                              ? "bg-white/[0.055] border-white/[0.12]"
                              : "bg-white/[0.02] border-white/[0.06] hover:border-border-strong"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-xl bg-gradient-to-br ${methodType?.gradient || "from-white/10 to-white/5"} border ${methodType?.border || "border-white/10"} flex items-center justify-center shrink-0`}
                            >
                              <Icon
                                className={`w-5 h-5 ${methodType?.text || "text-white/60"}`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="text-[13px] font-semibold text-white truncate min-w-0">
                                  {method.name}
                                </p>
                                {method.is_default && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.06] border border-white/[0.09] rounded-md">
                                    <Star className="w-2.5 h-2.5 text-white/70 fill-white/50" />
                                    <span className="text-[9px] text-white/70 font-bold uppercase tracking-wider">
                                      Default
                                    </span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-white/30 mt-0.5 truncate font-mono">
                                {method.details}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              {!method.is_default && (
                                <button
                                  onClick={() => handleSetDefault(method.id)}
                                  className="p-1.5 hover:bg-card rounded-lg transition-colors"
                                  title="Set as default"
                                >
                                  <Star className="w-3.5 h-3.5 text-white/30 hover:text-white" />
                                </button>
                              )}
                              <button
                                onClick={() => startEdit(method)}
                                className="p-1.5 hover:bg-card rounded-lg transition-colors"
                                title="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5 text-white/30 hover:text-white" />
                              </button>
                              <button
                                onClick={() => handleRemoveMethod(method.id)}
                                className="p-1.5 hover:bg-[var(--color-error)]/10 rounded-lg transition-colors"
                                title="Remove"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-white/20 hover:text-[var(--color-error)]" />
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })
                  )}

                  {/* Add button */}
                  <button
                    onClick={() => {
                      setShowAddForm(true);
                      resetForm();
                    }}
                    className="w-full py-3 rounded-xl border border-dashed border-white/[0.10] hover:border-white/20 bg-white/[0.01] hover:bg-white/[0.04] text-white/40 hover:text-white font-medium transition-all flex items-center justify-center gap-2 text-[13px]"
                  >
                    <Plus className="w-4 h-4" />
                    Add Payment Method
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="space-y-5"
                >
                  {/* Type selector — locked while editing because the server's
                      PUT route does not accept `type`. Switching type would
                      require deleting + re-adding (also avoids the unique
                      default-row constraint moving unexpectedly). */}
                  <div>
                    <label className="text-[10px] text-white/30 font-mono uppercase tracking-widest mb-2.5 block">
                      {editingId ? "Payment Type (locked)" : "Payment Type"}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {PAYMENT_METHOD_TYPES.map((type) => {
                        const isActive = selectedType === type.type;
                        const disabled = editingId !== null && !isActive;
                        return (
                          <button
                            key={type.type}
                            disabled={disabled}
                            title={
                              disabled
                                ? "Type can't be changed — delete and re-add to switch type"
                                : undefined
                            }
                            onClick={() => {
                              if (editingId) return;
                              setSelectedType(type.type);
                            }}
                            className={`p-3 rounded-xl border transition-all text-left ${
                              isActive
                                ? `bg-gradient-to-br ${type.gradient} ${type.border} ring-1 ${type.ring}`
                                : "bg-white/[0.02] border-white/[0.06] hover:bg-card"
                            } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                          >
                            <div className="flex items-center gap-2.5">
                              <type.icon
                                className={`w-4 h-4 ${isActive ? type.text : "text-white/30"}`}
                              />
                              <div>
                                <span
                                  className={`text-[12px] font-semibold block ${isActive ? "text-white" : "text-white/50"}`}
                                >
                                  {type.label}
                                </span>
                                <span className="text-[9px] text-white/20">
                                  {type.desc}
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Form fields */}
                  <div>
                    <label className="text-[10px] text-white/30 font-mono uppercase tracking-widest mb-2.5 block">
                      {selectedTypeInfo.label} Details
                    </label>
                    {renderFormFields()}
                  </div>

                  {error && (
                    <div className="flex items-center gap-2.5 p-3 bg-red-500/[0.06] border border-red-500/15 rounded-xl">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <p className="text-[12px] text-red-400/80">{error}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2.5 pt-1">
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        resetForm();
                      }}
                      className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-accent-subtle border border-white/[0.06] rounded-xl text-[12px] text-white/60 font-medium transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveMethod}
                      disabled={isLoading}
                      className="flex-1 px-4 py-2.5 bg-[#f5f5f7] hover:bg-white rounded-xl text-[12px] text-[#0b0b0c] font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                          {editingId ? "Saving..." : "Adding..."}
                        </>
                      ) : editingId ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Save Changes
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" /> Add Method
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

// ────────────────────────────────────────────────────────────────────────
// PaymentMethodInlineForm
// ────────────────────────────────────────────────────────────────────────
// Same form body the modal uses, but rendered as a plain block (no overlay,
// no list step) so the Settings page can pin it as a permanently-visible
// right rail next to the methods list. All validation/save logic is shared
// with the modal — the only differences are layout and the
// `editingMethod` is passed in by the parent rather than pulled from props.
//
// Parents are responsible for supplying:
//   - merchantId            : auth scope for the API
//   - methodCount           : used to default-mark the first method
//   - editingMethod         : null = fresh add, set = edit-in-place
//   - onSaved(method, isEdit): notify the list to insert/update the row
//   - onCancel              : optional — clears edit state in the parent

interface PaymentMethodInlineFormProps {
  merchantId: string;
  methodCount: number;
  editingMethod?: PaymentMethod | null;
  onSaved: (saved: PaymentMethod, isEdit: boolean) => void;
  onCancel?: () => void;
  className?: string;
}

export function PaymentMethodInlineForm({
  merchantId,
  methodCount,
  editingMethod,
  onSaved,
  onCancel,
  className = "",
}: PaymentMethodInlineFormProps) {
  const [selectedType, setSelectedType] = useState<
    "bank" | "cash" | "crypto" | "card" | "mobile" | "upi"
  >(editingMethod?.type ?? "bank");
  const [formData, setFormData] = useState<FormData>(
    editingMethod ? parseDetailsForEdit(editingMethod) : EMPTY_FORM,
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Re-sync when the parent swaps which method we're editing (e.g. user
  // clicks Edit on a different row). Without this, formData would be stuck
  // showing the previously-edited method's values.
  useEffect(() => {
    if (editingMethod) {
      setSelectedType(editingMethod.type);
      setFormData(parseDetailsForEdit(editingMethod));
    } else {
      setSelectedType("bank");
      setFormData(EMPTY_FORM);
    }
    setError(null);
  }, [editingMethod?.id]);

  const editingId = editingMethod?.id ?? null;
  const selectedTypeInfo = PAYMENT_METHOD_TYPES.find(
    (t) => t.type === selectedType,
  )!;

  const handleSave = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const f = trimAll(formData);
      let name = "";
      let details = "";

      switch (selectedType) {
        case "bank": {
          if (!f.bankName || !f.accountName || !f.accountNumber) {
            throw new Error("Please fill in all bank details");
          }
          const err = validateBank({
            bankName: f.bankName,
            accountName: f.accountName,
            accountNumber: f.accountNumber,
            iban: f.iban,
            swiftCode: f.swiftCode,
          });
          if (err) throw new Error(err);
          name = f.bankName;
          details = `${f.accountName} - ${f.accountNumber}`;
          if (f.iban) details += ` (${f.iban.toUpperCase()})`;
          break;
        }
        case "cash": {
          if (!f.location) throw new Error("Please specify meeting location");
          const err = validateCash(f.location);
          if (err) throw new Error(err);
          name = "Cash Meeting";
          details = f.location;
          break;
        }
        case "crypto": {
          if (!f.walletAddress)
            throw new Error("Please provide wallet address");
          const err = validateCrypto(f.walletAddress);
          if (err) throw new Error(err);
          name = "Crypto Wallet";
          details = f.walletAddress;
          break;
        }
        case "card": {
          if (!f.cardNumber || !f.cardholderName)
            throw new Error("Please provide card details");
          const err = validateCard({
            cardholderName: f.cardholderName,
            cardNumber: f.cardNumber,
          });
          if (err) throw new Error(err);
          name = "Card Payment";
          details = `${f.cardholderName} - **** ${f.cardNumber.slice(-4)}`;
          break;
        }
        case "mobile": {
          if (!f.mobileNumber || !f.mobileProvider)
            throw new Error("Please provide mobile payment details");
          const err = validateMobile({
            mobileProvider: f.mobileProvider,
            mobileNumber: f.mobileNumber,
          });
          if (err) throw new Error(err);
          name = f.mobileProvider;
          details = f.mobileNumber;
          break;
        }
        case "upi": {
          if (!f.upiId) throw new Error("Please provide your UPI ID");
          const err = validateUpi({
            upiId: f.upiId,
            upiProvider: f.upiProvider,
          });
          if (err) throw new Error(err);
          name = f.upiProvider || "UPI";
          details = f.upiProvider
            ? `${f.upiId} (${f.upiProvider})`
            : f.upiId;
          break;
        }
      }

      const isEdit = editingId !== null;
      const url = isEdit
        ? `/api/merchant/${merchantId}/payment-methods/${editingId}`
        : `/api/merchant/${merchantId}/payment-methods`;
      const body: Record<string, unknown> = isEdit
        ? { name, details }
        : { type: selectedType, name, details, is_default: methodCount === 0 };

      const res = await fetchWithAuth(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(
          json.error ||
            (Array.isArray(json.errors)
              ? json.errors.join(", ")
              : "Failed to save payment method"),
        );
      }

      onSaved(
        {
          id: json.data.id,
          type: json.data.type,
          name: json.data.name,
          details: json.data.details,
          is_default: json.data.is_default,
        },
        isEdit,
      );
      if (!isEdit) {
        // After a successful add, reset the form so the user can keep adding
        // without manually clearing fields. Edits leave the form populated
        // because the parent typically clears `editingMethod` itself.
        setFormData(EMPTY_FORM);
        setSelectedType("bank");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save payment method",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const renderFields = () => {
    switch (selectedType) {
      case "bank":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Bank Name (e.g., Emirates NBD)"
              value={formData.bankName}
              maxLength={60}
              onChange={(e) =>
                setFormData({ ...formData, bankName: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Account Holder Name"
              value={formData.accountName}
              maxLength={60}
              onChange={(e) =>
                setFormData({ ...formData, accountName: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              placeholder="Account Number (4–24 digits)"
              value={formData.accountNumber}
              maxLength={24}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  accountNumber: e.target.value.replace(/\D/g, ""),
                })
              }
              className={inputClass}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <input
                type="text"
                placeholder="IBAN (Optional)"
                value={formData.iban}
                maxLength={34}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    iban: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ""),
                  })
                }
                className={inputClass}
              />
              <input
                type="text"
                placeholder="SWIFT Code (Optional)"
                value={formData.swiftCode}
                maxLength={11}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    swiftCode: e.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, ""),
                  })
                }
                className={inputClass}
              />
            </div>
          </div>
        );
      case "cash":
        return (
          <textarea
            placeholder="Meeting Location (e.g., Dubai Mall, Burj Khalifa entrance)"
            value={formData.location}
            maxLength={120}
            onChange={(e) =>
              setFormData({ ...formData, location: e.target.value })
            }
            rows={3}
            className={`${inputClass} resize-none`}
          />
        );
      case "crypto":
        return (
          <input
            type="text"
            placeholder="Wallet Address (e.g., 0x...)"
            value={formData.walletAddress}
            maxLength={100}
            onChange={(e) =>
              setFormData({
                ...formData,
                walletAddress: e.target.value.replace(/[^A-Za-z0-9]/g, ""),
              })
            }
            className={`${inputClass} font-mono text-[12px]`}
          />
        );
      case "card":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Cardholder Name"
              value={formData.cardholderName}
              maxLength={60}
              onChange={(e) =>
                setFormData({ ...formData, cardholderName: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              inputMode="numeric"
              pattern="\d*"
              placeholder="Last 4 digits"
              value={formData.cardNumber}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  cardNumber: e.target.value.replace(/\D/g, ""),
                })
              }
              maxLength={4}
              className={inputClass}
            />
          </div>
        );
      case "mobile":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="Provider (e.g., PayTM, Google Pay)"
              value={formData.mobileProvider}
              maxLength={30}
              onChange={(e) =>
                setFormData({ ...formData, mobileProvider: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="tel"
              inputMode="tel"
              placeholder="Mobile Number (e.g., +971501234567)"
              value={formData.mobileNumber}
              maxLength={16}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  mobileNumber: e.target.value.replace(/[^\d+]/g, ""),
                })
              }
              className={inputClass}
            />
          </div>
        );
      case "upi":
        return (
          <div className="space-y-2.5">
            <input
              type="text"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="UPI ID (e.g., user@oksbi)"
              value={formData.upiId}
              maxLength={50}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  upiId: e.target.value.replace(/\s+/g, ""),
                })
              }
              className={`${inputClass} font-mono`}
            />
            <input
              type="text"
              placeholder="Provider (Optional, e.g., Google Pay)"
              value={formData.upiProvider}
              maxLength={30}
              onChange={(e) =>
                setFormData({ ...formData, upiProvider: e.target.value })
              }
              className={inputClass}
            />
          </div>
        );
    }
  };

  return (
    <div
      className={`bg-white/[0.02] border border-white/[0.06] rounded-2xl p-6 ${className}`}
    >
      <div className="flex items-start justify-between mb-1">
        <div>
          <h3 className="text-xl font-bold text-white">
            {editingId ? "Edit Payment Method" : "Add Payment Method"}
          </h3>
          <p className="text-[12px] text-white/40 mt-0.5">
            {editingId
              ? "Update fields and save your changes"
              : "Choose a method and add your details"}
          </p>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-white/[0.06] text-white/40 hover:text-white/70"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="mt-5">
        <p className="text-[10px] text-white/40 font-mono uppercase tracking-[0.18em] mb-3">
          {editingId ? "Payment Type (locked)" : "Payment Type"}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {PAYMENT_METHOD_TYPES.map((type) => {
            const isActive = selectedType === type.type;
            const disabled = editingId !== null && !isActive;
            return (
              <button
                key={type.type}
                disabled={disabled}
                title={
                  disabled
                    ? "Type can't be changed — delete and re-add to switch type"
                    : undefined
                }
                onClick={() => {
                  if (editingId) return;
                  setSelectedType(type.type);
                }}
                className={`p-3 rounded-xl border transition-all text-left ${
                  isActive
                    ? `bg-gradient-to-br ${type.gradient} ${type.border} ring-1 ${type.ring}`
                    : "bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]"
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center gap-2.5">
                  <type.icon
                    className={`w-4 h-4 ${isActive ? type.text : "text-white/30"}`}
                  />
                  <div>
                    <span
                      className={`text-[13px] font-semibold block ${isActive ? "text-white" : "text-white/60"}`}
                    >
                      {type.label}
                    </span>
                    <span className="text-[10px] text-white/30">
                      {type.desc}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-[10px] text-white/40 font-mono uppercase tracking-[0.18em] mb-3">
          {selectedTypeInfo.label} Details
        </p>
        {renderFields()}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2.5 p-3 bg-red-500/[0.06] border border-red-500/15 rounded-xl">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <p className="text-[12px] text-red-400/80">{error}</p>
        </div>
      )}

      <div className="mt-5 flex gap-2.5">
        <button
          onClick={() => {
            setError(null);
            if (editingId) {
              onCancel?.();
            } else {
              setFormData(EMPTY_FORM);
              setSelectedType("bank");
            }
          }}
          className="flex-1 px-4 py-3 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl text-[13px] text-white/70 font-medium transition-all"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isLoading}
          className="flex-1 px-4 py-3 bg-[#f5f5f7] hover:bg-white rounded-xl text-[13px] text-[#0b0b0c] font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />{" "}
              {editingId ? "Saving..." : "Adding..."}
            </>
          ) : editingId ? (
            <>
              <Check className="w-4 h-4" /> Save Changes
            </>
          ) : (
            <>
              <Check className="w-4 h-4" /> Add Method
            </>
          )}
        </button>
      </div>
    </div>
  );
}
