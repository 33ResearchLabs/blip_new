"use client";

/**
 * MutualCancelAppealBanner  (a.k.a. the active-appeal resolution banner)
 * ─────────────────────────────────────────────────────────────────────
 * Shown inside an order view whenever an appeal is ACTIVE (open | proposed).
 * It now drives the full BILATERAL resolution flow — not just mutual cancel —
 * so both parties can resolve an appeal themselves before it escalates:
 *
 *   • Seller, after the buyer paid (payment_sent)  → [Release crypto to buyer]
 *       MOCK mode releases immediately; real mode hands off to the parent's
 *       on-chain release flow via `onReleaseRequest` (the seller signs).
 *   • Either party, before fiat (accepted/escrowed) → [Propose cancel & refund]
 *       (or [Agree to Cancel] when the opener already asked for a mutual cancel);
 *       the counterparty accepts → order cancelled + escrow refunded.
 *   • A standing proposal shows the other party [Accept] / [Reject].
 *   • [Reject] always escalates to a moderator dispute.
 *   • The opener, with no action of their own, sees a waiting view + a live
 *       countdown to the auto-escalation deadline.
 *
 * Renders nothing unless there is an ACTIVE appeal — safe to mount
 * unconditionally in an order view. `variant` selects the light (user) or dark
 * (merchant) theme.
 */
