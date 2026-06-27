"use client";

/**
 * MutualCancelAppealBanner  (the active-appeal resolution banner)
 * ──────────────────────────────────────────────────────────────
 * Stage-DRIVEN appeal banner. The appeal *reason* only explains why it was
 * raised — the available actions are determined by the ORDER STAGE (and the
 * viewer's buyer/seller role), so the experience is consistent across every
 * appeal type. The goal is always: resolve mutually first, escalate only if
 * that fails.
 *
 * The banner always shows a header — who raised it (perspective-aware), the
 * reason, the stage, the status, and how long ago it was raised — then two
 * CTAs:
 *   • Primary  "Resolve Together" → expands to the stage-appropriate options.
 *   • Secondary "Escalate to Dispute" → always available fallback.
 * Chat stays reachable via "Continue Discussion".
 *
 * Stage → options inside "Resolve Together":
 *   1 Accepted (no escrow) / 2 Escrowed (no payment):
 *        Accept Cancellation (if the other side asked) · Propose / Cancel &
 *        Refund · Continue Trade · Continue Discussion
 *   3 Payment sent:
 *        seller → Release Crypto · Ask Buyer for More Information · Continue Discussion
 *        buyer  → (no resolve) Wait for Seller Response · Continue Discussion
 *
 * Renders nothing unless there is an ACTIVE appeal. `variant` selects the light
 * (user) or dark (merchant) theme.
 */
import { useEffect, useState } from "react";
import { useOrderAppeal, isActiveAppeal } from "@/hooks/useOrderAppeal";
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
   * Real mode: invoked when the seller chooses to release but the release must
   * be signed on-chain. The parent runs its existing seller release flow.
   */
  onReleaseRequest?: () => void;
  /** Open the order chat — wires "Continue Discussion" / "Ask for More Information". */
  onOpenChat?: () => void;
}

/** Live countdown to an ISO deadline. Re-renders every second. */
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

