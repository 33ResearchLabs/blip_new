'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Building2, Wallet, CreditCard, DollarSign, Check, Loader2, AlertCircle, Trash2, Star, Smartphone } from 'lucide-react';

interface PaymentMethod {
  id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
  name: string;
  details: string;
  isDefault: boolean;
}

interface PaymentMethodModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
}

const PAYMENT_METHOD_TYPES = [
  { type: 'bank' as const, label: 'Bank Account', desc: 'Wire & local transfers', icon: Building2, gradient: 'from-blue-500/20 to-blue-600/5', border: 'border-blue-500/30', text: 'text-blue-400', ring: 'ring-blue-500/20' },
  { type: 'cash' as const, label: 'Cash Meeting', desc: 'In-person exchange', icon: DollarSign, gradient: 'from-emerald-500/20 to-emerald-600/5', border: 'border-emerald-500/30', text: 'text-emerald-400', ring: 'ring-emerald-500/20' },
  { type: 'crypto' as const, label: 'Crypto Wallet', desc: 'On-chain address', icon: Wallet, gradient: 'from-orange-500/20 to-orange-600/5', border: 'border-orange-500/30', text: 'text-orange-400', ring: 'ring-orange-500/20' },
  { type: 'card' as const, label: 'Card Payment', desc: 'Debit or credit card', icon: CreditCard, gradient: 'from-purple-500/20 to-purple-600/5', border: 'border-purple-500/30', text: 'text-purple-400', ring: 'ring-purple-500/20' },
  { type: 'mobile' as const, label: 'Mobile Money', desc: 'Digital wallet apps', icon: Smartphone, gradient: 'from-pink-500/20 to-pink-600/5', border: 'border-pink-500/30', text: 'text-pink-400', ring: 'ring-pink-500/20' },
];

const inputClass = "w-full px-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-xl text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all";