import { useEffect, useState } from "react";
import { useOrderAppeal, isActiveAppeal, type AppealResolution } from "@/hooks/useOrderAppeal";
import { getAppealIssue, appealStageFor } from "@/lib/appeals/issues";

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
  onResolved?: (outcome: { disputed?: boolean; cancelled?: boolean; completed?: boolean }) => void;
  /**
   * Real mode only: invoked when the seller chooses to release but the release
   * must be signed on-chain. The parent runs its existing seller release flow
   * (e.g. the escrow-release modal); the appeal then closes server-side.
   */
  onReleaseRequest?: () => void;
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
  onReleaseRequest,
}: MutualCancelAppealBannerProps) {
  const { appeal, viewerRole, responding, error, respond, propose, accept } = useOrderAppeal(orderId, {
    enabled,
  });
  // Hook must run unconditionally (before any early return) — rules of hooks.
  const countdown = useCountdown(appeal?.appeal_deadline ?? null);

  if (!isActiveAppeal(appeal)) return null;
  const a = appeal!;

  const stage = appealStageFor(a.order_status); // 'accepted' | 'escrowed' | 'payment_sent'
  const preFiat = stage === "accepted" || stage === "escrowed";
  const isOpener = !!viewerActorId && a.opener_id === viewerActorId;
  const isSeller = viewerRole === "seller";
  const isMutualCancelIssue = a.issue_key === "mutual_cancel";
  const issueLabel = getAppealIssue(a.issue_key)?.label ?? null;
  const otherPartyLabel =
    viewerRole === "buyer" ? "The seller" : viewerRole === "seller" ? "The buyer" : "The other party";

  const hasProposal = a.status === "proposed" && !!a.proposed_resolution;
  const proposalMine = hasProposal && !!viewerActorId && a.proposed_by_id === viewerActorId;
  const busy = responding !== null;
  const dark = variant === "merchant";

  // ── Action handlers ──
  // Release: ask the backend; in real mode it returns releaseRequired and we hand
  // off to the parent's on-chain release flow. In MOCK mode it completes directly.
  const doRelease = async () => {
    const res = await accept("complete");
    if (res.releaseRequired) {
      onReleaseRequest?.();
      return;
    }
    if (res.ok) onResolved?.({ completed: res.completed });
  };
  const doProposeCancel = async () => {
    await propose("mutual_cancel");
  };
  const doAgreeCancel = async () => {
    const res = await respond("agree");
    if (res.ok) onResolved?.({ cancelled: res.cancelled });
  };
  const doAcceptProposal = async () => {
    if (a.proposed_resolution === "complete") return doRelease();
    const res = await accept("mutual_cancel");
    if (res.ok) onResolved?.({ cancelled: res.cancelled });
  };
  const doReject = async () => {
    const res = await respond("reject");
    if (res.ok) onResolved?.({ disputed: res.disputed });
  };

  // ── Theme ──
  const card =
    (dark
      ? "rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4"
      : "rounded-2xl border border-amber-300 bg-amber-50 p-4") + (className ? ` ${className}` : "");
  const titleCls = dark ? "text-[14px] font-semibold text-[#f5f5f7]" : "text-[14px] font-semibold text-neutral-900";
  const bodyCls = dark ? "text-[12.5px] text-[#a1a1a6] leading-snug" : "text-[12.5px] text-neutral-600 leading-snug";
  const timeCls = dark ? "text-[12px] font-semibold text-amber-300" : "text-[12px] font-semibold text-amber-700";
  const primaryBtn = dark
    ? "flex-1 py-2.5 rounded-xl text-[14px] font-semibold bg-white text-black disabled:opacity-40 flex items-center justify-center"
    : "flex-1 py-2.5 rounded-xl text-[14px] font-semibold bg-neutral-900 text-white disabled:opacity-40 flex items-center justify-center";
  const secondaryBtn = dark
    ? "flex-1 py-2.5 rounded-xl text-[14px] font-semibold border border-white/20 text-[#f5f5f7] disabled:opacity-40 flex items-center justify-center"
    : "flex-1 py-2.5 rounded-xl text-[14px] font-semibold border border-neutral-300 text-neutral-800 disabled:opacity-40 flex items-center justify-center";

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

  const errLine = error ? (
    <p className={`mt-2 text-[12px] ${dark ? "text-amber-300" : "text-neutral-700"}`}>{error}</p>
  ) : null;

  const resolutionWord = (r: AppealResolution | null | undefined) =>
    r === "complete" ? "release the crypto to the buyer" : "cancel the order and refund the escrow";

  // ── Shell ──
  const shell = (title: string, children: React.ReactNode) => (
    <div className={card}>
      <p className={titleCls}>{title}</p>
      {children}
    </div>
  );

  // 1. A resolution has been PROPOSED and is awaiting a response.
  if (hasProposal) {
    if (proposalMine) {
      return shell("Proposal sent", (
        <>
          <p className={`${bodyCls} mt-1`}>
            You proposed to {resolutionWord(a.proposed_resolution)}. Waiting for the other party to accept.
          </p>
          {timeLine("remaining")}
        </>
      ));
    }
    // Counterparty of the proposal. Only the seller may accept a release.
    const canAccept = a.proposed_resolution === "complete" ? isSeller : true;
    return shell("Proposal to resolve", (
      <>
        <p className={`${bodyCls} mt-1`}>
          {otherPartyLabel} proposed to {resolutionWord(a.proposed_resolution)}.
        </p>
        <p className={`${bodyCls} mt-1`}>Rejecting opens a dispute for review.</p>
        {timeLine("left to respond")}
        {errLine}
        <div className="mt-3 flex items-center gap-2">
          {canAccept && (
            <button type="button" className={primaryBtn} disabled={busy} onClick={doAcceptProposal}>
              {busy ? "Working…" : a.proposed_resolution === "complete" ? "Accept & release" : "Accept"}
            </button>
          )}
          <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
            {responding === "reject" ? "Opening dispute…" : "Reject"}
          </button>
        </div>
        {!canAccept && (
          <p className={`${bodyCls} mt-2`}>Only the seller can release the crypto.</p>
        )}
      </>
    ));
  }

  // 2. Open appeal, no standing proposal.

  // 2a. Seller after the buyer paid → can release the crypto to the buyer.
  if (stage === "payment_sent" && isSeller) {
    return shell(isOpener ? "You raised an appeal" : "Buyer is waiting", (
      <>
        {!isOpener && issueLabel && <p className={`${bodyCls} mt-1`}>{issueLabel}</p>}
        <p className={`${bodyCls} mt-1`}>
          If the buyer&apos;s payment has arrived, release the crypto to complete the trade. Otherwise reject to open a dispute.
        </p>
        {timeLine(isOpener ? "remaining" : "left to respond")}
        {errLine}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className={primaryBtn} disabled={busy} onClick={doRelease}>
            {responding === "accept" ? "Releasing…" : "Release crypto to buyer"}
          </button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
            {responding === "reject" ? "Opening dispute…" : "Reject"}
          </button>
        </div>
      </>
    ));
  }

  // 2b. Pre-fiat (accepted/escrowed) → mutual cancel is on the table.
  if (preFiat) {
    // Opener already asked for a mutual cancel → counterparty gets agree/reject.
    if (isMutualCancelIssue && !isOpener) {
      return shell("Mutual Cancellation Requested", (
        <>
          <p className={`${bodyCls} mt-1`}>
            {otherPartyLabel} wants to cancel this trade.
            {a.description ? ` “${a.description}”` : ""}
          </p>
          <p className={`${bodyCls} mt-1`}>Rejecting opens a dispute for review.</p>
          {timeLine("left to respond")}
          {errLine}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={primaryBtn} disabled={busy} onClick={doAgreeCancel}>
              {responding === "agree" ? "Cancelling…" : "Agree to Cancel"}
            </button>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
              {responding === "reject" ? "Opening dispute…" : "Reject Request"}
            </button>
          </div>
        </>
      ));
    }
    // Opener who already asked for a mutual cancel → waiting for the counterparty.
    if (isMutualCancelIssue && isOpener) {
      return shell("You requested a cancellation", (
        <>
          <p className={`${bodyCls} mt-1`}>
            Waiting for the other party to agree. If they don&apos;t respond in time, this becomes a dispute for review.
          </p>
          {timeLine("remaining")}
          {errLine}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
              {responding === "reject" ? "Opening dispute…" : "Escalate to dispute"}
            </button>
          </div>
        </>
      ));
    }
    // Any party can propose a mutual cancel; the other accepts. Reject escalates.
    return shell(isOpener ? "You raised an appeal" : `${otherPartyLabel} raised an appeal`, (
      <>
        {issueLabel && <p className={`${bodyCls} mt-1`}>{issueLabel}</p>}
        <p className={`${bodyCls} mt-1`}>
          You can propose cancelling &amp; refunding the escrow, or reject to open a dispute.
        </p>
        {timeLine(isOpener ? "remaining" : "left to respond")}
        {errLine}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className={primaryBtn} disabled={busy} onClick={doProposeCancel}>
            {responding === "propose" ? "Proposing…" : "Propose cancel & refund"}
          </button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
            {responding === "reject" ? "Opening dispute…" : "Reject → dispute"}
          </button>
        </div>
      </>
    ));
  }

  // 2c. payment_sent and the viewer is NOT the seller (i.e. the buyer).
  if (isOpener) {
    return shell("You raised an appeal", (
      <>
        {issueLabel && <p className={`${bodyCls} mt-1`}>{issueLabel}</p>}
        <p className={`${bodyCls} mt-1`}>
          Waiting for the seller to respond. If they don&apos;t respond in time, this escalates to a dispute for review.
        </p>
        {timeLine("remaining")}
        {errLine}
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
            {responding === "reject" ? "Opening dispute…" : "Escalate to dispute"}
          </button>
        </div>
      </>
    ));
  }
  // Buyer as counterparty of a seller-raised payment_sent appeal → escalate only.
  return shell(`${otherPartyLabel} raised an appeal`, (
    <>
      {issueLabel && <p className={`${bodyCls} mt-1`}>{issueLabel}</p>}
      <p className={`${bodyCls} mt-1`}>This can be sent to a moderator for review.</p>
      {timeLine("left to respond")}
      {errLine}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
          {responding === "reject" ? "Opening dispute…" : "Open a dispute"}
        </button>
      </div>
    </>
  ));
}
