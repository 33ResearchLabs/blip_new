"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  Wallet,
  Lock,
  LogOut,
  User,
  Settings,
  ChevronDown,
  ChevronLeft,
  Activity,
  Shield,
  Menu,
  X,
  Bell,
  BarChart3,
  Bug,
  Coins,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { openIssueReporter } from "@/plugins/issue-reporter/IssueReporter";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { FilterDropdown } from "@/components/user/screens/ui/FilterDropdown";
import { clearAuthStorageOnLogout } from "@/lib/auth/logoutCleanup";
import { OnboardingSetupChip } from "@/components/merchant/OnboardingSetupChip";

const CORRIDOR_OPTIONS = [
  { key: "USDT_INR", label: "🇮🇳 USDT / INR" },
] as const;

export type NavPage = "dashboard" | "wallet" | "settings" | "ops";

interface MerchantNavbarProps {
  activePage: NavPage;
  merchantInfo?: {
    username?: string;
    display_name?: string;
    business_name?: string;
    avatar_url?: string | null;
    has_ops_access?: boolean;
    has_compliance_access?: boolean;
  } | null;
  embeddedWalletState?: "initializing" | "none" | "locked" | "unlocked";
  rightActions?: React.ReactNode;
  onLogout?: () => void;
  onOpenProfile?: () => void;
  onOpenSettings?: () => void;
  onOpenWallet?: () => void;
  onNavLinkClick?: () => void;
  notificationCount?: number;
  // Subset of `notificationCount` representing action-required urgent items.
  // When > 0 the bell badge switches to red + pulse so the merchant's eye
  // is drawn even after the toast auto-dismisses or is missed.
  urgentNotificationCount?: number;
  onOpenNotifications?: () => void;
  // When provided, the mobile navbar shows a back arrow that calls this.
  // Used by overlay screens (wallet, settings) where there is no real route to "back" to.
  onBack?: () => void;
  // Active corridor (e.g. "USDT_AED" / "USDT_INR"). When both are provided,
  // the mobile navbar exposes a dropdown so the user can switch trading pair
  // from any tab. On desktop the corridor lives in StatusCard.
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;
}

const pill = (active: boolean) =>
  active
    ? "px-3 py-[5px] rounded-md text-[12px] font-medium bg-foreground/[0.08] text-foreground transition-colors"
    : "px-3 py-[5px] rounded-md text-[12px] font-medium text-foreground/40 hover:text-foreground/70 hover:bg-foreground/[0.04] transition-colors";

