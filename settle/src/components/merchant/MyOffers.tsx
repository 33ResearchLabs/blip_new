"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Package,
  Plus,
  Edit3,
  Pause,
  Play,
  Trash2,
  ChevronDown,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Check,
  X,
  TrendingUp,
  DollarSign,
  Clock,
  Building2,
  MapPin,
  Info,
} from "lucide-react";

interface MerchantOffer {
  id: string;
  merchant_id: string;
  type: "buy" | "sell";
  payment_method: "bank" | "cash";
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  is_active: boolean;
  bank_name?: string;
  bank_account_name?: string;
  bank_iban?: string;
  location_name?: string;
  location_address?: string;
  created_at: string;
  updated_at: string;
}

interface MyOffersProps {
  merchantId: string;
  onCreateOffer: () => void;
}

interface EditFormData {
  rate: string;
  min_amount: string;
  max_amount: string;
  available_amount: string;
  is_active: boolean;
}

export function MyOffers({ merchantId, onCreateOffer }: MyOffersProps) {
  const [offers, setOffers] = useState<MerchantOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal state
  const [editingOffer, setEditingOffer] = useState<MerchantOffer | null>(null);
  const [editForm, setEditForm] = useState<EditFormData>({
    rate: "",
    min_amount: "",
    max_amount: "",
    available_amount: "",
    is_active: true,
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Toggle state (for pause/resume)
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Fetch merchant's offers
  const fetchOffers = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/merchant/offers?merchant_id=${merchantId}`);
      if (!res.ok) {
        throw new Error("Failed to fetch offers");
      }

      const data = await res.json();
      if (data.success) {
        // Parse numeric values
        const parsedOffers = (data.data || []).map((offer: MerchantOffer) => ({
          ...offer,
          rate: Number(offer.rate),
          min_amount: Number(offer.min_amount),
          max_amount: Number(offer.max_amount),
          available_amount: Number(offer.available_amount),
        }));
        setOffers(parsedOffers);
      } else {
        throw new Error(data.error || "Failed to fetch offers");
      }
    } catch (err) {
      console.error("[MyOffers] Error fetching offers:", err);
      setError(err instanceof Error ? err.message : "Failed to load offers");
    } finally {
      setIsLoading(false);
    }
  }, [merchantId]);

  // Initial fetch
  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  // Open edit modal
  const openEditModal = (offer: MerchantOffer) => {
    setEditingOffer(offer);
    setEditForm({
      rate: offer.rate.toString(),
      min_amount: offer.min_amount.toString(),
      max_amount: offer.max_amount.toString(),
      available_amount: offer.available_amount.toString(),
      is_active: offer.is_active,
    });
    setUpdateError(null);
  };

  // Close edit modal
  const closeEditModal = () => {
    setEditingOffer(null);
    setUpdateError(null);
  };

  // Validate edit form
  const validateForm = (): string | null => {
    const rate = parseFloat(editForm.rate);
    const minAmount = parseFloat(editForm.min_amount);
    const maxAmount = parseFloat(editForm.max_amount);
    const availableAmount = parseFloat(editForm.available_amount);

    if (isNaN(rate) || rate <= 0) {
      return "Rate must be a positive number";
    }
    if (isNaN(minAmount) || minAmount <= 0) {
      return "Minimum amount must be a positive number";
    }
    if (isNaN(maxAmount) || maxAmount <= 0) {
      return "Maximum amount must be a positive number";
    }
    if (maxAmount < minAmount) {
      return "Maximum amount must be greater than minimum amount";
    }
    if (isNaN(availableAmount) || availableAmount < 0) {
      return "Available amount must be a non-negative number";
    }
    return null;
  };

  // Update offer
  const handleUpdate = async () => {
    if (!editingOffer) return;

    const validationError = validateForm();
    if (validationError) {
      setUpdateError(validationError);
      return;
    }

    setIsUpdating(true);
    setUpdateError(null);

    try {
      const res = await fetch(`/api/merchant/offers/${editingOffer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate: parseFloat(editForm.rate),
          min_amount: parseFloat(editForm.min_amount),
          max_amount: parseFloat(editForm.max_amount),
          available_amount: parseFloat(editForm.available_amount),
          is_active: editForm.is_active,
        }),
      });

      const data = await res.json();

      if (data.success) {
        // Update local state
        setOffers((prev) =>
          prev.map((o) =>
            o.id === editingOffer.id
              ? {
                  ...o,
                  rate: parseFloat(editForm.rate),
                  min_amount: parseFloat(editForm.min_amount),
                  max_amount: parseFloat(editForm.max_amount),
                  available_amount: parseFloat(editForm.available_amount),
                  is_active: editForm.is_active,
                }
              : o
          )
        );
        closeEditModal();
      } else {
        throw new Error(data.error || "Failed to update offer");
      }
    } catch (err) {
      console.error("[MyOffers] Error updating offer:", err);
      setUpdateError(err instanceof Error ? err.message : "Failed to update offer");
    } finally {
      setIsUpdating(false);
    }
  };

  // Toggle offer active status
  const toggleOfferStatus = async (offer: MerchantOffer) => {
    setTogglingId(offer.id);

    try {
      const res = await fetch(`/api/merchant/offers/${offer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_active: !offer.is_active,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setOffers((prev) =>
          prev.map((o) =>
            o.id === offer.id ? { ...o, is_active: !o.is_active } : o
          )
        );
      } else {
        throw new Error(data.error || "Failed to toggle offer");
      }
    } catch (err) {
      console.error("[MyOffers] Error toggling offer:", err);
    } finally {
      setTogglingId(null);
    }
  };

  // Separate active and paused offers
  const activeOffers = offers.filter((o) => o.is_active);
  const pausedOffers = offers.filter((o) => !o.is_active);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-[#c9a962]" />
          <h2 className="text-sm font-semibold">My Offers</h2>
          <span className="text-xs text-gray-500">
            ({activeOffers.length} active, {pausedOffers.length} paused)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchOffers}
            disabled={isLoading}
            className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 text-gray-400 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onCreateOffer}
            className="flex items-center gap-2 px-3 py-2 bg-[#c9a962] hover:bg-[#d4b06d] text-black rounded-lg text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Offer</span>
          </button>
        </div>
      </div>

      {/* Info Notice */}
      <div className="flex items-start gap-2 px-3 py-2 bg-blue-500/5 rounded-xl border border-blue-500/10">
        <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-gray-400">
          Editing an offer only affects <span className="text-white">future orders</span>.
          Existing orders keep their locked rate and terms.
        </p>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-[#c9a962] animate-spin mb-3" />
          <p className="text-sm text-gray-500">Loading your offers...</p>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16">
          <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <button
            onClick={fetchOffers}
            className="px-4 py-2 bg-white/[0.04] hover:bg-white/[0.08] rounded-lg text-xs transition-colors"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && offers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Package className="w-12 h-12 text-gray-600 mb-3" />
          <p className="text-sm font-medium text-white mb-1">No offers yet</p>
          <p className="text-xs text-gray-500 text-center max-w-xs mb-4">
            Create your first offer to start receiving orders from customers.
          </p>
          <button
            onClick={onCreateOffer}
            className="flex items-center gap-2 px-4 py-2 bg-[#c9a962] hover:bg-[#d4b06d] text-black rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Create Offer</span>
          </button>
        </div>
      )}

      {/* Offers List */}
      {!isLoading && !error && offers.length > 0 && (
        <div className="space-y-3">
          {/* Active Offers */}
          {activeOffers.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Active</h3>
              {activeOffers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  onEdit={() => openEditModal(offer)}
                  onToggle={() => toggleOfferStatus(offer)}
                  isToggling={togglingId === offer.id}
                />
              ))}
            </div>
          )}

          {/* Paused Offers */}
          {pausedOffers.length > 0 && (
            <div className="space-y-2 mt-6">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider">Paused</h3>
              {pausedOffers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  onEdit={() => openEditModal(offer)}
                  onToggle={() => toggleOfferStatus(offer)}
                  isToggling={togglingId === offer.id}
                  isPaused
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      <AnimatePresence>
        {editingOffer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
              onClick={closeEditModal}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <div className="bg-[#151515] rounded-2xl border border-white/[0.08] shadow-2xl overflow-hidden">
                {/* Modal Header */}
                <div className="px-5 py-4 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/[0.08] flex items-center justify-center">
                      <Edit3 className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold">Edit Offer</h2>
                      <p className="text-[11px] text-gray-500">
                        {editingOffer.type.toUpperCase()} • {editingOffer.payment_method}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={closeEditModal}
                    className="p-2 hover:bg-white/[0.04] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="p-5 space-y-4">
                  {/* Warning */}
                  <div className="flex items-start gap-2 px-3 py-2 bg-white/5 rounded-xl border border-white/6">
                    <AlertTriangle className="w-4 h-4 text-white/70 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-white/50">
                      Edits affect new orders only. Active orders remain unchanged.
                    </p>
                  </div>

                  {/* Rate */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">
                      Rate (AED per USDC)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editForm.rate}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          rate: e.target.value.replace(/[^0-9.]/g, ""),
                        }))
                      }
                      className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none border border-white/[0.04] focus:border-[#c9a962]/50 transition-colors"
                      placeholder="3.67"
                    />
                  </div>

                  {/* Min/Max Amount */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">
                        Min Amount (USDC)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editForm.min_amount}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            min_amount: e.target.value.replace(/[^0-9.]/g, ""),
                          }))
                        }
                        className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none border border-white/[0.04] focus:border-[#c9a962]/50 transition-colors"
                        placeholder="50"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">
                        Max Amount (USDC)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editForm.max_amount}
                        onChange={(e) =>
                          setEditForm((prev) => ({
                            ...prev,
                            max_amount: e.target.value.replace(/[^0-9.]/g, ""),
                          }))
                        }
                        className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none border border-white/[0.04] focus:border-[#c9a962]/50 transition-colors"
                        placeholder="10000"
                      />
                    </div>
                  </div>

                  {/* Available Amount */}
                  <div>
                    <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-2 block">
                      Available Amount (USDC)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editForm.available_amount}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          available_amount: e.target.value.replace(/[^0-9.]/g, ""),
                        }))
                      }
                      className="w-full bg-[#1f1f1f] rounded-xl px-4 py-3 text-sm outline-none border border-white/[0.04] focus:border-[#c9a962]/50 transition-colors"
                      placeholder="5000"
                    />
                  </div>

                  {/* Status Toggle */}
                  <div className="flex items-center justify-between p-3 bg-[#1f1f1f] rounded-xl">
                    <div>
                      <p className="text-sm font-medium">Offer Status</p>
                      <p className="text-[11px] text-gray-500">
                        {editForm.is_active ? "Visible in marketplace" : "Hidden from marketplace"}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setEditForm((prev) => ({ ...prev, is_active: !prev.is_active }))
                      }
                      className={`w-12 h-6 rounded-full relative transition-colors ${
                        editForm.is_active ? "bg-emerald-500" : "bg-gray-600"
                      }`}
                    >
                      <div
                        className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          editForm.is_active ? "right-1" : "left-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Error Message */}
                  {updateError && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 rounded-xl border border-red-500/20">
                      <AlertTriangle className="w-4 h-4 text-red-400" />
                      <p className="text-xs text-red-400">{updateError}</p>
                    </div>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="px-5 py-4 border-t border-white/[0.04] flex items-center justify-end gap-3">
                  <button
                    onClick={closeEditModal}
                    className="px-4 py-2 text-gray-400 hover:text-white text-sm transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className="flex items-center gap-2 px-4 py-2 bg-[#c9a962] hover:bg-[#d4b06d] disabled:opacity-50 text-black rounded-lg text-sm font-medium transition-colors"
                  >
                    {isUpdating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Offer Card Component
function OfferCard({
  offer,
  onEdit,
  onToggle,
  isToggling,
  isPaused,
}: {
  offer: MerchantOffer;
  onEdit: () => void;
  onToggle: () => void;
  isToggling: boolean;
  isPaused?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 bg-[#151515] rounded-xl border transition-all ${
        isPaused
          ? "border-gray-700/50 opacity-60"
          : "border-white/[0.04] hover:border-white/[0.08]"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              offer.type === "buy"
                ? "bg-white/5 text-white"
                : "bg-white/5 text-white"
            }`}
          >
            {offer.type.toUpperCase()}
          </span>
          <span className="px-2 py-0.5 bg-white/[0.04] rounded text-[10px] text-gray-400">
            {offer.payment_method === "bank" ? (
              <span className="flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                Bank
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                Cash
              </span>
            )}
          </span>
          {isPaused && (
            <span className="px-2 py-0.5 bg-white/5 text-white/70 rounded text-[10px]">
              Paused
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-2 hover:bg-white/[0.08] rounded-lg transition-colors"
            title="Edit offer"
          >
            <Edit3 className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={onToggle}
            disabled={isToggling}
            className="p-2 hover:bg-white/[0.08] rounded-lg transition-colors"
            title={isPaused ? "Resume offer" : "Pause offer"}
          >
            {isToggling ? (
              <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            ) : isPaused ? (
              <Play className="w-4 h-4 text-white" />
            ) : (
              <Pause className="w-4 h-4 text-white/70" />
            )}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-gray-500 mb-1">Rate</p>
          <p className="text-lg font-bold text-white">{offer.rate.toFixed(4)}</p>
          <p className="text-[10px] text-gray-500">AED/USDC</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 mb-1">Available</p>
          <p className="text-lg font-bold text-white">
            {offer.available_amount.toLocaleString()}
          </p>
          <p className="text-[10px] text-gray-500">USDC</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[10px] text-gray-500">
        <span>
          Limits: {offer.min_amount.toLocaleString()} - {offer.max_amount.toLocaleString()} USDC
        </span>
        <span>
          Updated {new Date(offer.updated_at).toLocaleDateString()}
        </span>
      </div>

      {/* Payment Details */}
      {offer.payment_method === "bank" && offer.bank_name && (
        <div className="mt-2 text-[10px] text-gray-500">
          {offer.bank_name}
          {offer.bank_iban && ` • ${offer.bank_iban.slice(-4)}`}
        </div>
      )}
      {offer.payment_method === "cash" && offer.location_name && (
        <div className="mt-2 text-[10px] text-gray-500">
          {offer.location_name}
        </div>
      )}
    </motion.div>
  );
}

export default MyOffers;
