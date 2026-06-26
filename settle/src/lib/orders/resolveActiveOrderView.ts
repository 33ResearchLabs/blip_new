/**
 * resolveActiveOrderView
 * ──────────────────────
 * Pure view-model resolver for the Active Order experience. Given the order's
 * direction + status (and a little display data), it returns everything the
 * presentation shell needs to answer the four questions a user always has:
 *
 *   1. Where am I?        → hero.eyebrow + hero.title + currentIndex
 *   2. What happened?     → hero.happened
 *   3. What do I do now?  → hero.doNow
 *   4. What happens next? → hero.next (+ nextSub)
 *
 * Mirrors the proven `resolveCancelDialog` pattern: no React, no fetch, no side
 * effects — just (input) → view model. That makes it unit-testable and keeps
 * ALL Active Order copy in one place so every state reads consistently.
 *
 * The Trade Progress milestones are deliberately NEUTRAL (lifecycle, not role):
 * the same five nodes render identically for a buyer and a seller. The
 * role-specific responsibility ("send payment" vs "wait for payment") lives in
 * the hero, never in the progress bar.
 *
 * PHASE 1 SCOPE: only `buy → escrowed (ready to pay)` is implemented and wired.
 * Every other state returns a safe, generic view (NOT yet wired into the UI) so
 * the function never throws while the remaining states are migrated later.
 */

/** Neutral trade lifecycle — same five milestones for buyer and seller. */
export const TRADE_MILESTONES = [
  "Match",
  "Escrow",
  "Payment",
  "Verification",
  "Completion",
] as const;

export type TradeMilestone = (typeof TRADE_MILESTONES)[number];

/** Visual intent of the current step — drives accent vs calm-wait styling. */
export type HeroTone = "action" | "wait" | "success" | "alert";

export interface ActiveOrderHero {
  /** Small eyebrow above the title, e.g. "Your turn · Step 3 of 5". */
  eyebrow: string;
  /** Where am I — the headline task, e.g. "Send the payment". */
  title: string;
  /** What happened — the step that just completed. */
  happened: string;
  /** What to do now — the single concrete instruction. */
  doNow: string;
  /** What happens next — rendered in its own distinct section. */
  next: string;
  /** Optional reassurance under "next", e.g. "Usually 2–5 minutes". */
  nextSub?: string;
  tone: HeroTone;
}

export interface ActiveOrderView {
  milestones: readonly string[];
  /** 0-based index of the active milestone. */
  currentIndex: number;
  hero: ActiveOrderHero;
  /** Whether the "where to pay" account details belong on this screen. */
  showPaymentDetails: boolean;
  /**
   * Whether to show the escrow-protection reassurance. Deliberately false on
   * states where it adds no value, so the same "funds are safe" line isn't
   * repeated on every screen.
   */
  showEscrowProtection: boolean;
  /** One concise escrow line; null when showEscrowProtection is false. */
  escrowNote: string | null;
  /**
   * When set, this is a "waiting" state with no buyer action — the screen shows
   * a calm indicator carrying this label instead of a primary button. Undefined
   * on action states (where a real primary button belongs).
   */
  waitingLabel?: string;
}

export interface ActiveOrderViewInput {
  type: "buy" | "sell";
  /** Raw DB status (e.g. "escrowed", "payment_pending"). Case-insensitive. */
  dbStatus: string;
  /** Pre-formatted fiat amount, e.g. "₹294". */
  fiatLabel: string;
  /** Pre-formatted crypto amount (no unit), e.g. "50". */
  cryptoLabel: string;
  /** Buyer still needs to choose which merchant account to pay into. */
  needsPayMethodPick?: boolean;
  /** Cancelled state: the user's own escrow was refunded (sell side). */
  escrowRefunded?: boolean;
  /**
   * Rail the buyer pays over. Defaults to "bank" — copy is only adapted away
   * from account-language when this is "cash" (no bank account exists, so the
   * instruction must never reference one). Additive + backward-compatible:
   * omitting it preserves the original bank copy exactly.
   */
  paymentMethod?: "bank" | "cash";
}

function genericView(): ActiveOrderView {
  return {
    milestones: TRADE_MILESTONES,
    currentIndex: 0,
    hero: {
      eyebrow: "Active order",
      title: "Trade in progress",
      happened: "Your trade is underway.",
      doNow: "Follow the steps to complete your trade.",
      next: "We'll guide you through each step.",
      tone: "wait",
    },
    showPaymentDetails: false,
    showEscrowProtection: false,
    escrowNote: null,
  };
}

