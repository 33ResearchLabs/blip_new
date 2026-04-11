/**
 * POST /api/2fa/verify
 *
 * Verify a TOTP code to ENABLE 2FA.
 * Called after /api/2fa/setup — confirms the user has correctly configured their authenticator app.
 * On success: moves temp secret to permanent + sets totp_enabled = true.
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
  enableTotp,
  recordAttempt,
  isRateLimited,
  generateBackupCodes,
  storeBackupCodes,
} from "@/lib/auth/totp";

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
    const { code } = body;

    if (!code || typeof code !== "string" || !/^\d{6}$/.test(code)) {
      return errorResponse("A 6-digit code is required", 400);
    }

    const actorType = auth.actorType as "merchant" | "user";

    // Rate limit check
    if (await isRateLimited(auth.actorId, actorType)) {
      return errorResponse("Too many attempts. Please wait 15 minutes.", 429);
    }

    // Get temp secret
    const status = await getTotpStatus(auth.actorId, actorType);
    if (status.enabled) {
      return errorResponse("2FA is already enabled", 409);
    }
    if (!status.secret) {
      return errorResponse(
        "No 2FA setup in progress. Call /api/2fa/setup first.",
        400,
      );
    }

    // Verify OTP against temp secret
    const valid = verifyTotpEncrypted(code, status.secret);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    await recordAttempt(auth.actorId, actorType, valid, ip);

    if (!valid) {
      return errorResponse(
        "Invalid code. Make sure your authenticator app is synced.",
        401,
      );
    }

    // Enable 2FA
    await enableTotp(auth.actorId, actorType);

    // Generate single-use recovery codes — return plaintext ONCE
    const { plaintext, hashes } = generateBackupCodes();
    await storeBackupCodes(auth.actorId, actorType, hashes);

    return successResponse({
      enabled: true,
      message: "2FA has been enabled successfully.",
      backupCodes: plaintext,
    });
  } catch (error) {
    console.error("[2FA Verify] Error:", error);
    return errorResponse("Failed to verify 2FA code");
  }
}
