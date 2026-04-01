"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Plus,
  Check,
  Loader2,
  ChevronDown,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

export interface UserBankAccount {
  id: string;
  bank_name: string;
  account_name: string;
  iban: string;
  is_default: boolean;
}

export interface SelectedBankDetails {
  bank_name: string;
  account_name: string;
  iban: string;
}

interface BankAccountSelectorProps {
  userId: string | null;
  selected: SelectedBankDetails | null;
  onSelect: (details: SelectedBankDetails | null) => void;
}

export const BankAccountSelector = ({
  userId,
  selected,
  onSelect,
}: BankAccountSelectorProps) => {
  const [accounts, setAccounts] = useState<UserBankAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Add form state
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [iban, setIban] = useState("");
  const [formError, setFormError] = useState("");

  // Fetch bank accounts
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    fetchWithAuth(`/api/users/${userId}/bank-accounts`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.data)) {
          setAccounts(data.data);
          // Auto-select default if nothing selected
          if (!selected && data.data.length > 0) {
            const defaultAcc = data.data.find((a: UserBankAccount) => a.is_default) || data.data[0];
            onSelect({
              bank_name: defaultAcc.bank_name,
              account_name: defaultAcc.account_name,
              iban: defaultAcc.iban,
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddAccount = async () => {
    setFormError("");
    if (!bankName.trim() || !accountName.trim() || !iban.trim()) {
      setFormError("All fields are required");
      return;
    }
    if (iban.trim().length < 15 || iban.trim().length > 34) {
      setFormError("IBAN must be 15-34 characters");
      return;
    }
    if (!userId) return;

    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/users/${userId}/bank-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_name: bankName.trim(),
          account_name: accountName.trim(),
          iban: iban.trim().toUpperCase(),
          is_default: accounts.length === 0,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        const newAcc = data.data;
        setAccounts((prev) => [...prev, newAcc]);
        onSelect({
          bank_name: newAcc.bank_name,
          account_name: newAcc.account_name,
          iban: newAcc.iban,
        });
        setBankName("");
        setAccountName("");
        setIban("");
        setShowAddForm(false);
        setExpanded(false);
      } else {
        setFormError(data.error || "Failed to add account");
      }
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const isSelected = (acc: UserBankAccount) =>
    selected?.iban === acc.iban && selected?.bank_name === acc.bank_name;

  if (loading) {
    return (
      <div className="w-full bg-[#111111] rounded-2xl p-4 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-white/40" />
        <span className="text-[13px] text-white/40">Loading payment methods...</span>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2">
        <Building2 className="w-4 h-4 text-white/40" />
        <span className="text-[12px] text-white/40 uppercase tracking-wide font-semibold">
          Your Payment Method
        </span>
      </div>

      {/* Selected account display / dropdown trigger */}
      {accounts.length > 0 && !showAddForm && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full bg-[#111111] rounded-xl p-3 flex items-center gap-3 text-left"
        >
          <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-white/40" />
          </div>
          <div className="flex-1 min-w-0">
            {selected ? (
              <>
                <p className="text-[14px] font-medium text-white truncate">
                  {selected.bank_name}
                </p>
                <p className="text-[12px] text-white/40 truncate">
                  {selected.account_name} &middot; {selected.iban.slice(0, 4)}...{selected.iban.slice(-4)}
                </p>
              </>
            ) : (
              <p className="text-[14px] text-white/40">Select a payment method</p>
            )}
          </div>
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
            <div className="mt-1 space-y-1">
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => {
                    onSelect({
                      bank_name: acc.bank_name,
                      account_name: acc.account_name,
                      iban: acc.iban,
                    });
                    setExpanded(false);
                  }}
                  className={`w-full flex items-center gap-3 rounded-xl p-3 text-left transition-colors ${
                    isSelected(acc)
                      ? "bg-white/10 border border-white/15"
                      : "bg-[#111111]/60 hover:bg-[#1a1a1a]/60"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                    <Building2 className="w-3.5 h-3.5 text-white/40" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white truncate">
                      {acc.bank_name}
                      {acc.is_default && (
                        <span className="ml-1.5 text-[10px] text-white/40 font-normal">Default</span>
                      )}
                    </p>
                    <p className="text-[11px] text-white/40 truncate">
                      {acc.account_name} &middot; {acc.iban}
                    </p>
                  </div>
                  {isSelected(acc) && (
                    <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                  )}
                </button>
              ))}

              {/* Add new button */}
              <button
                onClick={() => setShowAddForm(true)}
                className="w-full flex items-center gap-3 rounded-xl p-3 text-left bg-[#111111]/40 hover:bg-[#1a1a1a]/40 transition-colors"
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

      {/* No accounts — show add form directly */}
      {accounts.length === 0 && !showAddForm && (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full bg-[#111111] rounded-xl p-4 flex items-center gap-3 text-left hover:bg-[#1a1a1a] transition-colors"
        >
          <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
            <Plus className="w-4 h-4 text-white/40" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-white">Add Payment Method</p>
            <p className="text-[12px] text-white/40">
              Add your bank account so merchant can send you AED
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
            className="bg-[#111111] rounded-xl p-4 mt-1"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-white">Add Bank Account</span>
              <button
                onClick={() => { setShowAddForm(false); setFormError(""); }}
                className="p-1 rounded-lg hover:bg-white/5"
              >
                <X className="w-4 h-4 text-white/40" />
              </button>
            </div>

            <div className="space-y-2.5">
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="Bank Name (e.g. Emirates NBD)"
                className="w-full bg-[#1a1a1a] rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/30 outline-none focus:ring-1 focus:ring-white/20"
              />
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Account Holder Name"
                className="w-full bg-[#1a1a1a] rounded-lg px-3 py-2.5 text-[13px] text-white placeholder:text-white/30 outline-none focus:ring-1 focus:ring-white/20"
              />
              <input
                type="text"
                value={iban}
                onChange={(e) => setIban(e.target.value.toUpperCase())}
                placeholder="IBAN (e.g. AE070331234567890123456)"
                className="w-full bg-neutral-800 rounded-lg px-3 py-2.5 text-[13px] text-white font-mono placeholder:text-neutral-600 placeholder:font-sans outline-none focus:ring-1 focus:ring-white/20"
              />

              {formError && (
                <p className="text-[12px] text-red-400">{formError}</p>
              )}

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleAddAccount}
                disabled={saving}
                className="w-full py-2.5 rounded-lg bg-white/10 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
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
