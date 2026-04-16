'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Building2, Wallet, CreditCard, DollarSign, Check, Loader2, AlertCircle, Trash2, Star, Smartphone } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface PaymentMethod {
  id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
  name: string;
  details: string;
  is_default: boolean;
}

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
}

const PAYMENT_METHOD_TYPES = [
  { type: 'bank' as const, label: 'Bank Account', desc: 'Wire & local transfers', icon: Building2, gradient: 'from-blue-500/20 to-blue-600/5', border: 'border-blue-500/30', text: 'text-blue-400', ring: 'ring-blue-500/20' },
  { type: 'cash' as const, label: 'Cash Meeting', desc: 'In-person exchange', icon: DollarSign, gradient: 'from-emerald-500/20 to-emerald-600/5', border: 'border-emerald-500/30', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
  { type: 'crypto' as const, label: 'Crypto Wallet', desc: 'On-chain address', icon: Wallet, gradient: 'from-primary/20 to-primary/5', border: 'border-primary/30', text: 'text-primary', ring: 'ring-primary/20' },
  { type: 'card' as const, label: 'Card Payment', desc: 'Debit or credit card', icon: CreditCard, gradient: 'from-purple-500/20 to-purple-600/5', border: 'border-purple-500/30', text: 'text-purple-400', ring: 'ring-purple-500/20' },
  { type: 'mobile' as const, label: 'Mobile Money', desc: 'Digital wallet apps', icon: Smartphone, gradient: 'from-pink-500/20 to-pink-600/5', border: 'border-pink-500/30', text: 'text-pink-400', ring: 'ring-pink-500/20' },
];

const inputClass = "w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all";

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

function trimAll<T extends Record<string, string>>(obj: T): T {
  const out: Record<string, string> = {};
  for (const k of Object.keys(obj)) out[k] = String(obj[k] ?? '').trim();
  return out as T;
}

function validateBank(f: { bankName: string; accountName: string; accountNumber: string; iban: string; swiftCode: string }): string | null {
  if (!NAME_RE.test(f.bankName)) return 'Bank name must be 2–60 chars (letters, numbers, basic punctuation).';
  if (!PERSON_RE.test(f.accountName)) return 'Account holder name must be 2–60 letters.';
  if (!DIGITS_RE.test(f.accountNumber) || f.accountNumber.length < 4 || f.accountNumber.length > 24) {
    return 'Account number must be 4–24 digits.';
  }
  if (f.iban && !IBAN_RE.test(f.iban.toUpperCase())) return 'IBAN must be 15–34 uppercase letters/digits.';
  if (f.swiftCode && !SWIFT_RE.test(f.swiftCode.toUpperCase())) return 'SWIFT code must be 8 or 11 letters/digits.';
  return null;
}
function validateCrypto(addr: string): string | null {
  if (!WALLET_RE.test(addr)) return 'Wallet address must be 20–100 alphanumeric characters.';
  return null;
}
function validateCard(f: { cardholderName: string; cardNumber: string }): string | null {
  if (!PERSON_RE.test(f.cardholderName)) return 'Cardholder name must be 2–60 letters.';
  if (!DIGITS_RE.test(f.cardNumber) || f.cardNumber.length !== 4) return 'Enter the last 4 digits of the card.';
  return null;
}
function validateMobile(f: { mobileProvider: string; mobileNumber: string }): string | null {
  if (f.mobileProvider.length < 2 || f.mobileProvider.length > 30) return 'Provider name must be 2–30 chars.';
  if (!PHONE_RE.test(f.mobileNumber)) return 'Mobile number must be 7–15 digits (optional leading +).';
  return null;
}
function validateCash(location: string): string | null {
  if (location.length < 5 || location.length > 120) return 'Location must be 5–120 characters.';
  return null;
}

export function PaymentMethodModal({ isOpen, onClose, merchantId }: PaymentMethodModalProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedType, setSelectedType] = useState<'bank' | 'cash' | 'crypto' | 'card' | 'mobile'>('bank');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    bankName: '',
    accountName: '',
    accountNumber: '',
    iban: '',
    swiftCode: '',
    location: '',
    walletAddress: '',
    cardNumber: '',
    cardholderName: '',
    mobileNumber: '',
    mobileProvider: '',
  });

  // Fetch existing payment methods from API
  const fetchMethods = useCallback(async () => {
    if (!merchantId) return;
    setIsFetching(true);
    try {
      const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`);
      const json = await res.json();
      if (json.success && json.data) {
        setPaymentMethods(json.data.map((m: any) => ({
          id: m.id,
          type: m.type,
          name: m.name,
          details: m.details,
          is_default: m.is_default,
        })));
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

  const resetForm = () => {
    setFormData({
      bankName: '', accountName: '', accountNumber: '', iban: '', swiftCode: '',
      location: '', walletAddress: '', cardNumber: '', cardholderName: '',
      mobileNumber: '', mobileProvider: '',
    });
    setError(null);
  };

  const handleAddMethod = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Trim before validating so trailing spaces don't squeak past length caps.
      const f = trimAll(formData);
      let name = '';
      let details = '';

      switch (selectedType) {
        case 'bank': {
          if (!f.bankName || !f.accountName || !f.accountNumber) {
            throw new Error('Please fill in all bank details');
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
        case 'cash': {
          if (!f.location) throw new Error('Please specify meeting location');
          const err = validateCash(f.location);
          if (err) throw new Error(err);
          name = 'Cash Meeting';
          details = f.location;
          break;
        }
        case 'crypto': {
          if (!f.walletAddress) throw new Error('Please provide wallet address');
          const err = validateCrypto(f.walletAddress);
          if (err) throw new Error(err);
          name = 'Crypto Wallet';
          details = f.walletAddress;
          break;
        }
        case 'card': {
          if (!f.cardNumber || !f.cardholderName) throw new Error('Please provide card details');
          const err = validateCard({ cardholderName: f.cardholderName, cardNumber: f.cardNumber });
          if (err) throw new Error(err);
          name = 'Card Payment';
          details = `${f.cardholderName} - **** ${f.cardNumber.slice(-4)}`;
          break;
        }
        case 'mobile': {
          if (!f.mobileNumber || !f.mobileProvider) throw new Error('Please provide mobile payment details');
          const err = validateMobile({ mobileProvider: f.mobileProvider, mobileNumber: f.mobileNumber });
          if (err) throw new Error(err);
          name = f.mobileProvider;
          details = f.mobileNumber;
          break;
        }
      }

      // Persist to API
      const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedType,
          name,
          details,
          is_default: paymentMethods.length === 0,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to save payment method');
      }

      const saved = json.data;
      setPaymentMethods([...paymentMethods, {
        id: saved.id,
        type: saved.type,
        name: saved.name,
        details: saved.details,
        is_default: saved.is_default,
      }]);
      resetForm();
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add payment method');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMethod = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods?method_id=${id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods(paymentMethods.filter(m => m.id !== id));
      }
    } catch {
      // Silent fail — method stays in UI
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method_id: id }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setPaymentMethods(paymentMethods.map(m => ({ ...m, is_default: m.id === id })));
      }
    } catch {
      // Silent fail
    }
  };

  const selectedTypeInfo = PAYMENT_METHOD_TYPES.find(t => t.type === selectedType)!;

  const renderFormFields = () => {
    switch (selectedType) {
      case 'bank':
        return (
          <div className="space-y-2.5">
            <input type="text" placeholder="Bank Name (e.g., Emirates NBD)" value={formData.bankName} maxLength={60}
              onChange={(e) => setFormData({ ...formData, bankName: e.target.value })} className={inputClass} />
            <input type="text" placeholder="Account Holder Name" value={formData.accountName} maxLength={60}
              onChange={(e) => setFormData({ ...formData, accountName: e.target.value })} className={inputClass} />
            <input type="text" inputMode="numeric" pattern="\d*" placeholder="Account Number (4–24 digits)" value={formData.accountNumber} maxLength={24}
              onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value.replace(/\D/g, '') })} className={inputClass} />
            <div className="grid grid-cols-2 gap-2.5">
              <input type="text" placeholder="IBAN (Optional)" value={formData.iban} maxLength={34}
                onChange={(e) => setFormData({ ...formData, iban: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} className={inputClass} />
              <input type="text" placeholder="SWIFT Code (Optional)" value={formData.swiftCode} maxLength={11}
                onChange={(e) => setFormData({ ...formData, swiftCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} className={inputClass} />
            </div>
          </div>
        );
      case 'cash':
        return (
          <textarea placeholder="Meeting Location (e.g., Dubai Mall, Burj Khalifa entrance)" value={formData.location} maxLength={120}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })} rows={3}
            className={`${inputClass} resize-none`} />
        );
      case 'crypto':
        return (
          <input type="text" placeholder="Wallet Address (e.g., 0x...)" value={formData.walletAddress} maxLength={100}
            onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} className={`${inputClass} font-mono text-[12px]`} />
        );
      case 'card':
        return (
          <div className="space-y-2.5">
            <input type="text" placeholder="Cardholder Name" value={formData.cardholderName} maxLength={60}
              onChange={(e) => setFormData({ ...formData, cardholderName: e.target.value })} className={inputClass} />
            <input type="text" inputMode="numeric" pattern="\d*" placeholder="Last 4 digits" value={formData.cardNumber}
              onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value.replace(/\D/g, '') })} maxLength={4} className={inputClass} />
          </div>
        );
      case 'mobile':
        return (
          <div className="space-y-2.5">
            <input type="text" placeholder="Provider (e.g., PayTM, Google Pay)" value={formData.mobileProvider} maxLength={30}
              onChange={(e) => setFormData({ ...formData, mobileProvider: e.target.value })} className={inputClass} />
            <input type="tel" inputMode="tel" placeholder="Mobile Number (e.g., +971501234567)" value={formData.mobileNumber} maxLength={16}
              onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value.replace(/[^\d+]/g, '') })} className={inputClass} />
          </div>
        );
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg bg-card-solid rounded-2xl border border-white/[0.08] shadow-2xl max-h-[85vh] flex flex-col overflow-hidden"
        >
          {/* Ambient glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[120px] bg-primary/[0.04] rounded-full blur-[80px] pointer-events-none" />

          {/* Header */}
          <div className="relative px-6 pt-6 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-white">Payment Methods</h2>
                  <p className="text-[11px] text-white/30 font-mono mt-0.5">
                    {isFetching ? 'Loading...' : `${paymentMethods.length} method${paymentMethods.length !== 1 ? 's' : ''} configured`}
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
                      <p className="text-[13px] text-white/40 font-medium">No payment methods yet</p>
                      <p className="text-[11px] text-white/20 mt-1">Add your first method to start trading</p>
                    </div>
                  ) : (
                    paymentMethods.map((method, i) => {
                      const methodType = PAYMENT_METHOD_TYPES.find(t => t.type === method.type);
                      const Icon = methodType?.icon || CreditCard;

                      return (
                        <motion.div
                          key={method.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className={`group relative p-3.5 rounded-xl border transition-all overflow-hidden ${
                            method.is_default
                              ? 'bg-gradient-to-r from-primary/[0.06] to-transparent border-primary/20'
                              : 'bg-white/[0.02] border-white/[0.06] hover:border-border-strong'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${methodType?.gradient || 'from-white/10 to-white/5'} border ${methodType?.border || 'border-white/10'} flex items-center justify-center shrink-0`}>
                              <Icon className={`w-5 h-5 ${methodType?.text || 'text-white/60'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="text-[13px] font-semibold text-white truncate min-w-0">{method.name}</p>
                                {method.is_default && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded-md">
                                    <Star className="w-2.5 h-2.5 text-primary fill-primary" />
                                    <span className="text-[9px] text-primary font-bold uppercase tracking-wider">Default</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-white/30 mt-0.5 truncate font-mono">{method.details}</p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              {!method.is_default && (
                                <button
                                  onClick={() => handleSetDefault(method.id)}
                                  className="p-1.5 hover:bg-card rounded-lg transition-colors"
                                  title="Set as default"
                                >
                                  <Star className="w-3.5 h-3.5 text-white/30 hover:text-primary" />
                                </button>
                              )}
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
                    onClick={() => { setShowAddForm(true); resetForm(); }}
                    className="w-full py-3 rounded-xl border border-dashed border-white/[0.10] hover:border-primary/30 bg-white/[0.01] hover:bg-primary/[0.04] text-white/40 hover:text-primary font-medium transition-all flex items-center justify-center gap-2 text-[13px]"
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
                  {/* Type selector */}
                  <div>
                    <label className="text-[10px] text-white/30 font-mono uppercase tracking-widest mb-2.5 block">Payment Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {PAYMENT_METHOD_TYPES.map((type) => (
                        <button
                          key={type.type}
                          onClick={() => setSelectedType(type.type)}
                          className={`p-3 rounded-xl border transition-all text-left ${
                            selectedType === type.type
                              ? `bg-gradient-to-br ${type.gradient} ${type.border} ring-1 ${type.ring}`
                              : 'bg-white/[0.02] border-white/[0.06] hover:bg-card'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            <type.icon className={`w-4 h-4 ${selectedType === type.type ? type.text : 'text-white/30'}`} />
                            <div>
                              <span className={`text-[12px] font-semibold block ${selectedType === type.type ? 'text-white' : 'text-white/50'}`}>
                                {type.label}
                              </span>
                              <span className="text-[9px] text-white/20">{type.desc}</span>
                            </div>
                          </div>
                        </button>
                      ))}
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
                      onClick={() => { setShowAddForm(false); setError(null); }}
                      className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-accent-subtle border border-white/[0.06] rounded-xl text-[12px] text-white/60 font-medium transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddMethod}
                      disabled={isLoading}
                      className="flex-1 px-4 py-2.5 bg-gradient-to-r from-primary to-primary hover:from-primary/90 hover:to-primary/90 rounded-xl text-[12px] text-background font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-primary/20"
                    >
                      {isLoading ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding...</>
                      ) : (
                        <><Check className="w-3.5 h-3.5" /> Add Method</>
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
