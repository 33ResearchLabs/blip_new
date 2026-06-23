/**
 * Appeal issue catalog — single source of truth for the issues a user/merchant
 * can pick when raising an appeal.
 *
 * The list is REDUCED and STAGE-AWARE: each order stage shows only the few
 * issues that make sense at that point in the trade. "Other" is always offered
 * and takes a free-text description.
 *
 *   accepted      (escrow not locked yet) → not responding · cancel & refund · other
 *   escrowed      (crypto locked, buyer paying fiat) → not responding · wrong
 *                  payment details · cancel & refund · other
 *   payment_sent  (buyer paid, awaiting release) → not received · late/bank delay ·
 *                  wrong/partial amount · extra payment asked · not responding · other
 *
 * Mutual "Cancel & refund" is intentionally offered ONLY before fiat is sent
 * (accepted / escrowed) — once the buyer has paid, cancelling is unsafe.
 *
 * `group` ('resolvable' | 'dispute') is kept for backend compatibility (it maps
 * to issue_group) and is derived from whether the issue typically escalates.
 *
 * Shared by the picker UIs (AppealScreen / MerchantAppealSheet) and the
 * settle-side validation. Keys are stored verbatim in appeals.issue_key.
 */

export type AppealStage = "accepted" | "escrowed" | "payment_sent";
export type AppealIssueGroup = "resolvable" | "dispute";

export interface AppealIssue {
  key: string;
  label: string;
  desc: string;
  /** Backend compat (issue_group). Derived from `escalates`. */
  group: AppealIssueGroup;
  /** Order stages on which this issue is offered. */
  stages: AppealStage[];
  /** Typically routes toward a moderator dispute. */
  escalates?: boolean;
  /** "Other" — the description box is the main input and is required. */
  requiresDescription?: boolean;
  /** Reserved for worker-only issues (never shown in the picker). */
  systemOnly?: boolean;
}

/** The reduced catalog. */
export const APPEAL_ISSUES: AppealIssue[] = [
  // ── payment_sent (buyer has paid fiat, waiting for the seller to release) ──
  {
    key: "payment_not_received",
    label: "Payment not received by seller",
    desc: "I've sent the fiat but the seller says it hasn't arrived.",
    group: "resolvable",
    stages: ["payment_sent"],
  },
  {
    key: "payment_late",
    label: "Payment late / bank delay",
    desc: "The payment is delayed by the bank and should arrive soon.",
    group: "resolvable",
    stages: ["payment_sent"],
  },
  {
    key: "wrong_amount",
    label: "Wrong / partial amount",
    desc: "The amount sent doesn't match the order.",
    group: "resolvable",
    stages: ["payment_sent"],
  },
  {
    key: "extra_payment_request",
    label: "Seller asking for extra payment",
    desc: "The seller is asking for extra payment or new terms.",
    group: "dispute",
    stages: ["payment_sent"],
    escalates: true,
  },
  // ── escrowed (crypto locked, buyer about to pay) ──
  {
    key: "wrong_payment_details",
    label: "Wrong payment details / account",
    desc: "The payment account or details shared are incorrect.",
    group: "resolvable",
    stages: ["escrowed"],
  },
  // ── shared ──
  {
    key: "not_responding",
    label: "The other party isn't responding",
    desc: "They've gone quiet or are taking too long to respond.",
    group: "resolvable",
    stages: ["accepted", "escrowed", "payment_sent"],
  },
  {
    key: "mutual_cancel",
    label: "Cancel & refund (mutual)",
    desc: "We both agree to cancel this order and refund the escrow.",
    group: "resolvable",
    stages: ["accepted", "escrowed"],
  },
  {
    key: "other",
    label: "Other issue",
    desc: "Describe the problem in your own words.",
    group: "resolvable",
    stages: ["accepted", "escrowed", "payment_sent"],
    requiresDescription: true,
  },
];

export const APPEAL_ISSUES_BY_KEY: Record<string, AppealIssue> = Object.fromEntries(
  APPEAL_ISSUES.map((i) => [i.key, i]),
);

/** Keys a user/merchant may submit (validation). */
export const SELECTABLE_ISSUE_KEYS: string[] = APPEAL_ISSUES.map((i) => i.key);

/** Display order of issues per stage. */
const STAGE_ISSUE_ORDER: Record<AppealStage, string[]> = {
  accepted: ["not_responding", "mutual_cancel", "other"],
  escrowed: ["not_responding", "wrong_payment_details", "mutual_cancel", "other"],
  payment_sent: [
    "payment_not_received",
    "payment_late",
    "wrong_amount",
    "extra_payment_request",
    "not_responding",
    "other",
  ],
};

/** Map a raw order status to the appeal stage that drives the issue list. */
export function appealStageFor(status: string | null | undefined): AppealStage {
  switch (status) {
    case "payment_sent":
      return "payment_sent";
    case "escrowed":
    case "payment_pending":
      return "escrowed";
    case "accepted":
    case "escrow_pending":
    default:
      return "accepted";
  }
}

/** The issues to show for a given order status, in display order. */
export function getAppealIssuesForStage(status: string | null | undefined): AppealIssue[] {
  const stage = appealStageFor(status);
  return STAGE_ISSUE_ORDER[stage]
    .map((k) => APPEAL_ISSUES_BY_KEY[k])
    .filter(Boolean);
}

export function getAppealIssue(key: string | null | undefined): AppealIssue | null {
  if (!key) return null;
  return APPEAL_ISSUES_BY_KEY[key] ?? null;
}

export function getAppealIssueLabel(key: string | null | undefined): string {
  return getAppealIssue(key)?.label ?? (key || "Issue");
}

export function getAppealIssueGroup(key: string | null | undefined): AppealIssueGroup | null {
  return getAppealIssue(key)?.group ?? null;
}
