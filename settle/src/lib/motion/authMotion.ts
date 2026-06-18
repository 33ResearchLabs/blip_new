/**
 * Shared motion config for all authentication surfaces.
 *
 * Both the user login (`/user/login` → LandingPage) and the merchant login
 * (`/market/login`) import these so the two transitions that the user can
 * trigger feel identical:
 *
 *   • Sign In ↔ Create Account  — a keyed content cross-fade inside each card
 *   • User ↔ Merchant           — the card mount entrance, replayed on each
 *                                 route so the cross-page switch lands the same
 *
 * Keep timing/easing/direction in ONE place — never re-declare these inline.
 */
import type { Transition, Variants } from "framer-motion";

/** The single easing curve used by every auth animation. */
export const AUTH_EASE = [0.22, 1, 0.36, 1] as const;

/** Transition for swapping between auth views (Sign In ↔ Create Account, etc.). */
export const authTransition: Transition = {
  duration: 0.22,
  ease: AUTH_EASE,
};

/**
 * Enter/exit for a swapped auth view. Direction is consistent everywhere:
 * new content rises in from below (+y), old content leaves upward (−y).
 * Pair with `<AnimatePresence mode="wait">` and a stable `key`.
 */
export const authViewVariants: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

/**
 * Card mount entrance — shared by both login pages so the User ↔ Merchant
 * route switch animates in identically on either side.
 */
export const authCardEnter = {
  initial: { opacity: 0, y: 12, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.5, ease: AUTH_EASE } as Transition,
};

/**
 * Eases the card's own height/position changes (a taller form, a revealed
 * field) so the `layout` prop never snaps in a single frame.
 */
export const authLayoutTransition: Transition = {
  duration: 0.32,
  ease: AUTH_EASE,
};

/**
 * Resolve the current auth "view" into a stable AnimatePresence key. Anything
 * that changes the rendered body (mode toggle OR the post-signup verification
 * gate) must change this key so the cross-fade fires.
 */
export function authViewKey(opts: {
  mode: string;
  pendingVerification?: boolean;
  verified?: boolean;
}): string {
  if (opts.pendingVerification) return opts.verified ? "verified" : "verify";
  return opts.mode;
}
