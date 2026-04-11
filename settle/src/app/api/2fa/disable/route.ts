/**
 * POST /api/2fa/disable
 *
 * Disable 2FA. Requires password + current TOTP code for security.
 * Removes secret and sets totp_enabled = false.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  successResponse,
  errorResponse,
} from "@/lib/middleware/auth";
import {
  getTotpStatus,
  verifyTotpEncrypted,
  disableTotp,
  recordAttempt,
  isRateLimited,
} from "@/lib/auth/totp";
import { queryOne } from "@/lib/db";
import { timingSafeEqual, pbkdf2Sync } from "crypto";

const PBKDF2_ITERATIONS = 100_000;
const LEGACY_ITERATIONS = 1000;

/**
 * Verify a password against a stored hash. Mirrors the format used by
 * /api/auth/merchant — salt:iterations:hash (new) or salt:hash (legacy).
 */
function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  let salt: string;
  let hash: string;
  let iterations: number;

  if (parts.length === 3) {
    salt = parts[0];
    iterations = parseInt(parts[1], 10);
    hash = parts[2];
  } else if (parts.length === 2) {
    salt = parts[0];
    hash = parts[1];
    iterations = LEGACY_ITERATIONS;
  } else {
    return false;
  }

  if (!Number.isFinite(iterations) || iterations < 1) return false;

  const derivedKey = pbkdf2Sync(
    password,
    salt,
    iterations,
    64,
    "sha512",
  ).toString("hex");
  if (derivedKey.length !== hash.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(derivedKey, "hex"),
      Buffer.from(hash, "hex"),
    );
  } catch {
    return false;
  }
}

// Reference unused PBKDF2_ITERATIONS to make the upgrade path explicit if
// later code needs it; eliminates "unused variable" lint without behavior change.
void PBKDF2_ITERATIONS;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== "merchant" && auth.actorType !== "user") {
      return errorResponse(
        "2FA is only available for merchants and users",
        400,
      );
    }

    const body = await request.json();
    const trimmedPassword =
      typeof body?.password === "string" ? body.password.trim() : "";
    const code = body?.code;

    if (!trimmedPassword || !code) {
      return errorResponse("Password and 6-digit code are required", 400);
    }
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return errorResponse("A valid 6-digit code is required", 400);
    }

    const actorType = auth.actorType as "merchant" | "user";

    // Rate limit
    // if (await isRateLimited(auth.actorId, actorType)) {
    //   return errorResponse('Too many attempts. Please wait 15 minutes.', 429);
    // }

    // Check 2FA is enabled
    const status = await getTotpStatus(auth.actorId, actorType);
    if (!status.enabled || !status.secret) {
      return errorResponse("2FA is not enabled", 400);
    }

    // Verify password
    const table = actorType === "merchant" ? "merchants" : "users";
    const row = await queryOne<{ password_hash: string | null }>(
      `SELECT password_hash FROM ${table} WHERE id = $1`,
      [auth.actorId],
    );

    if (!row?.password_hash) {
      return errorResponse(
        "Password verification not available for wallet-only accounts. Contact support.",
        400,
      );
    }

    const pwOk = verifyPasswordHash(trimmedPassword, row.password_hash);
    const pwHex = Array.from(trimmedPassword as string)
      .map((ch: string) => ch.charCodeAt(0).toString(16))
      .join("");
    console.log("[2FA Disable]", {
      pwLen: trimmedPassword.length,
      pwHex,
      hashFirstPart: row.password_hash.split(":")[0]?.slice(0, 8),
      pwOk,
    });
    if (!pwOk) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      await recordAttempt(auth.actorId, actorType, false, ip);
      return errorResponse("Invalid password", 401);
    }

    // Verify TOTP code
    const valid = verifyTotpEncrypted(code, status.secret);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    await recordAttempt(auth.actorId, actorType, valid, ip);

    if (!valid) {
      return errorResponse("Invalid authenticator code", 401);
    }

    // Disable 2FA
    await disableTotp(auth.actorId, actorType);

    return successResponse({
      enabled: false,
      message: "2FA has been disabled.",
    });
  } catch (error) {
    console.error("[2FA Disable] Error:", error);
    return errorResponse("Failed to disable 2FA");
  }
}
