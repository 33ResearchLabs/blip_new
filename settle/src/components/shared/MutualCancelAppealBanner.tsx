"use client";

/**
 * MutualCancelAppealBanner
 * ────────────────────────
 * Shown inside the order view when a mutual-cancellation appeal is active.
 *
 *   - Counterparty (not the opener): "Mutual Cancellation Requested" with
 *       [Agree to Cancel] [Reject Request] buttons.
 *   - Opener: a "waiting for the other party" notice (no actions).
 *
 * Agree → order cancelled + escrow refunded. Reject → order escalated to a
 * formal dispute. An unanswered request auto-escalates to a dispute after the
 * appeal deadline (server-side worker).
 *
 * Renders nothing unless there is an ACTIVE mutual_cancel appeal — safe to mount
 * unconditionally in an order view. `variant` selects the light (user) or dark
 * (merchant) theme.
 */
import { useOrderAppeal, isActiveAppeal } from "@/hooks/useOrderAppeal";

export interface MutualCancelAppealBannerProps {
  orderId: string;
  /** The current viewer's actor id (user id or merchant id). */
  viewerActorId: string | null | undefined;
  variant?: "user" | "merchant";
  /** Poll only while the order is in a state where an appeal can be active. */
  enabled?: boolean;
  /** Extra classes for the outer card (e.g. margin) — applied only when shown. */
  className?: string;
  /** Fired after a successful response so the parent can refresh order state. */
  onResolved?: (outcome: { disputed?: boolean; cancelled?: boolean }) => void;
}

export function MutualCancelAppealBanner({
  orderId,
  viewerActorId,
  variant = "user",
  enabled = true,
  className = "",
  onResolved,
}: MutualCancelAppealBannerProps) {
  const { appeal, viewerRole, responding, error, respond } = useOrderAppeal(orderId, { enabled });

  // Only the mutual-cancellation flow uses this banner. Other appeal issues are
  // surfaced in chat and auto-escalate on timeout.
  if (!isActiveAppeal(appeal) || appeal?.issue_key !== "mutual_cancel") return null;

  const isOpener = !!viewerActorId && appeal!.opener_id === viewerActorId;
  const openerLabel =
    viewerRole === "buyer" ? "The seller" : viewerRole === "seller" ? "The buyer" : "The other party";

  const dark = variant === "merchant";
  const onRespond = async (action: "agree" | "reject") => {
    const res = await respond(action);
    if (res.ok) onResolved?.({ disputed: res.disputed, cancelled: res.cancelled });
  };

  // ── Container styles per theme ──
  const card =
    (dark
      ? "rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4"
      : "rounded-2xl border border-amber-300 bg-amber-50 p-4") + (className ? ` ${className}` : "");
  const titleCls = dark ? "text-[14px] font-semibold text-[#f5f5f7]" : "text-[14px] font-semibold text-neutral-900";
  const bodyCls = dark ? "text-[12.5px] text-[#a1a1a6] leading-snug" : "text-[12.5px] text-neutral-600 leading-snug";

  // ── Opener: waiting state (no actions) ──
  if (isOpener) {
    return (
      <div className={card}>
        <p className={titleCls}>Cancellation request sent</p>
        <p className={`${bodyCls} mt-1`}>
          Waiting for the other party to respond. If they reject — or don&apos;t respond in
          time — this becomes a dispute for review.
        </p>
      </div>
    );
  }

  // ── Counterparty: agree / reject ──
  const agreeBtn = dark
    ? "flex-1 py-2.5 rounded-xl text-[14px] font-semibold bg-white text-black disabled:opacity-40 flex items-center justify-center"
    : "flex-1 py-2.5 rounded-xl text-[14px] font-semibold bg-neutral-900 text-white disabled:opacity-40 flex items-center justify-center";
  const rejectBtn = dark
    ? "flex-1 py-2.5 rounded-xl text-[14px] font-semibold border border-white/20 text-[#f5f5f7] disabled:opacity-40 flex items-center justify-center"
    : "flex-1 py-2.5 rounded-xl text-[14px] font-semibold border border-neutral-300 text-neutral-800 disabled:opacity-40 flex items-center justify-center";

  const busy = responding !== null;

  return (
    <div className={card}>
      <p className={titleCls}>Mutual Cancellation Requested</p>
      <p className={`${bodyCls} mt-1`}>
        {openerLabel} wants to cancel this trade.
        {appeal!.description ? ` “${appeal!.description}”` : ""}
      </p>
      <p className={`${bodyCls} mt-1`}>
        Rejecting opens a dispute for review.
      </p>
      {error && (
        <p className={`mt-2 text-[12px] ${dark ? "text-amber-300" : "text-neutral-700"}`}>{error}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          className={agreeBtn}
          disabled={busy}
          onClick={() => onRespond("agree")}
        >
          {responding === "agree" ? "Cancelling…" : "Agree to Cancel"}
        </button>
        <button
          type="button"
          className={rejectBtn}
          disabled={busy}
          onClick={() => onRespond("reject")}
        >
          {responding === "reject" ? "Opening dispute…" : "Reject Request"}
        </button>
      </div>
    </div>
  );
}
