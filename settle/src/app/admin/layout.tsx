"use client";

/**
 * Admin Layout — persistent nav bar
 *
 * Why this file exists:
 *   Previously every admin page rendered its OWN <header> with the same
 *   logo + nav-pills markup copy-pasted ~14 times. Because Next.js App
 *   Router only re-uses real `layout.tsx` files across child route
 *   navigation, the inline-per-page nav was being unmounted and remounted
 *   on every tab click — visible as a full-page re-render flash even
 *   though only one sibling page was supposed to change. Moving the
 *   nav into this layout lets the App Router keep it mounted; only the
 *   {children} slot below it changes when the operator navigates.
 *
 * Scope (deliberately narrow — PR #1 of two):
 *   - Owns: logo + nav-pill bar + logout button.
 *   - Does NOT own: per-page refresh button, lastRefresh display,
 *     stats.txPerMinute indicator, or any page-specific data fetching.
 *     Those stay in each page and now render as a small in-body toolbar.
 *   - Does NOT own: the login form. Each page keeps its existing auth
 *     gate (PR #2 will consolidate that). The nav is rendered only when
 *     the layout's own auth probe succeeds so a logged-out user never
 *     sees a nav stacked above a centered login form.
 *
 * Auth coordination:
 *   The layout runs its own GET /api/auth/admin probe on mount to decide
 *   whether to render the nav. Pages also keep their per-page session
 *   check (unchanged). When a page completes a successful login or
 *   triggers a logout, it dispatches `admin:auth-changed` on `window` so
 *   this layout re-probes and the nav state stays in sync without a hard
 *   page reload. Layout's logout button does the same and additionally
 *   clears the persisted profile.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { clearAuthStorageOnLogout } from "@/lib/auth/logoutCleanup";
import { Logo } from "@/components/shared/Logo";

const NAV_ITEMS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/admin", label: "Console", exact: true },
  { href: "/admin/live", label: "Live Feed" },
  { href: "/admin/access-control", label: "Access Control" },
  { href: "/admin/accounts", label: "Accounts" },
  { href: "/admin/beta-requests", label: "Beta Requests" },
  { href: "/admin/waitlist", label: "Waitlist" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/monitor", label: "Monitor" },
  { href: "/admin/worker-health", label: "Workers" },
  { href: "/admin/observability", label: "Observability" },
  { href: "/admin/usdt-inr-price", label: "Price" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `null` = first probe still in flight. Treated as "not authed" for
  // render purposes so we never flash a nav over a not-yet-resolved
  // login screen.
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const pathname = usePathname();

  const probeAuth = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/auth/admin");
      const data = await res.json();
      setIsAuthed(!!(data.success && data.data?.valid));
    } catch {
      setIsAuthed(false);
    }
  }, []);

  useEffect(() => {
    probeAuth();
    // Re-probe whenever a page reports an auth-state change (post-login
    // or post-logout). This keeps the nav in sync without forcing a
    // full page reload, which would unmount the same chrome we're
    // trying to preserve.
    const onChange = () => probeAuth();
    window.addEventListener("admin:auth-changed", onChange);
    return () => window.removeEventListener("admin:auth-changed", onChange);
  }, [probeAuth]);

  const handleLogout = useCallback(async () => {
    // Best-effort server-side revoke. Failure here doesn't block the
    // local logout — same pattern the per-page logout buttons used
    // before this layout existed.
    try {
      await fetchWithAuth("/api/auth/admin/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    // Sweep all auth/identity keys (admin token + any residual user/
    // merchant state from a prior dual-login on the same device).
    clearAuthStorageOnLogout();
    setIsAuthed(false);
    window.dispatchEvent(new CustomEvent("admin:auth-changed"));
  }, []);

  // Until we've confirmed auth, render only the page tree. The page
  // itself owns the loading spinner / login form for that period.
  if (!isAuthed) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="h-[50px] flex items-center px-4 gap-3">
          {/* Logo */}
          <div className="flex items-center shrink-0">
            <Logo href="/admin" />
          </div>

          {/* Center: Nav pills */}
          <div className="flex items-center gap-2 mx-auto">
            <nav className="flex items-center gap-0.5 bg-card rounded-lg p-[3px]">
              {NAV_ITEMS.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`px-3 py-[5px] rounded-md text-[12px] font-medium transition-colors ${
                      active
                        ? "bg-accent-subtle text-foreground"
                        : "text-foreground/40 hover:text-foreground/70 hover:bg-card"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right: Logout. Per-page refresh / live badge / lastRefresh
              stays inside the page itself in a sub-toolbar (PR #1 scope). */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg hover:bg-[var(--color-error)]/10 transition-colors"
              title="Logout"
            >
              <LogOut className="w-[18px] h-[18px] text-foreground/40" />
            </button>
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
