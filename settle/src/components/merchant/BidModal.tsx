"use client";

/**
 * BidModal — merchant-side quote submission for an auctioned order.
 *
 * Shown only when the order the merchant is looking at has
 * `auction_mode='auction'` and `auction.status='open'`. Submits to
 * `POST /api/orders/:id/bid` which is idempotent per
 * `(order_id, merchant_id)` — submitting again just refines the bid.
 *
 * Zero-regression contract: no existing merchant modal is modified.
 * This is a new file with a fully local state and a single external
 * effect (the POST). Closes on success or cancel.
 */

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Gavel, Zap, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { formatRate, formatCrypto } from '@/lib/format';
import { clampDecimal, DECIMAL_PRESETS } from '@/lib/input/sanitize';
import { MAX_IMPROVEMENT_BPS, MAX_WORSE_BPS } from '@/lib/matching/policy';

const ETA_OPTIONS = [30, 60, 180, 300] as const;

export interface BidModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderId: string;
  merchantId: string;
  /** Order's reference / base rate (e.g. 98.00). Shown as the benchmark to beat. */
  baseRate: number;
  /** Currency label (e.g. "AED", "INR") for the displayed payout math. */
  fiatCurrency?: string;
  /** Crypto amount being auctioned (e.g. 10 USDT). Used for payout preview. */
  cryptoAmount: number;
  /**
   * Existing bid for this merchant, if any. When present the modal opens
   * in "refine your bid" mode with fields pre-filled. Same POST endpoint
   * upserts on `(order_id, merchant_id)`.
   */
  existingBid?: { rate: number; max_amount: number; eta_seconds: number } | null;
  /** Called after a successful submit. Receives the server response body. */
  onSubmitted?: (data: unknown) => void;
}

