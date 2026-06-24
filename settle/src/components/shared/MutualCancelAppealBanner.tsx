"use client";

/**
 * MutualCancelAppealBanner
 * ────────────────────────
 * Shown inside an order view when an appeal is ACTIVE. (Despite the name it now
 * also confirms NON-cancellation appeals to the opener — the Agree/Reject
 * actions stay mutual_cancel-only.)
 *
 *   - Opener (ANY appeal type): "You raised an appeal" + the issue + a live
 *       countdown to the appeal deadline. Escalates to a dispute if unanswered.
 *   - Counterparty of a mutual_cancel appeal: "Mutual Cancellation Requested"
 *       with [Agree to Cancel] [Reject] + the same countdown.
 *   - Counterparty of any OTHER appeal type: nothing here (surfaced in chat,
 *       auto-escalates on the deadline).
 *
 * Renders nothing unless there is an ACTIVE appeal — safe to mount
 * unconditionally in an order view. `variant` selects the light (user) or dark
 * (merchant) theme.
 */
import { useEffect, useState } from "react";
import { useOrderAppeal, isActiveAppeal } from "@/hooks/useOrderAppeal";
import { getAppealIssue } from "@/lib/appeals/issues";

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

/**
 * Live countdown to an ISO deadline. Re-renders every second. Returns null when
 * there's no deadline, and { expired: true } once the deadline has passed.
 */
function useCountdown(deadlineIso: string | null): { text: string; expired: boolean } | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineIso) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadlineIso]);

  if (!deadlineIso) return null;
  const diff = new Date(deadlineIso).getTime() - nowMs;
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return { text: "0s", expired: true };

  const total = Math.floor(diff / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, "0")}s`;
  return { text, expired: false };
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
  // Hook must run unconditionally (before any early return) — rules of hooks.
  const countdown = useCountdown(appeal?.appeal_deadline ?? null);

  if (!isActiveAppeal(appeal)) return null;

  const isMutualCancel = appeal!.issue_key === "mutual_cancel";
  const isOpener = !!viewerActorId && appeal!.opener_id === viewerActorId;
  const issueLabel = getAppealIssue(appeal!.issue_key)?.label ?? null;
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
  const timeCls = dark ? "text-[12px] font-semibold text-amber-300" : "text-[12px] font-semibold text-amber-700";

  // Remaining-time line — shared by opener + counterparty views.
  const timeLine = (suffix: string) =>
    countdown ? (
      countdown.expired ? (
        <p className={`${bodyCls} mt-1`}>Time&apos;s up — escalating to a dispute for review…</p>
      ) : (
        <p className={`mt-1 ${timeCls}`}>
          {countdown.text} {suffix}
        </p>
      )
    ) : null;

  // ── Opener: confirmation + countdown (ANY appeal type) ──
  if (isOpener) {
    return (
      <div className={card}>
        <p className={titleCls}>
          {isMutualCancel ? "You requested a cancellation" : "You raised an appeal"}
        </p>
        {!isMutualCancel && issueLabel && <p className={`${bodyCls} mt-1`}>{issueLabel}</p>}
        <p className={`${bodyCls} mt-1`}>
          Waiting for the other party to respond. If they don&apos;t respond in time, this
          {isMutualCancel ? " becomes" : " escalates to"} a dispute for review.
        </p>
        {timeLine("remaining")}
      </div>
    );
  }

  // ── Counterparty of a non-cancellation appeal: surfaced in chat, not here. ──
  if (!isMutualCancel) return null;

  // ── Counterparty of mutual_cancel: agree / reject ──
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
      <p className={`${bodyCls} mt-1`}>Rejecting opens a dispute for review.</p>
      {timeLine("left to respond")}
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