export function resolveActiveOrderView(input: ActiveOrderViewInput): ActiveOrderView {
  const status = (input.dbStatus || "").toLowerCase();

  // ── Under Review (disputed) — applies to both directions ───────────────
  // Progress is hidden for this state (the screen passes a banner instead), so
  // currentIndex is nominal. Tone stays calm/neutral — funds are protected.
  if (status === "disputed") {
    return {
      milestones: TRADE_MILESTONES,
      currentIndex: 2,
      hero: {
        eyebrow: "Under review",
        title: "We're reviewing this trade",
        happened: "A problem was raised, so this trade is paused while we look into it.",
        doNow:
          "Nothing urgent to do. Share anything that helps by messaging the seller — your money stays locked and safe the whole time.",
        next: "Our team reviews the case and decides the outcome. If it isn't resolved in time, your funds are returned automatically.",
        tone: "wait",
      },
      showPaymentDetails: false,
      showEscrowProtection: false,
      escrowNote: null,
    };
  }

  // ── Terminal · Expired (no merchant accepted in time) ──────────────────
  // Progress is hidden (the screen shows a closed banner); copy makes clear the
  // order simply ended and the user wasn't charged.
  if (status === "expired") {
    return {
      milestones: TRADE_MILESTONES,
      currentIndex: -1,
      hero: {
        eyebrow: "Order closed",
        title: "No merchant accepted in time",
        happened: "Your order went live, but no merchant took it before it timed out.",
        doNow: "Nothing went wrong on your side — you weren't charged and nothing was locked.",
        next: "You can place a new order whenever you're ready.",
        tone: "wait",
      },
      showPaymentDetails: false,
      showEscrowProtection: false,
      escrowNote: null,
    };
  }

  // ── Terminal · Cancelled ───────────────────────────────────────────────
  if (status === "cancelled") {
    const refunded = !!input.escrowRefunded;
    return {
      milestones: TRADE_MILESTONES,
      currentIndex: -1,
      hero: {
        eyebrow: "Order closed",
        title: "Order cancelled",
        happened: "This order was cancelled.",
        doNow: refunded
          ? "Your USDT has been refunded to your wallet — nothing was lost."
          : "You weren't charged and nothing was locked.",
        next: "You can start a new order whenever you're ready.",
        tone: "wait",
      },
      showPaymentDetails: false,
      showEscrowProtection: false,
      escrowNote: null,
    };
  }

  // ── BUY · Matching · waiting for a merchant to accept ──────────────────
  const buyMatching = input.type === "buy" && (status === "pending" || status === "open");
  if (buyMatching) {
    return {
      milestones: TRADE_MILESTONES,
      currentIndex: 0, // Match
      hero: {
        eyebrow: "Step 1 of 5 · Matching",
        title: "Finding you a merchant",
        happened: "Your order is live with verified merchants.",
        doNow:
          "Nothing to do — we're matching you with a trusted merchant. You can leave this screen; we'll let you know the moment one accepts.",
        next: "A merchant accepts and locks the crypto in escrow.",
        nextSub: "Auto-cancels if no one accepts — nothing is charged.",
        tone: "wait",
      },
      showPaymentDetails: false,
      showEscrowProtection: false,
      escrowNote: null,
      waitingLabel: "Waiting for a merchant to accept…",
    };
  }

  // ── BUY · Merchant accepted · securing the crypto in escrow ────────────
  const buyAccepted =
    input.type === "buy" && (status === "accepted" || status === "escrow_pending");
  if (buyAccepted) {
    return {
      milestones: TRADE_MILESTONES,
      currentIndex: 1, // Escrow (in progress)
      hero: {
        eyebrow: "Step 2 of 5 · Securing funds",
        title: "Merchant is securing the crypto",
        happened: "A merchant accepted your order.",
        doNow:
          "Nothing to do yet — the merchant is locking the crypto in escrow. Payment details unlock the moment it's secured.",
        next: "Once the crypto is locked, you'll send the payment.",
        nextSub: "Usually under a minute.",
        tone: "wait",
      },
      showPaymentDetails: false,
      showEscrowProtection: false,
      escrowNote: null,
      waitingLabel: "Waiting for the merchant to lock the crypto…",
    };
  }

  // ── BUY · Escrow locked · buyer must send fiat ─────────────────────────
  const buyEscrowedReadyToPay =
    input.type === "buy" && (status === "escrowed" || status === "payment_pending");

  if (buyEscrowedReadyToPay) {
    const pick = !!input.needsPayMethodPick;
    const isCash = input.paymentMethod === "cash";
    return {
      milestones: TRADE_MILESTONES,
      currentIndex: 2, // Payment
      hero: {
        eyebrow: "Your turn · Step 3 of 5",
        title: isCash ? "Pay the merchant" : "Send the payment",
        happened:
          "A merchant matched and locked the crypto in escrow — it can't be moved until the trade is done.",
        doNow: pick
          ? `Choose how to pay below, then ${
              isCash ? `hand over exactly ${input.fiatLabel} in cash` : `send exactly ${input.fiatLabel}`
            }.`
          : isCash
            ? `Hand over exactly ${input.fiatLabel} in cash to the merchant, then tap "I've paid".`
            : `Send exactly ${input.fiatLabel} to the account shown below, then tap "I've sent the payment".`,
        next: isCash
          ? "The seller confirms they received the cash and releases your USDT to you."
          : "The seller checks their account and releases your USDT to you.",
        nextSub: "Usually takes 2–5 minutes.",
        tone: "action",
      },
      showPaymentDetails: true,
      showEscrowProtection: true,
      escrowNote: `${input.cryptoLabel} USDT is locked in escrow — it's safe and waiting for you.`,
    };
  }

  // ── BUY · Payment sent · waiting for the seller to confirm + release ────
  const buyPaymentSent = input.type === "buy" && status === "payment_sent";
  if (buyPaymentSent) {
    return {
      milestones: TRADE_MILESTONES,
      currentIndex: 3, // Verification
      hero: {
        eyebrow: "Step 4 of 5 · Verifying",
        title: "Payment sent — waiting for the seller",
        happened: `You sent ${input.fiatLabel} and we notified the seller.`,
        doNow:
          "Nothing to do — the seller is checking their account and will release your USDT once they confirm.",
        next: "As soon as they confirm, your USDT is released to you.",
        nextSub: "Usually 2–5 minutes. Your funds stay protected until then.",
        tone: "wait",
      },
      showPaymentDetails: true,
      showEscrowProtection: true,
      escrowNote: `${input.cryptoLabel} USDT stays locked and protected until the seller confirms.`,
      waitingLabel: "Waiting for the seller to confirm…",
    };
  }

  // Not yet migrated — safe placeholder (not rendered in Phase 1).
  return genericView();
}