export function BidModal({
  isOpen,
  onClose,
  orderId,
  merchantId,
  baseRate,
  fiatCurrency,
  cryptoAmount,
  existingBid,
  onSubmitted,
}: BidModalProps) {
  const [rate, setRate] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [etaSeconds, setEtaSeconds] = useState<number>(60);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset form whenever the modal opens. Pre-fill from existingBid so
  // "refine" feels natural; otherwise seed rate with base + 0.1 (a
  // tiny improvement) so the default already beats base.
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    if (existingBid) {
      setRate(existingBid.rate.toString());
      setMaxAmount(existingBid.max_amount.toString());
      setEtaSeconds(existingBid.eta_seconds);
    } else {
      const seed = Math.max(baseRate, baseRate + 0.1);
      setRate(seed.toFixed(2));
      setMaxAmount(cryptoAmount.toString());
      setEtaSeconds(60);
    }
  }, [isOpen, existingBid, baseRate, cryptoAmount]);

  const rateNum = useMemo(() => {
    const n = Number(rate);
    return Number.isFinite(n) ? n : 0;
  }, [rate]);
  const maxAmountNum = useMemo(() => {
    const n = Number(maxAmount);
    return Number.isFinite(n) ? n : 0;
  }, [maxAmount]);

  const beatsBase = rateNum > baseRate;
  const rateDelta = rateNum - baseRate;
  const payoutBase = baseRate * cryptoAmount;
  const payoutBid = rateNum * cryptoAmount;
  const payoutDelta = payoutBid - payoutBase;

  // Mirror the server-side bait / worse-than-base guard so the merchant
  // sees the valid range up-front instead of discovering it via rejection.
  const minAllowedRate = baseRate * (1 - MAX_WORSE_BPS / 10_000);
  const maxAllowedRate = baseRate * (1 + MAX_IMPROVEMENT_BPS / 10_000);
  const rateInRange =
    rateNum >= minAllowedRate && rateNum <= maxAllowedRate;
  const rateOutOfRangeReason =
    rateNum <= 0
      ? null
      : rateNum > maxAllowedRate
        ? `Too good — max allowed is ${formatRate(maxAllowedRate)} (+${(MAX_IMPROVEMENT_BPS / 100).toFixed(1)}%)`
        : rateNum < minAllowedRate
          ? `Too low — min allowed is ${formatRate(minAllowedRate)} (−${(MAX_WORSE_BPS / 100).toFixed(1)}%)`
          : null;

  const canSubmit =
    rateNum > 0 &&
    rateInRange &&
    maxAmountNum > 0 &&
    maxAmountNum >= cryptoAmount &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          rate: rateNum,
          max_amount: maxAmountNum,
          eta_seconds: etaSeconds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(body?.error ?? `Bid rejected (${res.status})`);
        return;
      }
      onSubmitted?.(body);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 24 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
          >
            <div
              className="pointer-events-auto bg-surface-base border border-border-subtle rounded-2xl w-full max-w-md shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border-subtle">
                <div className="flex items-center gap-2">
                  <Gavel className="w-5 h-5 text-accent" />
                  <h2 className="text-lg font-semibold">
                    {existingBid ? 'Refine your bid' : 'Place a bid'}
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="p-1 rounded-md hover:bg-surface-card text-text-tertiary"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Body */}
              <div className="p-4 space-y-4">
                <div className="bg-surface-card border border-border-subtle rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between text-sm text-text-tertiary">
                    <span>Base rate</span>
                    <span className="font-mono text-text-primary">
                      {formatRate(baseRate)} {fiatCurrency ?? ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-text-tertiary">
                    <span>Allowed range</span>
                    <span className="font-mono text-text-secondary">
                      {formatRate(minAllowedRate)} – {formatRate(maxAllowedRate)}
                    </span>
                  </div>
                </div>

                {/* Rate input */}
                <div>
                  <label className="text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase block mb-1">
                    Your rate
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rate}
                    maxLength={14}
                    onChange={(e) => setRate(clampDecimal(e.target.value, DECIMAL_PRESETS.rate))}
                    className="w-full bg-surface-card border border-border-subtle rounded-lg p-3 font-mono text-lg focus:outline-none focus:border-accent"
                    placeholder={baseRate.toFixed(2)}
                  />
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span
                      className={
                        rateOutOfRangeReason
                          ? 'text-error'
                          : beatsBase
                            ? 'text-success'
                            : 'text-warning'
                      }
                    >
                      {rateOutOfRangeReason
                        ? rateOutOfRangeReason
                        : beatsBase
                          ? `Beats base by +${rateDelta.toFixed(4)}`
                          : rateNum > 0
                            ? `${rateDelta.toFixed(4)} vs. base`
                            : 'Enter a rate'}
                    </span>
                    <span className="text-text-tertiary">
                      User gets {formatCrypto(payoutBid)} {fiatCurrency ?? ''}
                      {beatsBase && payoutDelta > 0
                        ? ` (+${formatCrypto(payoutDelta)})`
                        : ''}
                    </span>
                  </div>
                </div>

                {/* Max amount */}
                <div>
                  <label className="text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase block mb-1">
                    Max amount I can fulfill (USDT)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maxAmount}
                    maxLength={14}
                    onChange={(e) =>
                      setMaxAmount(clampDecimal(e.target.value, DECIMAL_PRESETS.amount))
                    }
                    className="w-full bg-surface-card border border-border-subtle rounded-lg p-3 font-mono"
                    placeholder={cryptoAmount.toString()}
                  />
                  {maxAmountNum > 0 && maxAmountNum < cryptoAmount && (
                    <div className="text-xs text-warning mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> must cover order amount ({formatCrypto(cryptoAmount)})
                    </div>
                  )}
                </div>

                {/* ETA */}
                <div>
                  <label className="text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase block mb-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> How fast you'll fulfill
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {ETA_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => setEtaSeconds(s)}
                        className={`py-2 rounded-lg text-sm border ${
                          etaSeconds === s
                            ? 'bg-primary text-background border-primary'
                            : 'bg-surface-card border-border-subtle text-text-secondary hover:border-border-medium'
                        }`}
                        type="button"
                      >
                        {s < 60 ? `${s}s` : `${Math.round(s / 60)}m`}
                      </button>
                    ))}
                  </div>
                </div>

                {errorMsg && (
                  <div className="text-sm text-error bg-error-dim border border-error-border rounded-lg p-2 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-border-subtle flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg border border-border-subtle text-text-secondary hover:bg-surface-card"
                  type="button"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className={`flex-1 py-2.5 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                    canSubmit
                      ? 'bg-primary text-background hover:brightness-110'
                      : 'bg-surface-card text-text-tertiary cursor-not-allowed'
                  }`}
                  type="button"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Submitting
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      {existingBid ? 'Update bid' : 'Submit bid'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
