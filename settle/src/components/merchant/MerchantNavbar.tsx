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
import { Logo } from "@/components/shared/Logo";

const CORRIDOR_OPTIONS = [{ key: "USDT_INR", label: "🇮🇳 USDT / INR" }] as const;

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
  // Mobile-only: title shown on the left of the header (the active tab name,
  // e.g. "New Order"). When set, it replaces the avatar + @username on mobile
  // so each tab reads as its own screen. Desktop is unaffected.
  mobileTitle?: string;
  // Mobile-only: small muted context line under `mobileTitle` (e.g.
  // "3 orders waiting"). Turns the header into a two-line large-title bar.
  // Only rendered alongside `mobileTitle`; ignored on desktop.
  mobileSubtitle?: string;
  // Active corridor (e.g. "USDT_AED" / "USDT_INR"). When both are provided,
  // the mobile navbar exposes a dropdown so the user can switch trading pair
  // from any tab. On desktop the corridor lives in StatusCard.
  activeCorridor?: string;
  onCorridorChange?: (corridorId: string) => void;
}

const pill = (active: boolean) =>
  active
    ? "px-3 py-[5px] rounded-md text-[11px] font-semibold tracking-wide bg-white/[0.08] text-white border border-white/[0.08] transition-colors"
    : "px-3 py-[5px] rounded-md text-[11px] font-medium tracking-wide text-white/35 hover:text-white/65 hover:bg-white/[0.04] border border-transparent transition-colors";

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
  mobileTitle,
  mobileSubtitle,
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
      window.location.href = "/market";
    }
  };

  const displayName =
    merchantInfo?.username ||
    merchantInfo?.display_name ||
    merchantInfo?.business_name ||
    "Merchant";

  return (
    <>
      <header className="sticky top-0 z-50 bg-[#070710]/96 backdrop-blur-md border-b border-white/[0.06]">
        {/* Per-tab mobile screens (mobileTitle set) get a taller two-line
            large-title bar; desktop is fixed at 50px and overlay/home screens
            keep the compact 48px height. */}
        <div
          className={`relative ${mobileTitle ? "h-[68px]" : "h-12"} lg:h-[50px] flex lg:grid lg:grid-cols-[1fr_auto_1fr] items-center px-3 lg:px-4 gap-3`}
        >
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

          {/* Left: Logo on desktop / merchant identity on mobile */}
          <div className="flex items-center shrink-0 lg:justify-self-start min-w-0">
            {/* Desktop — full logo wordmark */}
            <span className="hidden lg:flex">
              <Logo href="/market" />
            </span>
            {/* Mobile — the active tab name reads as the screen title. Falls
                back to @username only if no title was supplied. */}
            <div className="flex lg:hidden items-center gap-2 min-w-0">
              {!onBack && (
                mobileTitle ? (
                  // Two-line large-title block. No negative margin: the header
                  // padding (px-3 = 12px) already matches the content column
                  // below (<main> p-3 = 12px), so the title's left edge lines up
                  // with the tab strip / search field / order cards on every tab.
                  <div className="flex flex-col justify-center min-w-0">
                    <span className="text-[22px] font-bold text-white tracking-tight truncate leading-none">
                      {mobileTitle}
                    </span>
                    {mobileSubtitle && (
                      <span className="mt-[5px] text-[12.5px] font-medium text-white/45 truncate leading-none">
                        {mobileSubtitle}
                      </span>
                    )}
                  </div>
                ) : (
                  <>
                    <UserAvatar
                      src={merchantInfo?.avatar_url}
                      seed={merchantInfo?.username || merchantInfo?.display_name || "merchant"}
                      size={26}
                      alt={displayName}
                      className="border border-white/[0.1] shrink-0"
                    />
                    <span className="text-[15px] font-semibold text-white/90 tracking-tight truncate">
                      {merchantInfo?.username
                        ? `@${merchantInfo.username}`
                        : merchantInfo?.display_name || "Merchant"}
                    </span>
                  </>
                )
              )}
            </div>
          </div>

          {/* Center: Nav pills — placed in the centre grid column.
              The container uses `grid-cols-[1fr_auto_1fr]` so the two side
              columns are equal in width regardless of their content, which
              keeps this nav visually centred on the viewport (matching the
              previous absolute-position behaviour) WITHOUT letting the
              right-hand cluster overlap it. `min-w-0` allows the nav to
              shrink before any overlap can occur, and Ops/Compliance fall
              back to icon-only below xl. */}
          <div className="hidden lg:flex items-center justify-center min-w-0">
            <nav className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.05] rounded-lg p-[3px] min-w-0 max-w-full">
              <Link
                href="/market"
                className={pill(activePage === "dashboard")}
                onClick={onNavLinkClick}
              >
                Dashboard
              </Link>
              {onOpenWallet ? (
                <button
                  onClick={onOpenWallet}
                  className={pill(activePage === "wallet")}
                >
                  Wallet
                </button>
              ) : (
                <Link
                  href="/market/wallet"
                  className={pill(activePage === "wallet")}
                  onClick={onNavLinkClick}
                >
                  Wallet
                </Link>
              )}
              {onOpenSettings ? (
                <button
                  onClick={onOpenSettings}
                  className={pill(activePage === "settings")}
                >
                  Settings
                </button>
              ) : (
                <Link
                  href="/market/settings"
                  className={pill(activePage === "settings")}
                >
                  Settings
                </Link>
              )}
              {merchantInfo?.has_ops_access && (
                <Link
                  href="/ops"
                  className={`${pill(activePage === "ops")} flex items-center gap-1.5 shrink-0`}
                  onClick={onNavLinkClick}
                  aria-label="Ops"
                  title="Ops"
                >
                  <Activity className="w-3.5 h-3.5 text-[#f5f5f7] shrink-0" />
                  <span className="hidden xl:inline">Ops</span>
                </Link>
              )}
              {merchantInfo?.has_compliance_access && (
                <Link
                  href="/compliance"
                  className={`${pill(activePage === ("compliance" as NavPage))} flex items-center gap-1.5 shrink-0`}
                  onClick={onNavLinkClick}
                  aria-label="Compliance"
                  title="Compliance"
                >
                  <Shield className="w-3.5 h-3.5 text-white/60 shrink-0" />
                  <span className="hidden xl:inline">Compliance</span>
                </Link>
              )}
            </nav>
          </div>

          {/* Right: Desktop — Avatar dropdown | Mobile — Notification + Hamburger */}
          <div className="flex items-center gap-2 shrink-0 ml-auto lg:ml-0 lg:justify-self-end">
            {/* Desktop: rightActions + avatar dropdown */}
            <div className="hidden lg:flex items-center gap-2">
              {rightActions}
              {rightActions && (
                <div className="hidden lg:block w-px h-6 bg-foreground/[0.06] mx-0.5" />
              )}

              {/* Report Issue — icon-only trigger that opens the same modal
                  as the floating bug button. Hidden below xl so the
                  narrower lg viewport keeps the centre nav collision-free;
                  the floating bug button remains available everywhere. */}
              <button
                onClick={() => openIssueReporter()}
                className="hidden xl:inline-flex p-2 rounded-lg hover:bg-foreground/[0.06] transition-colors text-foreground/50 hover:text-foreground/80"
                title="Report Issue (Ctrl+Shift+I)"
                aria-label="Report an issue"
              >
                <Bug className="w-4 h-4" />
              </button>

              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((prev) => !prev)}
                  className={`flex items-center gap-1.5 p-1 pr-2 rounded-full transition-colors ${
                    menuOpen
                      ? "bg-foreground/[0.08] ring-1 ring-foreground/[0.12]"
                      : "hover:bg-foreground/[0.06]"
                  }`}
                >
                  <span className="rounded-full p-[2px] border border-foreground/25 bg-foreground/[0.08] inline-flex">
                    <UserAvatar
                      src={merchantInfo?.avatar_url}
                      seed={
                        merchantInfo?.username ||
                        merchantInfo?.display_name ||
                        "merchant"
                      }
                      size={28}
                      alt={displayName}
                      className="border border-foreground/10"
                    />
                  </span>
                  <ChevronDown
                    className={`w-3 h-3 text-foreground/30 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-foreground/[0.08] bg-card-solid shadow-2xl shadow-black/60 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 z-[60]">
                    <div className="px-3 py-2.5 border-b border-foreground/[0.06]">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar
                          src={merchantInfo?.avatar_url}
                          seed={
                            merchantInfo?.username ||
                            merchantInfo?.display_name ||
                            "merchant"
                          }
                          size={36}
                          alt={displayName}
                          className="border border-foreground/10"
                        />
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
                        <Link href="/market/wallet" onClick={() => { setMenuOpen(false); onNavLinkClick?.(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors">
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
                        <Link href="/market/settings" onClick={() => setMenuOpen(false)} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-foreground/60 hover:text-foreground hover:bg-foreground/[0.06] transition-colors">
                          <Settings className="w-4 h-4" /> Settings
                        </Link>
                      )}
                      {merchantInfo?.has_ops_access && (
                        <Link href="/ops" onClick={() => { setMenuOpen(false); onNavLinkClick?.(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-[#f5f5f7]/70 hover:text-white hover:bg-white/[0.06] transition-colors">
                          <Activity className="w-4 h-4" /> Ops Panel
                        </Link>
                      )}
                      {merchantInfo?.has_compliance_access && (
                        <Link href="/compliance" onClick={() => { setMenuOpen(false); onNavLinkClick?.(); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors">
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
              {onOpenNotifications && (
                <button
                  onClick={onOpenNotifications}
                  className="relative w-10 h-10 flex items-center justify-center rounded-full bg-white/[0.055] border border-white/[0.09] hover:bg-white/[0.08] transition-colors"
                  aria-label={
                    urgentNotificationCount > 0
                      ? `Notifications — ${urgentNotificationCount} require action`
                      : "Notifications"
                  }
                >
                  <Bell
                    className={`w-[18px] h-[18px] ${urgentNotificationCount > 0 ? "text-red-400" : "text-foreground/60"}`}
                  />
                  {notificationCount > 0 && (
                    <>
                      <span
                        className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-[#070710] ${
                          urgentNotificationCount > 0
                            ? "bg-red-500 text-white"
                            : "bg-[#f5f5f7] text-[#0b0b0c]"
                        }`}
                      >
                        {notificationCount > 9 ? "9+" : notificationCount}
                      </span>
                      {urgentNotificationCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-[18px] h-[18px] rounded-full bg-red-500 animate-ping opacity-60 pointer-events-none" />
                      )}
                    </>
                  )}
                </button>
              )}
              {/* The avatar/hamburger menu is hidden on the per-tab screens
                  (where mobileTitle is set) so the header is just "tab name +
                  bell". Overlay screens (back arrow) keep the menu. */}
              {!mobileTitle && (
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
              )}
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
                  <UserAvatar
                    src={merchantInfo?.avatar_url}
                    seed={
                      merchantInfo?.username ||
                      merchantInfo?.display_name ||
                      "merchant"
                    }
                    size={40}
                    alt={displayName}
                    className="border border-foreground/10"
                  />
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
                  href="/market"
                  onClick={() => {
                    setDrawerOpen(false);
                    onNavLinkClick?.();
                  }}
                  className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <Zap className="w-5 h-5" /> Dashboard
                </Link>
                {onOpenWallet ? (
                  <button
                    onClick={() => {
                      setDrawerOpen(false);
                      onOpenWallet();
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                  >
                    <Wallet className="w-5 h-5" /> Wallet
                  </button>
                ) : (
                  <Link
                    href="/market/wallet"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                  >
                    <Wallet className="w-5 h-5" /> Wallet
                  </Link>
                )}
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
                    href="/market/settings"
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
                      className="flex items-center gap-3 px-4 py-3 text-sm text-[#f5f5f7]/70 hover:text-white hover:bg-white/[0.06] transition-colors"
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
                    className="flex items-center gap-3 px-4 py-3 text-sm text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors"
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
  // Initialize with the safe defaults (500 rep / 100 coins) so the
  // chip always renders SOMETHING readable even if the API hasn't
  // responded yet or errors out. The real numbers replace these as
  // soon as fetch resolves.
  const [score, setScore] = useState<number>(500);
  const [coins, setCoins] = useState<number>(100);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [repRes, coinRes] = await Promise.all([
          fetchWithAuth("/api/reputation/me").then((r) =>
            r.ok ? r.json() : null,
          ),
          fetchWithAuth("/api/coins/me").then((r) => (r.ok ? r.json() : null)),
        ]);
        if (cancelled) return;
        if (repRes?.data && typeof repRes.data.total_score === "number")
          setScore(repRes.data.total_score);
        if (coinRes?.data && typeof coinRes.data.balance === "number")
          setCoins(coinRes.data.balance);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Desktop (non-compact) variant hides the verbose labels at lg and only
  // re-introduces them at xl+, so the right cluster stays narrow enough at
  // narrow-desktop widths to never collide with the centre nav.
  return (
    <div className="flex items-center gap-1">
      <span
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.07] text-[11px] font-mono font-semibold text-white/70 shrink-0 tabular-nums"
        title="Reputation score (300–900)"
      >
        <Shield className="w-3 h-3 text-white/40 shrink-0" />
        <span>{score}</span>
        {!compact && (
          <span className="hidden xl:inline text-white/30 text-[10px] font-sans">
            REP
          </span>
        )}
      </span>
      <span
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.07] text-[11px] font-mono font-semibold text-white/70 shrink-0 tabular-nums"
        title="Blip Points"
      >
        <Coins className="w-3 h-3 text-[#f5f5f7]/70 shrink-0" />
        <span>{coins.toLocaleString("en-US")}</span>
        {!compact && (
          <span className="hidden xl:inline text-white/30 text-[10px] font-sans">
            PTS
          </span>
        )}
      </span>
    </div>
  );
}