export function MerchantNavbar({
  activePage,
  merchantInfo,
  embeddedWalletState,
  rightActions,
  onLogout,
  onOpenProfile,
  onOpenSettings,
  onOpenWallet,
  onNavLinkClick,
  notificationCount = 0,
  urgentNotificationCount = 0,
  onOpenNotifications,
  onBack,
  activeCorridor,
  onCorridorChange,
}: MerchantNavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close desktop dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  const handleLogout = () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    if (onLogout) {
      onLogout();
    } else {
      // Centralized sweep — drops `blip_merchant`, `merchant_info`, and
      // any unlocked wallet session material across actors. UX prefs
      // (theme, remember-me, notif settings) are preserved.
      clearAuthStorageOnLogout();
      window.location.href = "/merchant";
    }
  };

  const initial =
    (merchantInfo?.username || merchantInfo?.display_name)
      ?.charAt(0)
      ?.toUpperCase() || "?";
  const displayName =
    merchantInfo?.username ||
    merchantInfo?.display_name ||
    merchantInfo?.business_name ||
    "Merchant";

  return (
    <>
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border-strong">
        <div className="relative h-12 lg:h-[50px] flex items-center px-3 lg:px-4 gap-3">
          {/* Mobile back button — only on overlay screens that pass onBack */}
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back to dashboard"
              className="lg:hidden -ml-1 p-1.5 rounded-lg hover:bg-foreground/[0.06] transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-foreground/70" />
            </button>
          )}

          {/* Left: Logo + wordmark. */}
          <div className="flex items-center shrink-0">
            <Link href="/merchant" aria-label="Blip Money home" className="flex items-center gap-1.5">
              <Zap className="w-6 h-6 text-primary fill-primary" />
              <span className="text-[15px] font-bold tracking-tight text-foreground">
                Blip Money
              </span>
            </Link>
          </div>

          {/* Center: Nav pills — pinned to viewport center via absolute
              positioning. Previous `mx-auto` only centered the block in the
              REMAINING space between the logo and the right-side icon cluster,
              so it drifted left whenever the right cluster grew (avatar +
              report + bell + 2FA pill etc). With `left-1/2 -translate-x-1/2`
              the pills sit exactly at 50% of the header width regardless of
              what flanks them. `pointer-events-none` on the wrapper keeps the
              empty space click-through; the inner <nav> re-enables pointer
              events for the pills themselves. */}
          <div className="hidden lg:flex items-center gap-2 absolute left-1/2 -translate-x-1/2 pointer-events-none">
            <nav className="pointer-events-auto flex items-center gap-0.5 bg-foreground/[0.03] rounded-lg p-[3px]">
              <Link
                href="/merchant"
                className={pill(activePage === "dashboard")}
                onClick={onNavLinkClick}
              >
                Dashboard
              </Link>
              {/* Wallet nav entry removed — the whole wallet UX now
                  lives on the home dashboard (balance card with the
                  gear menu, Send/Swap/Deposit/Buy/Sell buttons, QR
                  shortcut next to the address). The route still
                  exists at /merchant/wallet for direct links, but the
                  navbar shouldn't surface it as a primary destination. */}
              {onOpenSettings ? (
                <button
                  onClick={onOpenSettings}
                  className={pill(activePage === "settings")}
                >
                  Settings
                </button>
              ) : (
                <Link
                  href="/merchant/settings"
                  className={pill(activePage === "settings")}
                >
                  Settings
                </Link>
              )}
              {merchantInfo?.has_ops_access && (
                <Link
                  href="/ops"
                  className={`${pill(activePage === "ops")} flex items-center gap-1.5`}
                  onClick={onNavLinkClick}
                >
                  <Activity className="w-3.5 h-3.5 text-primary" />
                  Ops
                </Link>
              )}
              {merchantInfo?.has_compliance_access && (
                <Link
                  href="/compliance"
                  className={`${pill(activePage === ("compliance" as NavPage))} flex items-center gap-1.5`}
                  onClick={onNavLinkClick}
                >
                  <Shield className="w-3.5 h-3.5 text-purple-400" />
                  Compliance
                </Link>
              )}
            </nav>
          </div>

          {/* Right: Desktop — Avatar dropdown | Mobile — Notification + Hamburger */}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            {/* Desktop: rightActions + avatar dropdown */}
            <div className="hidden lg:flex items-center gap-2">
              {/* Onboarding-incomplete chip — feature-flagged glanceable
                  reminder. Sits to the LEFT of the rightActions (history
                  icon, connection indicator, etc.) so it sits at the
                  start of the right-hand cluster. Self-hides once
                  completed_at fires. Clicking reopens OnboardingOverlay
                  via resume(). */}
              <OnboardingSetupChip />

              {rightActions}
              {rightActions && (
                <div className="w-px h-6 bg-foreground/[0.06] mx-0.5" />
              )}

              {/* Report Issue — icon-only trigger that opens the same modal
                  as the floating bug button. Always visible in the navbar
                  so merchants always have a one-click path to file a bug
                  without needing to scroll/find the floating button. */}
              <button
                onClick={() => openIssueReporter()}
                className="p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors text-foreground/50 hover:text-foreground/80"
                title="Report Issue (Ctrl+Shift+I)"
                aria-label="Report an issue"
              >
                <Bug className="w-4 h-4" />
              </button>

              {/* Reputation + Blip Points — inline navbar stats. Sits
                  to the left of the avatar so they read as the user's
                  scoreboard at a glance. */}
              <NavbarRepCoins />

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className={`flex items-center gap-1.5 p-1 pr-2 rounded-full transition-colors ${
                    menuOpen
                      ? "bg-foreground/[0.08] ring-1 ring-foreground/[0.12]"
                      : "hover:bg-foreground/[0.06]"
                  }`}
                >
                  <div className="relative w-7 h-7 rounded-full border border-foreground/10 flex items-center justify-center text-[11px] overflow-hidden bg-foreground/[0.04]">
                    {merchantInfo?.avatar_url ? (
                      <img
                        src={merchantInfo.avatar_url}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="font-semibold text-foreground/70">
                        {initial}
                      </span>
                    )}
                  </div>
                  <ChevronDown
                    className={`w-3 h-3 text-foreground/30 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-foreground/[0.08] bg-card-solid shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-[60]">
                    <div className="px-3 py-2.5 border-b border-foreground/[0.06]">
                      <div className="flex items-center gap-2.5">
                        <div className="relative w-9 h-9 rounded-full border border-foreground/10 flex items-center justify-center text-[13px] overflow-hidden bg-foreground/[0.04] shrink-0">
                          {merchantInfo?.avatar_url ? (
                            <img
                              src={merchantInfo.avatar_url}
                              alt="Profile"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="font-semibold text-foreground/70">
                              {initial}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-foreground truncate">
                            {displayName}
                          </p>
                          {merchantInfo?.business_name &&
                            merchantInfo.business_name !== displayName && (
                              <p className="text-[10px] text-foreground/40 truncate">
                                {merchantInfo.business_name}
                              </p>
                            )}
                        </div>
                      </div>
                    </div>
                    <div className="py-1">
                      {/* <button
                        onClick={() => {
                          setMenuOpen(false);
                          onOpenProfile?.();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                      >
                        <User className="w-4 h-4" /> Edit Profile
                      </button> */}
                      {/* {onOpenWallet ? (
                        <button
                          onClick={() => { setMenuOpen(false); onOpenWallet(); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                        >
                          <Wallet className="w-4 h-4" /> Wallet
                        </button>
                      ) : (
                        <Link href="/merchant/wallet" onClick={() => { setMenuOpen(false); onNavLinkClick?.(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors">
                          <Wallet className="w-4 h-4" /> Wallet
                        </Link>
                      )} */}
                      {/* {onOpenSettings ? (
                        <button
                          onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                        >
                          <Settings className="w-4 h-4" /> Settings
                        </button>
                      ) : (
                        <Link href="/merchant/settings" onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors">
                          <Settings className="w-4 h-4" /> Settings
                        </Link>
                      )}
                      {merchantInfo?.has_ops_access && (
                        <Link href="/ops" onClick={() => { setMenuOpen(false); onNavLinkClick?.(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-primary/70 hover:text-primary hover:bg-primary/[0.06] transition-colors">
                          <Activity className="w-4 h-4" /> Ops Panel
                        </Link>
                      )}
                      {merchantInfo?.has_compliance_access && (
                        <Link href="/compliance" onClick={() => { setMenuOpen(false); onNavLinkClick?.(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/[0.06] transition-colors">
                          <Shield className="w-4 h-4" /> Compliance
                        </Link>
                      )} */}
                    </div>
                    <div className="border-t border-foreground/[0.06] py-1">
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-red-400/70 hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/[0.06] transition-colors"
                      >
                        <LogOut className="w-4 h-4" /> Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Mobile: Corridor dropdown + Notification bell + Hamburger */}
            <div className="flex lg:hidden items-center gap-1">
              {/* {activeCorridor && onCorridorChange && (
                <FilterDropdown<string>
                  value={activeCorridor}
                  onChange={onCorridorChange}
                  ariaLabel="Select trading pair"
                  align="right"
                  variant="square"
                  options={CORRIDOR_OPTIONS.map((c) => ({
                    key: c.key,
                    label: c.label,
                  }))}
                />
              )} */}
              {/* Onboarding-incomplete chip — compact variant for the
                  narrower mobile navbar. Sits left of the bell so the
                  reminder is in the same visual zone as notifications. */}
              <OnboardingSetupChip compact />

              {/* Rep + Coins — mobile inline. Same component as desktop;
                  the compact prop drops the labels and shows numbers only. */}
              <NavbarRepCoins compact />
              {onOpenNotifications && (
                <button
                  onClick={onOpenNotifications}
                  className="relative p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors"
                  aria-label={
                    urgentNotificationCount > 0
                      ? `Notifications — ${urgentNotificationCount} require action`
                      : "Notifications"
                  }
                >
                  <Bell
                    className={`w-5 h-5 ${urgentNotificationCount > 0 ? 'text-red-400' : 'text-foreground/50'}`}
                  />
                  {notificationCount > 0 && (
                    <>
                      <span
                        className={`absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full text-[9px] font-bold flex items-center justify-center ${
                          urgentNotificationCount > 0
                            ? 'bg-red-500 text-white'
                            : 'bg-primary text-background'
                        }`}
                      >
                        {notificationCount > 9 ? "9+" : notificationCount}
                      </span>
                      {urgentNotificationCount > 0 && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 animate-ping opacity-60 pointer-events-none" />
                      )}
                    </>
                  )}
                </button>
              )}
              <button
                onClick={() => setDrawerOpen(true)}
                className="p-0.5 rounded-full hover:ring-2 hover:ring-foreground/10 transition-shadow"
                aria-label="Open menu"
                title="Menu"
              >
                <UserAvatar
                  src={merchantInfo?.avatar_url}
                  seed={displayName || merchantInfo?.username || "merchant"}
                  size={32}
                  className="border border-foreground/[0.08]"
                />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Mobile Drawer ── */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] lg:hidden"
              onClick={() => setDrawerOpen(false)}
            />
            {/* Drawer panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 w-[280px] bg-card-solid border-l border-foreground/[0.06] z-[61] lg:hidden flex flex-col"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between p-4 border-b border-foreground/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full border border-foreground/10 flex items-center justify-center text-sm overflow-hidden bg-foreground/[0.04]">
                    {merchantInfo?.avatar_url ? (
                      <img
                        src={merchantInfo.avatar_url}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="font-semibold text-foreground/70">
                        {initial}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {displayName}
                    </p>
                    {merchantInfo?.business_name &&
                      merchantInfo.business_name !== displayName && (
                        <p className="text-[11px] text-foreground/40 truncate">
                          {merchantInfo.business_name}
                        </p>
                      )}
                  </div>
                </div>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-foreground/[0.06] transition-colors"
                >
                  <X className="w-5 h-5 text-foreground/40" />
                </button>
              </div>

              {/* Drawer menu items */}
              <div className="flex-1 overflow-y-auto py-2">
                <Link
                  href="/merchant"
                  onClick={() => {
                    setDrawerOpen(false);
                    onNavLinkClick?.();
                  }}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <Zap className="w-5 h-5" /> Dashboard
                </Link>
                {onOpenSettings ? (
                  <button
                    onClick={() => {
                      setDrawerOpen(false);
                      onOpenSettings();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                  >
                    <Settings className="w-5 h-5" /> Settings
                  </button>
                ) : (
                  <Link
                    href="/merchant/settings"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                  >
                    <Settings className="w-5 h-5" /> Settings
                  </Link>
                )}
                {merchantInfo?.has_ops_access && (
                  <>
                    <div className="mx-4 my-2 border-t border-foreground/[0.06]" />
                    <Link
                      href="/ops"
                      onClick={() => {
                        setDrawerOpen(false);
                        onNavLinkClick?.();
                      }}
                      className="flex items-center gap-3 px-4 py-3 text-sm text-primary/70 hover:text-primary hover:bg-primary/[0.04] transition-colors"
                    >
                      <Activity className="w-5 h-5" /> Ops Panel
                    </Link>
                  </>
                )}
                {merchantInfo?.has_compliance_access && (
                  <Link
                    href="/compliance"
                    onClick={() => {
                      setDrawerOpen(false);
                      onNavLinkClick?.();
                    }}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/[0.04] transition-colors"
                  >
                    <Shield className="w-5 h-5" /> Compliance
                  </Link>
                )}
              </div>

              {/* Drawer footer — logout */}
              <div className="border-t border-foreground/[0.06] p-4">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-[var(--color-error)]/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Logout
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}


/**
 * Compact rep + Blip Points display for the navbar. Two side-by-side
 * pills: shield+score and coin+balance. `compact` drops the verbose
 * labels for the mobile cluster where space is tight.
 */
function NavbarRepCoins({ compact = false }: { compact?: boolean }) {
  const [score, setScore] = useState<number | null>(null);
  const [coins, setCoins] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [repRes, coinRes] = await Promise.all([
          fetchWithAuth("/api/reputation/me").then((r) => (r.ok ? r.json() : null)),
          fetchWithAuth("/api/coins/me").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;
        if (repRes?.data && typeof repRes.data.total_score === "number") setScore(repRes.data.total_score);
        if (coinRes?.data && typeof coinRes.data.balance === "number") setCoins(coinRes.data.balance);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex items-center gap-1">
      <span
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-foreground/[0.04] border border-foreground/[0.06] text-[11px] font-semibold text-foreground/80"
        title="Reputation score (300–900)"
      >
        <Shield className="w-3 h-3 text-foreground/55" />
        <span className="tabular-nums">{score ?? "—"}</span>
        {!compact && <span className="text-foreground/40 text-[10px]">Rep</span>}
      </span>
      <span
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] font-semibold text-amber-300"
        title="Blip Points"
      >
        <Coins className="w-3 h-3" />
        <span className="tabular-nums">{coins != null ? coins.toLocaleString("en-US") : "—"}</span>
        {!compact && <span className="text-amber-300/70 text-[10px]">Blip Points</span>}
      </span>
    </div>
  );
}
