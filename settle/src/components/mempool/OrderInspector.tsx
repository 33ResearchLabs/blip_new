'use client';

import { useState, useEffect } from 'react';
import { X, ArrowUpCircle, CheckCircle, Clock, TrendingUp, Activity, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface MempoolOrder {
  id: string;
  order_number: string;
  corridor_id: string;
  side: string;
  amount_usdt: number;
  ref_price_at_create: number;
  premium_bps_current: number;
  premium_bps_cap: number;
  bump_step_bps: number;
  current_offer_price: number;
  max_offer_price: number;
  expires_at: string;
  seconds_until_expiry: number;
  creator_username: string | null;
  auto_bump_enabled: boolean;
  created_at: string;
}

interface OrderEvent {
  id: string;
  event_type: string;
  payload: any;
  created_at: string;
}

interface OrderInspectorProps {
  order: MempoolOrder | null;
  merchantId?: string;
  onClose: () => void;
  onBump?: (orderId: string) => void;
  onAccept?: (orderId: string) => void;
}

export function OrderInspector({
  order,
  merchantId,
  onClose,
  onBump,
  onAccept,
}: OrderInspectorProps) {
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [isBumping, setIsBumping] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);

  useEffect(() => {
    if (order) {
      fetchEvents();
    }
  }, [order?.id]);

  const fetchEvents = async () => {
    if (!order) return;

    setIsLoadingEvents(true);
    try {
      const res = await fetch(`/api/mempool?type=events&order_id=${order.id}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setEvents(data.data.events || []);
        }
      }
    } catch (error) {
      console.error('Failed to fetch order events:', error);
    } finally {
      setIsLoadingEvents(false);
    }
  };

  const handleBump = async () => {
    if (!order || isBumping) return;

    setIsBumping(true);
    try {
      const res = await fetch('/api/mempool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bump',
          order_id: order.id,
          is_auto: false,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          onBump?.(order.id);
          await fetchEvents();
        } else {
          alert(data.error || 'Failed to bump order');
        }
      }
    } catch (error) {
      console.error('Failed to bump order:', error);
      alert('Failed to bump order');
    } finally {
      setIsBumping(false);
    }
  };

  const handleAccept = async () => {
    if (!order || !merchantId || isAccepting) return;

    setIsAccepting(true);
    try {
      const res = await fetch('/api/mempool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'accept',
          order_id: order.id,
          merchant_id: merchantId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          onAccept?.(order.id);
          alert('Order accepted successfully!');
          onClose();
        } else {
          alert(data.error || 'Failed to accept order');
        }
      }
    } catch (error) {
      console.error('Failed to accept order:', error);
      alert('Failed to accept order');
    } finally {
      setIsAccepting(false);
    }
  };

  const formatEventType = (type: string): string => {
    return type.replace(/_/g, ' ');
  };

  const getEventIcon = (type: string) => {
    if (type.includes('BUMP')) return <TrendingUp className="w-3 h-3" />;
    if (type.includes('ACCEPT')) return <CheckCircle className="w-3 h-3" />;
    return <Activity className="w-3 h-3" />;
  };

  if (!order) return null;

  const canBump = order.premium_bps_current < order.premium_bps_cap;
  const premiumPercent = (Number(order.premium_bps_current) / 100).toFixed(2);
  const capPercent = (Number(order.premium_bps_cap) / 100).toFixed(2);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          className="bg-[#0d0d0d] rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] border border-white/[0.08] shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
            <div>
              <h2 className="text-lg font-bold text-white font-mono">
                ORDER #{order.order_number}
              </h2>
              <p className="text-xs text-white/50 font-mono mt-0.5">
                {order.corridor_id} • {order.side}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5 text-white/60" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Order Details */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-white/40 font-mono uppercase mb-1">Amount</div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {Number(order.amount_usdt).toFixed(2)} USDT
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-white/40 font-mono uppercase mb-1">Current Price</div>
                  <div className="text-2xl font-bold text-[#c9a962] font-mono">
                    {Number(order.current_offer_price).toFixed(6)}
                  </div>
                  <div className="text-[10px] text-white/40 font-mono">AED/USDT</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-white/40 font-mono uppercase mb-1">Ref Price</div>
                  <div className="text-sm font-mono text-white/70">
                    {Number(order.ref_price_at_create).toFixed(6)}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-white/40 font-mono uppercase mb-1">Max Price</div>
                  <div className="text-sm font-mono text-white/70">
                    {Number(order.max_offer_price).toFixed(6)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-white/40 font-mono uppercase mb-1">Premium</div>
                  <div className="text-lg font-bold text-[#c9a962] font-mono">
                    +{premiumPercent}%
                  </div>
                  <div className="text-[10px] text-white/40 font-mono">
                    {order.premium_bps_current} bps / {order.premium_bps_cap} bps cap
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-white/40 font-mono uppercase mb-1">Time Remaining</div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-white/40" />
                    <span className="text-lg font-bold text-white font-mono">
                      {Math.floor(order.seconds_until_expiry / 60)}m {order.seconds_until_expiry % 60}s
                    </span>
                  </div>
                </div>
              </div>

              {order.auto_bump_enabled && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-green-400 font-mono">
                      Auto-bump enabled (+{order.bump_step_bps} bps every bump)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              {canBump && (
                <button
                  onClick={handleBump}
                  disabled={isBumping}
                  className="flex-1 px-4 py-3 rounded-lg bg-[#c9a962]/20 border border-[#c9a962]/30
                             text-[#c9a962] hover:bg-[#c9a962]/30 transition-colors font-medium font-mono
                             disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isBumping ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Bumping...
                    </>
                  ) : (
                    <>
                      <ArrowUpCircle className="w-4 h-4" />
                      Bump Priority
                    </>
                  )}
                </button>
              )}

              {merchantId && (
                <button
                  onClick={handleAccept}
                  disabled={isAccepting}
                  className="flex-1 px-4 py-3 rounded-lg bg-[#c9a962] text-black font-medium font-mono
                             hover:bg-[#d4b76e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                             flex items-center justify-center gap-2"
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Accept Order
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Events Timeline */}
            <div>
              <div className="text-xs font-bold text-white/70 font-mono uppercase mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Event History
              </div>

              {isLoadingEvents ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 text-[#c9a962] animate-spin" />
                </div>
              ) : events.length === 0 ? (
                <div className="text-center py-8 text-white/40 text-sm font-mono">
                  No events yet
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div
                      key={event.id}
                      className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-lg"
                    >
                      <div className="flex items-start gap-3">
                        <div className="text-[#c9a962] mt-0.5">
                          {getEventIcon(event.event_type)}
                        </div>
                        <div className="flex-1">
                          <div className="text-sm text-white font-mono">
                            {formatEventType(event.event_type)}
                          </div>
                          {event.payload && (
                            <div className="text-xs text-white/50 font-mono mt-1">
                              {JSON.stringify(event.payload, null, 2)}
                            </div>
                          )}
                          <div className="text-[9px] text-white/30 font-mono mt-1">
                            {new Date(event.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
