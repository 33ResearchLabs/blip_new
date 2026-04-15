"use client";

/**
 * /login → redirects to /?welcome=skip&tab=... to bypass the welcome page.
 *
 * The root / page renders LandingPage which handles login/register.
 * This redirect adds a query param so LandingPage skips the welcome
 * screen and goes directly to the login form.
 *
 * Zero regression: /?welcome=skip is an additive URL — existing users
 * visiting / still see the welcome page as before.
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
    const reasonParam = reason ? `&reason=${reason}` : '';
    router.replace(`/?welcome=skip&tab=${tab}${reasonParam}`);
  }, [router, searchParams]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-foreground/40 animate-spin" />
    </div>
  );
}
