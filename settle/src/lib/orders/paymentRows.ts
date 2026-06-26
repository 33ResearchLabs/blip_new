/**
 * Shared payment-detail helpers for the user-side order screens.
 *
 * Extracted from OrderPaymentScreen so both the existing screen and the new
 * Active Order architecture (ActiveOrderPaymentScreen) derive the buyer's
 * "where to pay" rows from a SINGLE source — no duplicated business logic.
 *
 * Source precedence mirrors the original: merchantPaymentMethod →
 * lockedPaymentMethod → raw merchant fields.
 */

import type { Order } from "@/components/user/screens/types";
import { formatCrypto } from "@/lib/format";

export function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "AED ";
    default: return `${(code || "AED").toUpperCase()} `;
  }
}

export function fmtCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export interface PaymentRow {
  label: string;
  value: string;
  copyKey: string;
  copyValue?: string;
  mono?: boolean;
  accent?: boolean;
}

/**
 * Builds the labelled payment-detail rows from whichever source the order
 * carries — merchantPaymentMethod → lockedPaymentMethod → raw merchant fields.
 */
export function derivePaymentRows(order: Order, displayId: string): PaymentRow[] {
  const rows: PaymentRow[] = [];
  const mpm = order.merchantPaymentMethod;
  const lpm = order.lockedPaymentMethod;

  if (mpm) {
    const t = (mpm.type || "").toLowerCase();
    const isUpi = t === "upi" || (typeof mpm.details === "string" && mpm.details.includes("@"));
    rows.push({ label: isUpi ? "UPI Name" : "Account Name", value: mpm.name || "—", copyKey: "pm-name" });
    rows.push({ label: isUpi ? "UPI ID" : "Account No. / IBAN", value: mpm.details || "—", copyKey: "pm-id", mono: true });
  } else if (lpm) {
    const d = lpm.details || {};
    if (d.bank_name) rows.push({ label: "Bank Name", value: d.bank_name, copyKey: "bank" });
    if (d.account_name) rows.push({ label: "Account Name", value: d.account_name, copyKey: "name" });
    if (d.iban) rows.push({ label: "IBAN / Account No.", value: d.iban, copyKey: "iban", mono: true });
    if (d.upi_id) rows.push({ label: "UPI ID", value: d.upi_id, copyKey: "upi", mono: true });
  } else {
    if (order.merchant.bank) rows.push({ label: "Bank Name", value: order.merchant.bank, copyKey: "bank" });
    if (order.merchant.accountName) rows.push({ label: "Account Name", value: order.merchant.accountName, copyKey: "name" });
    if (order.merchant.iban) rows.push({ label: "IBAN / Account No.", value: order.merchant.iban, copyKey: "iban", mono: true });
  }

  const sym = fiatSymbol(order.fiatCode);
  rows.push({
    label: "Amount",
    value: `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`,
    copyKey: "amount",
    copyValue: order.fiatAmount,
    accent: true,
  });
  rows.push({ label: "Reference / Note", value: displayId, copyKey: "ref" });
  return rows;
}
