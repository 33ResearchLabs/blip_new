"use client";

/**
 * useCancelOrderSheet
 * ───────────────────
 * Small controller so every cancel entry point shares one consistent
 * confirm → loading → success/error flow without duplicating state. It owns the
 * sheet's open/loading/error state and renders `CancelOrderSheet`; the caller
 * only supplies the order snapshot and the *existing* cancel function to run on
 * confirm. No business logic lives here.
 *
 *   const cancel = useCancelOrderSheet();
 *   // open the sheet:
 *   cancel.request(orderLike, {
 *     role: "seller",
 *     onConfirm: doCancel,   // async; throw to keep the sheet open with an error
 *     onSuccess: goHome,     // runs only after onConfirm resolves
 *     onSecondary: openHelp, // blocked-stage route (optional)
 *   });
 *   // render once in the screen:
 *   {cancel.sheet}
 */

import { useCallback, useRef, useState } from "react";
import { CancelOrderSheet } from "@/components/user/CancelOrderSheet";
import { resolveCancelDialog, type CancelOrderLike } from "@/lib/orders/resolveCancelDialog";

interface CancelRequestOpts {
  role?: "buyer" | "seller";
  /** The actual cancel. Resolve = success; throw = inline error, sheet stays. */
  onConfirm: () => Promise<void> | void;
  /** Runs after a successful confirm, once the sheet has closed. */
  onSuccess?: () => void;
  /** Blocked-stage alternative route (help / appeal / chat). */
  onSecondary?: () => void;
}

const GENERIC_ERROR =
  "We couldn't cancel just now. Your order is unchanged and your funds are safe.";
const TIMEOUT_ERROR =
  "This is taking longer than expected. Your order is unchanged — please try again.";
// Universal safety net so no onConfirm can hang the sheet on an infinite
// spinner, even when the caller's handler has no timeout of its own. Callers
// with a tighter abort (e.g. MatchingScreen at 18s) simply trip first.
const CONFIRM_TIMEOUT_MS = 20_000;

export function useCancelOrderSheet() {
  const [order, setOrder] = useState<CancelOrderLike | null>(null);
  const [opts, setOpts] = useState<CancelRequestOpts | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Dedicated in-flight lock — synchronous, so two taps in the same tick can't
  // both pass (React state updates are async and would let the second through).
  const inFlight = useRef(false);

  const request = useCallback((o: CancelOrderLike, o2: CancelRequestOpts) => {
    inFlight.current = false;
    setOrder(o);
    setOpts(o2);
    setError(null);
    setLoading(false);
    setOpen(true);
  }, []);

  // Safe/primary action + scrim dismissal. Blocked while a cancel is in flight.
  const close = useCallback(() => {
    if (inFlight.current) return;
    setOpen(false);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!opts || inFlight.current) return; // synchronous duplicate-submit guard
    inFlight.current = true;
    setLoading(true);
    setError(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(opts.onConfirm()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(TIMEOUT_ERROR)), CONFIRM_TIMEOUT_MS);
        }),
      ]);
      inFlight.current = false;
      setLoading(false);
      setOpen(false);
      opts.onSuccess?.();
    } catch (e) {
      inFlight.current = false;
      setLoading(false);
      setError(e instanceof Error && e.message ? e.message : GENERIC_ERROR);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [opts]);

  const handleSecondary = useCallback(() => {
    if (inFlight.current) return;
    setOpen(false);
    opts?.onSecondary?.();
  }, [opts]);

  const config = order ? resolveCancelDialog(order, { role: opts?.role }) : null;

  const sheet = (
    <CancelOrderSheet
      open={open}
      config={config}
      loading={loading}
      error={error}
      onClose={close}
      onConfirm={handleConfirm}
      onSecondary={handleSecondary}
    />
  );

  return { request, sheet };
}
