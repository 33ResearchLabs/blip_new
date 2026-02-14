'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Building2, Wallet, CreditCard, DollarSign, Check, Loader2, AlertCircle } from 'lucide-react';

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
  { type: 'bank' as const, label: 'Bank Account', icon: Building2, color: 'blue' },
  { type: 'cash' as const, label: 'Cash Meeting', icon: DollarSign, color: 'green' },
  { type: 'crypto' as const, label: 'Crypto Wallet', icon: Wallet, color: 'orange' },
  { type: 'card' as const, label: 'Card Payment', icon: CreditCard, color: 'purple' },
  { type: 'mobile' as const, label: 'Mobile Money', icon: CreditCard, color: 'pink' },
];

export function PaymentMethodModal({ isOpen, onClose, merchantId }: PaymentMethodModalProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedType, setSelectedType] = useState<'bank' | 'cash' | 'crypto' | 'card' | 'mobile'>('bank');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
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

  const handleAddMethod = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Validate based on type
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
          if (!formData.location) {
            throw new Error('Please specify meeting location');
          }
          name = 'Cash Meeting';
          details = formData.location;
          break;
        case 'crypto':
          if (!formData.walletAddress) {
            throw new Error('Please provide wallet address');
          }
          name = 'Crypto Wallet';
          details = formData.walletAddress;
          break;
        case 'card':
          if (!formData.cardNumber || !formData.cardholderName) {
            throw new Error('Please provide card details');
          }
          name = 'Card Payment';
          details = `${formData.cardholderName} - **** ${formData.cardNumber.slice(-4)}`;
          break;
        case 'mobile':
          if (!formData.mobileNumber || !formData.mobileProvider) {
            throw new Error('Please provide mobile payment details');
          }
          name = formData.mobileProvider;
          details = formData.mobileNumber;
          break;
      }

      // Add to local state (in real app, would save to API)
      const newMethod: PaymentMethod = {
        id: Date.now().toString(),
        type: selectedType,
        name,
        details,
        isDefault: paymentMethods.length === 0,
      };

      setPaymentMethods([...paymentMethods, newMethod]);

      // Reset form
      setFormData({
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
    setPaymentMethods(paymentMethods.map(m => ({
      ...m,
      isDefault: m.id === id,
    })));
  };

  const renderFormFields = () => {
    switch (selectedType) {
      case 'bank':
        return (
          <>
            <input
              type="text"
              placeholder="Bank Name (e.g., Emirates NBD)"
              value={formData.bankName}
              onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
            <input
              type="text"
              placeholder="Account Holder Name"
              value={formData.accountName}
              onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
            <input
              type="text"
              placeholder="Account Number"
              value={formData.accountNumber}
              onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
            <input
              type="text"
              placeholder="IBAN (Optional)"
              value={formData.iban}
              onChange={(e) => setFormData({ ...formData, iban: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
            <input
              type="text"
              placeholder="SWIFT Code (Optional)"
              value={formData.swiftCode}
              onChange={(e) => setFormData({ ...formData, swiftCode: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
          </>
        );
      case 'cash':
        return (
          <textarea
            placeholder="Meeting Location (e.g., Dubai Mall, Burj Khalifa entrance)"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
            rows={3}
            className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50 resize-none"
          />
        );
      case 'crypto':
        return (
          <input
            type="text"
            placeholder="Wallet Address (e.g., 0x...)"
            value={formData.walletAddress}
            onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value })}
            className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
          />
        );
      case 'card':
        return (
          <>
            <input
              type="text"
              placeholder="Cardholder Name"
              value={formData.cardholderName}
              onChange={(e) => setFormData({ ...formData, cardholderName: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
            <input
              type="text"
              placeholder="Card Number (last 4 digits)"
              value={formData.cardNumber}
              onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
              maxLength={4}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
          </>
        );
      case 'mobile':
        return (
          <>
            <input
              type="text"
              placeholder="Provider (e.g., PayTM, Google Pay)"
              value={formData.mobileProvider}
              onChange={(e) => setFormData({ ...formData, mobileProvider: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
            <input
              type="text"
              placeholder="Mobile Number"
              value={formData.mobileNumber}
              onChange={(e) => setFormData({ ...formData, mobileNumber: e.target.value })}
              className="w-full px-4 py-2 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-500/50"
            />
          </>
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
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-2xl bg-[#0a0a0a] rounded-2xl border border-white/[0.08] shadow-2xl max-h-[90vh] flex flex-col"
        >
          <div className="flex items-center justify-between p-6 border-b border-white/[0.06]">
            <div>
              <h2 className="text-2xl font-bold text-white">Payment Methods</h2>
              <p className="text-sm text-gray-400 mt-1">Manage your payment options</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {!showAddForm ? (
              <div className="space-y-4">
                {paymentMethods.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4">
                      <CreditCard className="w-8 h-8 text-gray-500" />
                    </div>
                    <p className="text-gray-500 mb-2">No payment methods added</p>
                    <p className="text-xs text-gray-600">Add your first payment method to start trading</p>
                  </div>
                ) : (
                  paymentMethods.map((method) => {
                    const methodType = PAYMENT_METHOD_TYPES.find(t => t.type === method.type);
                    const Icon = methodType?.icon || CreditCard;

                    return (
                      <div
                        key={method.id}
                        className="flex items-center gap-4 p-4 bg-white/[0.02] rounded-xl border border-white/[0.06] hover:bg-white/[0.04] transition-colors"
                      >
                        <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center shrink-0">
                          <Icon className="w-6 h-6 text-orange-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-white">{method.name}</p>
                            {method.isDefault && (
                              <span className="px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded-full text-[10px] text-green-400 font-medium">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{method.details}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {!method.isDefault && (
                            <button
                              onClick={() => handleSetDefault(method.id)}
                              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs transition-colors"
                            >
                              Set Default
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveMethod(method.id)}
                            className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <X className="w-4 h-4 text-red-400" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-3 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-xl text-orange-500 font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Payment Method</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-white mb-3">Select Payment Type</p>
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHOD_TYPES.map((type) => (
                      <button
                        key={type.type}
                        onClick={() => setSelectedType(type.type)}
                        className={`p-3 rounded-lg border transition-all ${
                          selectedType === type.type
                            ? 'bg-orange-500/10 border-orange-500/30 text-orange-500'
                            : 'bg-white/[0.02] border-white/[0.06] text-gray-400 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <type.icon className="w-5 h-5" />
                          <span className="text-sm font-medium">{type.label}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-medium text-white">Payment Details</p>
                  {renderFormFields()}
                </div>

                {error && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-red-400" />
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowAddForm(false);
                      setError(null);
                    }}
                    className="flex-1 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddMethod}
                    disabled={isLoading}
                    className="flex-1 px-4 py-2 bg-orange-500 hover:bg-orange-600 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Adding...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Add Method</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 border-t border-white/[0.06]">
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-sm"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
