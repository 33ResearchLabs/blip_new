"use client";

/**
 * useOrphanedEscrowRecovery — heals orphan sell-order on-chain escrows.
 *
 * The user flow that strands money:
 *   1. User clicks "Confirm & Lock" on a sell trade.
 *   2. Anchor program runs CreateTrade + FundEscrow successfully (USDT moves
 *      into the escrow PDA, signature returned to the client).
 *   3. The follow-up POST /api/orders that registers the order in our DB
 *      fails for any reason (5xx, network drop, browser tab killed, session
 *      expiry race). No DB row exists, the on-chain escrow has no owner the
 *      backend can match, OnChainReconciliationWorker can't see it because
 *      its query requires `escrow_trade_id` on an existing order, and 15 min
 *      later the now-unrelated buy order in `pending` is cron-expired.
 *
 * The fix: the SELL path in useUserTradeCreation persists the full POST body
 * to localStorage under a `blip_orphan_sell_<txHash>` key BEFORE making the
 * network call. This hook scans those keys on mount and retries the POST.
 * Idempotency is guaranteed by the same tx-anchored key that the original
 * call used, so a successful original + a retry collapse to a single order.
 */

import { useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

const KEY_PREFIX = "blip_orphan_sell_";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type OrphanRecord = {
  payload: Record<string, unknown>;
  idempotencyKey: string;
  timestamp: number;
};

export function useOrphanedEscrowRecovery({
  userId,
  onRecovered,
}: {
  userId: string | null;
  onRecovered?: () => void;
}) {
  const didScanRef = useRef(false);

  useEffect(() => {
    if (didScanRef.current) return;
    if (!userId) return;
    if (typeof window === "undefined") return;
    didScanRef.current = true;

    let keys: string[] = [];
    try {
      keys = Object.keys(localStorage).filter((k) => k.startsWith(KEY_PREFIX));
    } catch {
      return;
    }
    if (keys.length === 0) return;

    let anyRecovered = false;
    let pending = keys.length;
    const maybeNotify = () => {
      if (--pending === 0 && anyRecovered) onRecovered?.();
    };

    for (const key of keys) {
      let record: OrphanRecord | null = null;
      try {
        record = JSON.parse(localStorage.getItem(key) || "null");
      } catch {
        try { localStorage.removeItem(key); } catch {}
        maybeNotify();
        continue;
      }
      if (!record || !record.payload || !record.idempotencyKey) {
        try { localStorage.removeItem(key); } catch {}
        maybeNotify();
        continue;
      }
      // Expire after 7 days — no point retrying ancient orphans, the on-chain
      // escrow should be emergency-refunded by then.
      if (Date.now() - (record.timestamp || 0) > TTL_MS) {
        try { localStorage.removeItem(key); } catch {}
        maybeNotify();
        continue;
      }
      // Only retry orphans owned by the currently signed-in user.
      if ((record.payload as { user_id?: string }).user_id !== userId) {
        maybeNotify();
        continue;
      }

      // eslint-disable-next-line no-console
      console.info("[EscrowRecovery] Retrying orphaned sell order", {
        key,
        tx: (record.payload as { escrow_tx_hash?: string }).escrow_tx_hash,
      });

      fetchWithAuth("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": record.idempotencyKey,
        },
        body: JSON.stringify(record.payload),
      })
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json().catch(() => null);
          if (data?.success) {
            try { localStorage.removeItem(key); } catch {}
            anyRecovered = true;
            // eslint-disable-next-line no-console
            console.info("[EscrowRecovery] Order recovered", {
              orderId: data?.data?.id,
            });
          }
        })
        .catch(() => {
          // Leave the key in localStorage for the next mount.
        })
        .finally(maybeNotify);
    }
  }, [userId, onRecovered]);
}
