import type { ProfileEntityType } from "./types";

export interface CounterpartyTarget {
  entityType: ProfileEntityType;
  id: string;
}

/**
 * Resolve the profile (user or merchant) that the *viewing merchant* should
 * open when they tap an order's avatar / name / "View Profile" button.
 *
 * Order role model (CLAUDE.md, authoritative):
 *   U2M  → counterparty is the USER who placed it.
 *   M2M  → merchant_id is ALWAYS the seller, buyer_merchant_id ALWAYS the buyer
 *          (user_id is an `open_order_…` / `m2m_…` placeholder).
 *
 * For M2M the counterparty is the OTHER merchant relative to the viewer:
 *   • viewer occupies the buyer slot  → open the SELLER (merchant_id)
 *   • viewer occupies the seller slot → open the BUYER  (buyer_merchant_id)
 *   • viewer is an OBSERVER (a pending broadcast they haven't claimed — neither
 *     slot is theirs) → open the PLACER, i.e. whichever slot is filled
 *     (buyer_merchant_id OR merchant_id). This covers a SELL broadcast where
 *     only merchant_id is set, which the earlier buyer-only logic dropped (the
 *     avatar tap was a no-op for that — the common broadcast shape).
 *
 * An observer can never resolve to the viewer (neither slot is theirs), so this
 * never opens "your own profile".
 *
 * @param db   raw DB order row (`order.dbOrder`)
 * @param myId the viewing merchant's id — drives the buyer/seller-slot routing.
 *             Omit (or pass null) and every viewer is treated as an observer.
 */
export function deriveCounterparty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  myId?: string | null,
): CounterpartyTarget | null {
  if (!db) return null;

  const userIsPlaceholder =
    typeof db?.user?.username === "string" &&
    (db.user.username.startsWith("open_order_") ||
      db.user.username.startsWith("m2m_"));
  const isM2M = userIsPlaceholder || !!db?.buyer_merchant_id;

  if (!isM2M) {
    // U2M — the counterparty is always the user who placed the order.
    const id = db?.user?.id || db?.user_id || null;
    return id ? { entityType: "user", id } : null;
  }

  // M2M — open the OTHER merchant relative to the viewer. merchant_id is always
  // the seller slot, buyer_merchant_id always the buyer slot.
  //   • viewer is the buyer slot  → counterparty is the seller (merchant_id)
  //   • viewer is the seller slot → counterparty is the buyer  (buyer_merchant_id)
  //   • observer (neither slot)   → the placer, i.e. whichever slot is filled —
  //     this also opens a SELL broadcast (only merchant_id set), which the
  //     buyer-only logic used to drop.
  let id: string | null;
  if (myId && db?.buyer_merchant_id === myId) {
    id = db?.merchant_id || null;
  } else if (myId && db?.merchant_id === myId) {
    id = db?.buyer_merchant_id || null;
  } else {
    id = db?.buyer_merchant_id || db?.merchant_id || null;
  }
  id = id || db?.buyer_merchant?.id || null;

  return id ? { entityType: "merchant", id } : null;
}