/** Human "time since" for the appeal header. */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "just now";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MutualCancelAppealBanner({
  orderId,
  viewerActorId,
  variant = "user",
  enabled = true,
  className = "",
  onResolved,
  onReleaseRequest,
  onOpenChat,
}: MutualCancelAppealBannerProps) {
  const { appeal, viewerRole, responding, error, respond, propose, accept, withdraw } = useOrderAppeal(
    orderId,
    { enabled },
  );
  // Hook must run unconditionally (before any early return) — rules of hooks.
  const countdown = useCountdown(appeal?.appeal_deadline ?? null);
  const [showResolve, setShowResolve] = useState(false);

  if (!isActiveAppeal(appeal)) return null;
  const a = appeal!;

  const stage = appealStageFor(a.order_status); // 'accepted' | 'escrowed' | 'payment_sent'
  const isPaymentSent = stage === "payment_sent";
  const isSeller = viewerRole === "seller";
  const isOpener = !!viewerActorId && a.opener_id === viewerActorId;
  const issueLabel = getAppealIssue(a.issue_key)?.label ?? a.issue_key ?? "Issue";

  const hasProposal = a.status === "proposed" && !!a.proposed_resolution;
  const proposalMine = hasProposal && !!viewerActorId && a.proposed_by_id === viewerActorId;
  const proposalFromOther = hasProposal && !proposalMine;

  // A mutual cancel that THIS viewer can accept (a standing cancel proposal from
  // the other side, or the legacy "mutual_cancel" issue raised by the other side).
  const cancelToAccept =
    !proposalMine &&
    ((hasProposal && a.proposed_resolution === "mutual_cancel") ||
      (!hasProposal && a.issue_key === "mutual_cancel" && !isOpener));

  // ── Header copy ──
  const raisedLine = isOpener
    ? "You raised an appeal"
    : `The ${viewerRole === "buyer" ? "seller" : viewerRole === "seller" ? "buyer" : "other party"} raised an appeal`;
  const stageLabel = isPaymentSent
    ? "Fiat payment sent"
    : stage === "escrowed"
      ? "Escrow locked"
      : "Order accepted";
  const statusText = proposalMine
    ? "Waiting for the other party to accept"
    : proposalFromOther
      ? "Proposal awaiting your response"
      : isPaymentSent
        ? isSeller
          ? "Waiting for your response"
          : "Waiting for seller response"
        : isOpener
          ? "Waiting for the other party"
          : "Awaiting your response";

  const dark = variant === "merchant";

  // ── Action handlers ──
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
  const doAcceptCancel = async () => {
    const res =
      hasProposal && a.proposed_resolution === "mutual_cancel"
        ? await accept("mutual_cancel")
        : await respond("agree");
    if (res.ok) onResolved?.({ cancelled: res.cancelled });
  };
  const doWithdraw = async () => {
    const res = await withdraw();
    if (res.ok) onResolved?.({});
  };
  const doReject = async () => {
    const res = await respond("reject");
    if (res.ok) onResolved?.({ disputed: res.disputed });
  };

  const busy = responding !== null;
  // Buyer after payment can't release or cancel — only wait or escalate.
  const buyerWaiting = isPaymentSent && !isSeller;

  // ── Theme ──
  const card =
    (dark
      ? "rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4"
      : "rounded-2xl border border-amber-300 bg-amber-50 p-4") + (className ? ` ${className}` : "");
  const titleCls = dark ? "text-[14px] font-semibold text-[#f5f5f7]" : "text-[14px] font-semibold text-neutral-900";
  const metaCls = dark ? "text-[12px] text-[#a1a1a6] leading-relaxed" : "text-[12px] text-neutral-600 leading-relaxed";
  const metaStrong = dark ? "text-[#f5f5f7]" : "text-neutral-900";
  const timeCls = dark ? "text-[11px] text-amber-300" : "text-[11px] text-amber-700";
  const primaryBtn = dark
    ? "flex-1 py-2.5 rounded-xl text-[14px] font-semibold bg-white text-black disabled:opacity-40 flex items-center justify-center"
    : "flex-1 py-2.5 rounded-xl text-[14px] font-semibold bg-neutral-900 text-white disabled:opacity-40 flex items-center justify-center";
  const secondaryBtn = dark
    ? "flex-1 py-2.5 rounded-xl text-[14px] font-semibold border border-white/20 text-[#f5f5f7] disabled:opacity-40 flex items-center justify-center"
    : "flex-1 py-2.5 rounded-xl text-[14px] font-semibold border border-neutral-300 text-neutral-800 disabled:opacity-40 flex items-center justify-center";
  const optionBtn = dark
    ? "w-full py-2.5 rounded-xl text-[13.5px] font-medium border border-white/15 text-[#f5f5f7] disabled:opacity-40 flex items-center justify-center"
    : "w-full py-2.5 rounded-xl text-[13.5px] font-medium border border-neutral-300 text-neutral-800 disabled:opacity-40 flex items-center justify-center";
  const optionPrimary = dark
    ? "w-full py-2.5 rounded-xl text-[13.5px] font-semibold bg-white text-black disabled:opacity-40 flex items-center justify-center"
    : "w-full py-2.5 rounded-xl text-[13.5px] font-semibold bg-neutral-900 text-white disabled:opacity-40 flex items-center justify-center";

  // ── "Resolve Together" options, by stage ──
  type Opt = { key: string; label: string; busyLabel: string; primary?: boolean; onClick: () => void };
  const options: Opt[] = [];
  if (isPaymentSent) {
    // Only the seller reaches the resolve list (buyer is handled separately).
    options.push({ key: "release", label: "Release Crypto", busyLabel: "Releasing…", primary: true, onClick: doRelease });
    if (onOpenChat) options.push({ key: "askinfo", label: "Ask Buyer for More Information", busyLabel: "…", onClick: onOpenChat });
    if (onOpenChat) options.push({ key: "discuss", label: "Continue Discussion", busyLabel: "…", onClick: onOpenChat });
  } else {
    if (cancelToAccept) {
      options.push({
        key: "acceptcancel",
        label: stage === "escrowed" ? "Accept Cancellation & Refund" : "Accept Cancellation",
        busyLabel: "Cancelling…",
        primary: true,
        onClick: doAcceptCancel,
      });
    } else if (!proposalMine) {
      options.push({
        key: "cancel",
        label: stage === "escrowed" ? "Cancel Order & Refund Escrow" : "Propose Cancellation",
        busyLabel: "Working…",
        onClick: doProposeCancel,
      });
    }
    options.push({ key: "continue", label: "Continue Trade", busyLabel: "Closing…", onClick: doWithdraw });
    if (onOpenChat) options.push({ key: "discuss", label: "Continue Discussion in Chat", busyLabel: "…", onClick: onOpenChat });
  }

  return (
    <div className={card}>
      {/* Header */}
      <p className={titleCls}>{raisedLine}</p>
      <div className={`${metaCls} mt-1.5 space-y-0.5`}>
        <p>Reason: <span className={metaStrong}>{issueLabel}</span></p>
        <p>Stage: <span className={metaStrong}>{stageLabel}</span></p>
        <p>Status: <span className={metaStrong}>{statusText}</span></p>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className={timeCls}>{timeAgo(a.created_at)}</span>
        {countdown &&
          (countdown.expired ? (
            <span className={timeCls}>Escalating…</span>
          ) : (
            <span className={timeCls}>{countdown.text} left</span>
          ))}
      </div>

      {error && (
        <p className={`mt-2 text-[12px] ${dark ? "text-amber-300" : "text-neutral-700"}`}>{error}</p>
      )}

      {/* Actions */}
      {buyerWaiting ? (
        <div className="mt-3 space-y-2">
          <button type="button" className={`${primaryBtn} w-full opacity-60 cursor-default`} disabled>
            Wait for Seller Response
          </button>
          {onOpenChat && (
            <button type="button" className={optionBtn} onClick={onOpenChat}>
              Continue Discussion in Chat
            </button>
          )}
          <button type="button" className={`${secondaryBtn} w-full`} disabled={busy} onClick={doReject}>
            {responding === "reject" ? "Opening dispute…" : "Escalate to Dispute"}
          </button>
        </div>
      ) : !showResolve ? (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => setShowResolve(true)}>
            Resolve Together
          </button>
          <button type="button" className={secondaryBtn} disabled={busy} onClick={doReject}>
            {responding === "reject" ? "Opening dispute…" : "Escalate to Dispute"}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={opt.primary ? optionPrimary : optionBtn}
              disabled={busy}
              onClick={opt.onClick}
            >
              {busy && opt.primary ? opt.busyLabel : opt.label}
            </button>
          ))}
          <button type="button" className={`${secondaryBtn} w-full`} disabled={busy} onClick={doReject}>
            {responding === "reject" ? "Opening dispute…" : "Escalate to Dispute"}
          </button>
        </div>
      )}
    </div>
  );
}
