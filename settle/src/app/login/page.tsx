"use client";

/**
 * /login — role chooser.
 *
 * Visitors land here after clicking "Sign in" on the marketing landing
 * at `/`. The tiles route them to:
 *   - User    → /?welcome=skip&tab=signin   (LandingPage form view)
 *   - Merchant → /merchant/login?tab=signin (existing merchant flow)
 *
 * Previously this route was a redirect helper to `/?welcome=skip` —
 * that bypass is no longer needed because `/` now serves the marketing
 * site instead of the chooser, so the chooser needs its own URL.
 */

import { RoleChooserScreen } from "@/components/auth/RoleChooserScreen";

export default function LoginPage() {
  return <RoleChooserScreen />;
}