export function PaymentMethodModal({ isOpen, onClose, merchantId }: PaymentMethodModalProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedType, setSelectedType] = useState<'bank' | 'cash' | 'crypto' | 'card' | 'mobile'>('bank');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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
      let name = '';
      let details = '';

      switch (selectedType) {
        case 'bank':
          if (!formData.bankName || !formData.accountName || !formData.accountNumber) {
            throw new Error('Please fill in all bank details');
          }
          name = formData.bankName;
          details = `${formData.accountName} - ${formData.accountNumber}`;
          if (formData.iban) details += ` (${formData.iban})`;
          break;
        case 'cash':
          if (!formData.location) throw new Error('Please specify meeting location');
          name = 'Cash Meeting';
          details = formData.location;
          break;
        case 'crypto':
          if (!formData.walletAddress) throw new Error('Please provide wallet address');
          name = 'Crypto Wallet';
          details = formData.walletAddress;
          break;
        case 'card':
          if (!formData.cardNumber || !formData.cardholderName) throw new Error('Please provide card details');
          name = 'Card Payment';
          details = `${formData.cardholderName} - **** ${formData.cardNumber.slice(-4)}`;
          break;
        case 'mobile':
          if (!formData.mobileNumber || !formData.mobileProvider) throw new Error('Please provide mobile payment details');
          name = formData.mobileProvider;
          details = formData.mobileNumber;
          break;
      }

      const newMethod: PaymentMethod = {
        id: Date.now().toString(),
        type: selectedType,
        name,
        details,
        isDefault: paymentMethods.length === 0,
      };

      setPaymentMethods([...paymentMethods, newMethod]);
      resetForm();
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add payment method');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMethod = (id: string) => {
    setPaymentMethods(paymentMethods.filter(m => m.id !== id));
  };

  const handleSetDefault = (id: string) => {
    setPaymentMethods(paymentMethods.map(m => ({ ...m, isDefault: m.id === id })));
  };

  const selectedTypeInfo = PAYMENT_METHOD_TYPES.find(t => t.type === selectedType)!;

  const renderFormFields = () => {
    switch (selectedType) {
      case 'bank':
        return (
          <div className="space-y-2.5">
            <input type="text" placeholder="Bank Name (e.g., Emirates NBD)" value={formData.bankName}
              onChange={(e) => setFormData({ ...formData, bankName: e.target.value })} className={inputClass} />
            <input type="text" placeholder="Account Holder Name" value={formData.accountName}
              onChange={(e) => setFormData({ ...formData, accountName: e.target.value })} className={inputClass} />
            <input type="text" placeholder="Account Number" value={formData.accountNumber}
              onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })} className={inputClass} />
            <div className="grid grid-cols-2 gap-2.5">
              <input type="text" placeholder="IBAN (Optional)" value={formData.iban}
                onChange={(e) => setFormData({ ...formData, iban: e.target.value })} className={inputClass} />
              <input type="text" placeholder="SWIFT Code (Optional)" value={formData.swiftCode}
                onChange={(e) => setFormData({ ...formData, swiftCode: e.target.value })} className={inputClass} />
            </div>
          </div>
        );
      case 'cash':
        return (
          <textarea placeholder="Meeting Location (e.g., Dubai Mall, Burj Khalifa entrance)" value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })} rows={3}
            className={`${inputClass} resize-none`} />
        );
      case 'crypto':
        return (
          <input type="text" placeholder="Wallet Address (e.g., 0x...)" value={formData.walletAddress}
            onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value })} className={`${inputClass} font-mono text-[12px]`} />
        );
      case 'card':
        return (
          <div className="space-y-2.5">
            <input type="text" placeholder="Cardholder Name" value={formData.cardholderName}
              onChange={(e) => setFormData({ ...formData, cardholderName: e.target.value })} className={inputClass} />
            <input type="text" placeholder="Last 4 digits" value={formData.cardNumber}
              onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })} maxLength={4} className={inputClass} />
          </div>
        );
      case 'mobile':
        return (
          <div className="space-y-2.5">
            <input type="text" placeholder="Provider (e.g., PayTM, Google Pay)" value={formData.mobileProvider}
              onChange={(e) => setFormData({ ...formData, mobileProvider: e.target.value })} className={inputClass} />
            <input type="text" placeholder="Mobile Number" value={formData.mobileNumber}
              onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })} className={inputClass} />
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
          className="absolute inset-0 bg-black/80 backdrop-blur-md"
          onClick={onClose}
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg bg-[#0a0a0a] rounded-2xl border border-white/[0.08] shadow-2xl shadow-black/60 max-h-[85vh] flex flex-col overflow-hidden"
        >
          {/* Ambient glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[120px] bg-orange-500/[0.04] rounded-full blur-[80px] pointer-events-none" />

          {/* Header */}
          <div className="relative px-6 pt-6 pb-4 border-b border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/5 border border-orange-500/20 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-white">Payment Methods</h2>
                  <p className="text-[11px] text-white/30 font-mono mt-0.5">
                    {paymentMethods.length} method{paymentMethods.length !== 1 ? 's' : ''} configured
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/[0.06] rounded-xl transition-colors"
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
                  {paymentMethods.length === 0 ? (
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
                          className={`group relative p-3.5 rounded-xl border transition-all ${
                            method.isDefault
                              ? 'bg-gradient-to-r from-orange-500/[0.06] to-transparent border-orange-500/20'
                              : 'bg-white/[0.02] border-white/[0.06] hover:border-white/[0.10]'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${methodType?.gradient || 'from-white/10 to-white/5'} border ${methodType?.border || 'border-white/10'} flex items-center justify-center shrink-0`}>
                              <Icon className={`w-5 h-5 ${methodType?.text || 'text-white/60'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-[13px] font-semibold text-white">{method.name}</p>
                                {method.isDefault && (
                                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/10 border border-orange-500/20 rounded-md">
                                    <Star className="w-2.5 h-2.5 text-orange-400 fill-orange-400" />
                                    <span className="text-[9px] text-orange-400 font-bold uppercase tracking-wider">Default</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-white/30 mt-0.5 truncate font-mono">{method.details}</p>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                              {!method.isDefault && (
                                <button
                                  onClick={() => handleSetDefault(method.id)}
                                  className="p-1.5 hover:bg-white/[0.06] rounded-lg transition-colors"
                                  title="Set as default"
                                >
                                  <Star className="w-3.5 h-3.5 text-white/30 hover:text-orange-400" />
                                </button>
                              )}
                              <button
                                onClick={() => handleRemoveMethod(method.id)}
                                className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                                title="Remove"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-white/20 hover:text-red-400" />
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
                    className="w-full py-3 rounded-xl border border-dashed border-white/[0.10] hover:border-orange-500/30 bg-white/[0.01] hover:bg-orange-500/[0.04] text-white/40 hover:text-orange-400 font-medium transition-all flex items-center justify-center gap-2 text-[13px]"
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
                              : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
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
                      className="flex-1 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-xl text-[12px] text-white/60 font-medium transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddMethod}
                      disabled={isLoading}
                      className="flex-1 px-4 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 rounded-xl text-[12px] text-black font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
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
