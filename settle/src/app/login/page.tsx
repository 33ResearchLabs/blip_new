"use client";

/**
 * /login — redirects to /user?welcome=skip&tab=… so visitors land directly
 * on the user login form.
 *
 * The role chooser that previously sat here was removed: the marketing
 * landing at `/` already forks the User vs Merchant paths via its hero
 * CTAs ("Send money" → user form, "Run a desk" → /market/login), and
 * the navbar Sign-in pill is meant for returning users — sending them
 * through an extra "Choose your portal" step was friction.
 *
 * `?tab` and `?reason` are forwarded so deep links keep working
 * (e.g. /login?tab=register from the merchant promo card,
 * /login?reason=session_expired from the auth client).
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab") === "register" ? "register" : "signin";
    const reason = searchParams.get("reason");
    const reasonParam = reason ? `&reason=${reason}` : "";
    router.replace(`/user?welcome=skip&tab=${tab}${reasonParam}`);
  }, [router, searchParams]);

  return (
    <div className="min-h-dvh bg-[#0B0F14] flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-white/40 animate-spin" />
    </div>
  );
}
