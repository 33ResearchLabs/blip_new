"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppLaunchPage } from "@/components/AppLaunchPage";

/**
 * `/` — the public marketing landing (the "Two apps. One network." chooser).
 *
 * The user app itself now lives at `/user`; this route stays as the landing
 * so fresh visitors get the marketing splash. Two cases are forwarded straight
 * into the app instead of seeing the chooser:
 *   1. Installed user-PWA launches (start_url carries `?pwa=user`).
 *   2. Returning users with an existing session — detected via the same
 *      `blip_user` client hint the app uses to bootstrap (see useUserAuth).
 *      `/user` re-validates the session server-side and falls back to its own
 *      login screen if it's stale, so a forward is always safe.
 *
 * The check is synchronous (URL param + localStorage, no network), so forwarded
 * users never flash the marketing page. We render nothing until it resolves —
 * a single frame for logged-out visitors before the chooser appears.
 */
export default function Home() {
  const router = useRouter();
  const [showLanding, setShowLanding] = useState(false);

  useEffect(() => {
    const search = window.location.search;
    const isUserPwa = new URLSearchParams(search).get("pwa") === "user";
    let hasSession = false;
    try {
      hasSession = !!localStorage.getItem("blip_user");
    } catch {
      /* localStorage unavailable — treat as no session */
    }
    if (isUserPwa || hasSession) {
      // Preserve any deep-link params (?pwa=user, ?order=, ?action=, …).
      router.replace(`/user${search}`);
      return;
    }
    setShowLanding(true);
  }, [router]);

  if (!showLanding) return null;
  return <AppLaunchPage />;
}
