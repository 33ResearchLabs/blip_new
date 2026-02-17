'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  Droplets,
  Clock,
  Send,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Copy,
  Check,
} from 'lucide-react';

interface CorridorLPPanelProps {
  merchantId: string | null;
}

interface Fulfillment {
  id: string;
  order_id: string;
  provider_merchant_id: string;
  provider_status: 'pending' | 'payment_sent' | 'completed' | 'failed' | 'cancelled';
  saed_amount_locked: number;
  fiat_amount: number;
  corridor_fee: number;
  bank_details: Record<string, unknown> | null;
  send_deadline: string;
  assigned_at: string;
  payment_sent_at: string | null;
  order_number?: string;
  seller_name?: string;
}

function formatDeadline(deadline: string): { text: string; urgent: boolean; expired: boolean } {
  const now = Date.now();
  const dl = new Date(deadline).getTime();
  const diffMs = dl - now;
  if (diffMs <= 0) return { text: 'EXPIRED', urgent: true, expired: true };
  const mins = Math.floor(diffMs / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);
  if (mins < 5) return { text: `${mins}:${String(secs).padStart(2, '0')}`, urgent: true, expired: false };
  return { text: `${mins}m`, urgent: false, expired: false };
}

export function CorridorLPPanel({ merchantId }: CorridorLPPanelProps) {
  const [fulfillments, setFulfillments] = useState<Fulfillment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchFulfillments = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/corridor/fulfillments?provider_merchant_id=${merchantId}`);
      const json = await res.json();
      if (json.success) {
        setFulfillments(json.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch LP fulfillments:', err);
    } finally {
      setLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    fetchFulfillments();
    const interval = setInterval(fetchFulfillments, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, [fetchFulfillments]);

  const handleMarkSent = async (fulfillmentId: string) => {
    if (!merchantId) return;
    setSendingId(fulfillmentId);
    try {
      const coreApiUrl = process.env.NEXT_PUBLIC_CORE_API_URL || 'http://localhost:4010';
      const res = await fetch(`${coreApiUrl}/v1/corridor/fulfillments/${fulfillmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_status: 'payment_sent',
          actor_id: merchantId,
        }),
      });
      const json = await res.json();
      if (json.success) {
        // Update local state
        setFulfillments(prev =>
          prev.map(f => f.id === fulfillmentId ? { ...f, provider_status: 'payment_sent' as const } : f)
        );
      }
    } catch (err) {
      console.error('Failed to mark payment sent:', err);
    } finally {
      setSendingId(null);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-white/30" />
      </div>
    );
  }

  if (fulfillments.length === 0) {
    return (
      <div className="text-center py-6">
        <Droplets className="w-6 h-6 text-white/20 mx-auto mb-2" />
        <p className="text-xs text-white/30">No active LP assignments</p>
        <p className="text-[10px] text-white/20 mt-1">
          When a buyer pays with sAED, you&apos;ll see assignments here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Droplets className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-white/80">LP Assignments</span>
        <span className="text-[10px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded-full">
          {fulfillments.length}
        </span>
      </div>

      {fulfillments.map((ff) => {
        const deadline = formatDeadline(ff.send_deadline);
        const isPending = ff.provider_status === 'pending';
        const isSent = ff.provider_status === 'payment_sent';
        const bank = ff.bank_details as Record<string, string> | null;

        return (
          <div
            key={ff.id}
            className={`border rounded-lg p-3 space-y-2 ${
              deadline.expired && isPending
                ? 'border-red-500/30 bg-red-500/5'
                : isPending
                ? 'border-yellow-500/20 bg-yellow-500/5'
                : 'border-white/10 bg-white/[0.02]'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/50">
                  #{ff.order_number || ff.order_id.slice(0, 8)}
                </span>
                {ff.seller_name && (
                  <span className="text-xs text-white/30">to {ff.seller_name}</span>
                )}
              </div>
              {isPending && (
                <div className={`flex items-center gap-1 text-xs ${deadline.urgent ? 'text-red-400' : 'text-yellow-400'}`}>
                  <Clock className="w-3 h-3" />
                  <span className="font-mono">{deadline.text}</span>
                </div>
              )}
              {isSent && (
                <span className="flex items-center gap-1 text-xs text-blue-400">
                  <Send className="w-3 h-3" />
                  Sent
                </span>
              )}
            </div>

            {/* Amount */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/90">
                {Number(ff.fiat_amount).toLocaleString()} AED
              </span>
              <span className="text-[10px] text-green-400/70">
                +{(ff.corridor_fee / 100).toFixed(2)} AED fee
              </span>
            </div>

            {/* Bank details */}
            {bank && isPending && (
              <div className="bg-white/5 rounded p-2 space-y-1">
                <div className="flex items-center gap-1 mb-1">
                  <Building2 className="w-3 h-3 text-white/30" />
                  <span className="text-[10px] text-white/40 uppercase">Send to</span>
                </div>
                {bank.bank_name && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/50">{bank.bank_name}</span>
                  </div>
                )}
                {bank.bank_account_name && (
                  <div className="text-xs text-white/60">{bank.bank_account_name}</div>
                )}
                {bank.bank_iban && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/70 font-mono">{bank.bank_iban}</span>
                    <button
                      onClick={() => copyToClipboard(bank.bank_iban, ff.id + '-iban')}
                      className="p-0.5"
                    >
                      {copiedField === ff.id + '-iban' ? (
                        <Check className="w-3 h-3 text-green-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-white/20 hover:text-white/40" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Action button */}
            {isPending && !deadline.expired && (
              <button
                onClick={() => handleMarkSent(ff.id)}
                disabled={sendingId === ff.id}
                className="w-full py-1.5 rounded bg-blue-600/80 hover:bg-blue-600 text-white text-xs font-medium disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
              >
                {sendingId === ff.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
                {sendingId === ff.id ? 'Marking...' : 'I Sent the Payment'}
              </button>
            )}

            {isPending && deadline.expired && (
              <div className="flex items-center gap-1.5 text-xs text-red-400 py-1">
                <AlertTriangle className="w-3 h-3" />
                <span>Deadline passed — may be reassigned</span>
              </div>
            )}

            {isSent && (
              <div className="flex items-center gap-1.5 text-xs text-blue-300/70 py-1">
                <CheckCircle2 className="w-3 h-3" />
                <span>Waiting for seller to confirm receipt</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
