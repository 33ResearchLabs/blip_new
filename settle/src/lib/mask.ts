// PII masking for payment-account details shown in trade UIs (e.g. the Lock
// Escrow receiving-account picker). `merchant_payment_methods.details` is a
// freeform string whose shape varies by type (UPI id, phone, bank account), so
// we infer the shape from the content and mask accordingly. Display-only — the
// full value still travels server-side.

/** "gaurav@okaxis" → "ga•••@okaxis" (mask the local part, keep the handle). */
export function maskUpi(vpa: string): string {
  const at = vpa.indexOf("@");
  if (at <= 0) return maskGeneric(vpa);
  const local = vpa.slice(0, at);
  const domain = vpa.slice(at); // includes "@"
  const head = local.slice(0, 2);
  const dots = "•".repeat(Math.max(3, Math.min(local.length - head.length, 4)));
  return `${head}${dots}${domain}`;
}

/** "9812345645" → "98XXXXXX45" (keep first/last 2 digits). */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return raw;
  return `${digits.slice(0, 2)}${"X".repeat(Math.max(2, digits.length - 4))}${digits.slice(-2)}`;
}

/** Bank account → "XXXX1234" (keep last 4 alphanumerics). */
export function maskBank(raw: string): string {
  const alnum = raw.replace(/[^a-zA-Z0-9]/g, "");
  if (alnum.length < 4) return raw;
  return `XXXX${alnum.slice(-4)}`;
}

function maskGeneric(raw: string): string {
  return raw.length <= 4 ? raw : `••••${raw.slice(-4)}`;
}

/** Mask a payment-method detail string based on its type/shape. */
export function maskAccountDetail(
  type: string | null | undefined,
  details: string | null | undefined,
): string {
  const d = (details ?? "").trim();
  if (!d) return "";
  const t = (type || "").toLowerCase();
  if (d.includes("@")) return maskUpi(d);
  const isDigitsOnly = /^[\d\s+\-()]+$/.test(d);
  if (t === "bank") return maskBank(d);
  if ((t === "upi" || t === "mobile" || t === "card") && isDigitsOnly) {
    const n = d.replace(/\D/g, "");
    return n.length >= 11 ? maskBank(d) : maskPhone(d);
  }
  if (isDigitsOnly) return d.replace(/\D/g, "").length >= 11 ? maskBank(d) : maskPhone(d);
  return maskGeneric(d);
}
