"use client";

import { memo, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Shield,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  ShoppingBag,
  MessageCircle,
  Check,
  Info,
  Sparkles,
} from "lucide-react";
import type { Notification } from "@/types/merchant";
import { OnboardingSetupCard } from "@/components/merchant/OnboardingSetupCard";
import { useOnboarding } from "@/contexts/OnboardingContext";

type PanelTab = "notifications" | "getting_started";

interface NotificationsPanelProps {
  notifications: Notification[];
  onMarkRead: (id: string) => void;
  onSelectOrder: (orderId: string) => void;
  onOpenChat?: (orderId: string) => void;
  /** Handlers passed straight to the onboarding setup card. */
  onOpenPaymentMethods?: () => void;
  onOpenSettings?: () => void;
  /** Hide the internal tab strip (use when the parent provides its own header). */
  hideTabStrip?: boolean;
}

interface GroupedNotification {
  latest: Notification;
  count: number;
  unreadCount: number;
  ids: string[];
}

// Type → icon color. The circular badge background was dropped so the
// icon stands on its own — pure color carries the meaning.
const TYPE_STYLES: Record<string, { icon: string }> = {
  escrow:   { icon: 'text-[#f5f5f7]' },
  payment:  { icon: 'text-white/60' },
  complete: { icon: 'text-[#f5f5f7]' },
  message:  { icon: 'text-white/60' },
  dispute:  { icon: 'text-red-400' },
  order:    { icon: 'text-foreground/70' },
  system:   { icon: 'text-foreground/55' },
};

function getStyle(type: string) {
  return TYPE_STYLES[type] ?? TYPE_STYLES.system;
}

function relativeTime(timestamp: number): string {
  const secAgo = Math.floor((Date.now() - timestamp) / 1000);
  if (secAgo < 60) return 'now';
  if (secAgo < 3600) return `${Math.floor(secAgo / 60)}m`;
  if (secAgo < 86400) return `${Math.floor(secAgo / 3600)}h`;
  return `${Math.floor(secAgo / 86400)}d`;
}

export const NotificationsPanel = memo(function NotificationsPanel({
  notifications,
  onMarkRead,
  onSelectOrder,
  onOpenChat,
  onOpenPaymentMethods,
  onOpenSettings,
  hideTabStrip = false,
}: NotificationsPanelProps) {
  const groupedNotifications = useMemo(() => {
    const groups: GroupedNotification[] = [];
    const seen = new Map<string, number>();

    for (const notif of notifications) {
      const key = notif.message;
      const idx = seen.get(key);
      if (idx !== undefined) {
        groups[idx].count++;
        if (!notif.read) groups[idx].unreadCount++;
        groups[idx].ids.push(notif.id);
        if (notif.timestamp > groups[idx].latest.timestamp) {
          groups[idx].latest = notif;
        }
      } else {
        seen.set(key, groups.length);
        groups.push({
          latest: notif,
          count: 1,
          // Badge only counts unread items so the number reflects what's
          // actionable today. Without this the badge accumulates forever
          // (e.g. 6 ORDER_PENDING showing 5d-old reads alongside today's).
          unreadCount: notif.read ? 0 : 1,
          ids: [notif.id],
        });
      }
    }
    return groups;
  }, [notifications]);

  // Compute unread set once for the header counter + Mark-all-read button.
  const unreadIds = useMemo(
    () => notifications.filter((n) => !n.read).map((n) => n.id),
    [notifications],
  );
  const unreadCount = unreadIds.length;

  const markAllRead = () => {
    unreadIds.forEach((id) => onMarkRead(id));
  };

  // Tab state — defaults to Notifications. Previously this defaulted to
  // Getting Started on the theory that new merchants should land on the
  // checklist, but combined with the "show tab while loading" predicate
  // below it produced a visible flash on every hard refresh / route
  // remount for merchants whose real status was skipped or completed.
  // The snap-forward effect below moves the active tab to Getting Started
  // ONCE we have the authoritative status AND it says the merchant needs
  // attention — so new merchants still land where they need to, but
  // completed/skipped merchants never see the flash.
  const [activeTab, setActiveTab] = useState<PanelTab>("notifications");
  const [visibleCount, setVisibleCount] = useState(20);
  // One-shot guard so the snap-forward fires only on the first
  // authoritative status, not every subsequent re-render.
  const [didInitialFocus, setDidInitialFocus] = useState(false);

  // Drives both the Getting Started tab's visibility AND its dot
  // indicator. The tab itself only renders while this is true — once
  // setup is complete (all 5 truth conditions) or the merchant has
  // dismissed the card (skipped_at), the entire tab vanishes and the
  // panel collapses to Notifications-only.
  //
  // Same predicate the OnboardingSetupCard uses for its own visibility.
  const { enabled: onboardingEnabled, status: onboardingStatus, loading: onboardingLoading } =
    useOnboarding();
  const onboardingNeedsAttention = (() => {
    if (!onboardingEnabled) return false;
    // While the first fetch is in flight (loading=true) or status hasn't
    // arrived yet, hide the tab. The previous default ("show while
    // loading") flashed Getting Started on every hard refresh / route
    // remount for merchants whose real answer was "skipped" or "all
    // done" — the tab would appear, the fetch would resolve, and it
    // would vanish. Hiding until we have the authoritative state avoids
    // the flash; the trade-off is a brief absence for merchants who DO
    // need the tab, which is the strictly better default.
    if (onboardingLoading || !onboardingStatus) return false;
    if (onboardingStatus.skipped_at) return false;
    const c = onboardingStatus.conditions;
    const allMet =
      c.usernameSet &&
      c.walletConnected &&
      c.inrRateSet &&
      c.hasTrade;
    return !allMet;
  })();

  // Snap-back: when onboarding completes (or is dismissed) and the
  // Getting Started tab stops rendering, move activeTab off it so we
  // don't show an empty body.
  useEffect(() => {
    if (!onboardingNeedsAttention && activeTab === "getting_started") {
      setActiveTab("notifications");
    }
  }, [onboardingNeedsAttention, activeTab]);

  // Snap-forward (one-shot): the moment we get the first authoritative
  // status response and it says the merchant needs attention, switch
  // the active tab to Getting Started. This replaces the old strategy
  // of defaulting to Getting Started + hiding-via-snap-back; doing it
  // this way means completed/skipped merchants never see the tab flash
  // in during the loading window, while new merchants still land on
  // the checklist as soon as we know they need to.
  useEffect(() => {
    if (didInitialFocus) return;
    if (onboardingLoading || !onboardingStatus) return;
    if (onboardingNeedsAttention) setActiveTab("getting_started");
    setDidInitialFocus(true);
  }, [onboardingLoading, onboardingStatus, onboardingNeedsAttention, didInitialFocus]);

  return (
    <div style={{ height: '100%' }} className="flex flex-col border-b border-section-divider overflow-hidden shrink-0">
      <div className="flex flex-col h-full min-h-0">
        {/* ── Tab Strip ──────────────────────────────────── */}
        <div className={`flex items-center justify-between border-b border-section-divider px-1${hideTabStrip ? " hidden" : ""}`}>
          <div className="flex">
            {/* Notifications tab is always visible — new merchants used to
                only see Getting Started, which hid the panel entirely if
                they wanted to look at incoming activity. Both tabs now
                render side-by-side; Getting Started disappears once the
                onboarding conditions are met (or it's dismissed). */}
            <button
              type="button"
              onClick={() => setActiveTab("notifications")}
              className={`relative flex items-center gap-1 px-2 py-2.5 text-[9px] font-bold font-mono uppercase whitespace-nowrap transition-colors ${
                activeTab === "notifications"
                  ? "text-foreground"
                  : "text-foreground/40 hover:text-foreground/70"
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              Notifications
              {unreadCount > 0 && (
                <span className="text-[9px] bg-[#f5f5f7] text-[#0b0b0c] font-bold px-1.5 py-0.5 rounded-full font-mono tabular-nums min-w-[18px] text-center">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
              {activeTab === "notifications" && (
                <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-foreground rounded-t" />
              )}
            </button>
            {/* Getting Started — only rendered while setup needs attention.
                Once the merchant completes or dismisses onboarding the
                tab disappears entirely; the panel becomes Notifications-
                only and the active tab snap-back effect above ensures
                we don't end up displaying an empty tab body. */}
            {onboardingNeedsAttention && (
              <button
                type="button"
                onClick={() => setActiveTab("getting_started")}
                className={`relative flex items-center gap-1 px-2 py-2.5 text-[9px] font-bold font-mono uppercase whitespace-nowrap transition-colors ${
                  activeTab === "getting_started"
                    ? "text-foreground"
                    : "text-foreground/40 hover:text-foreground/70"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Getting Started
                {/* Desktop: tooltip on hover. Mobile: tiny neutral dot. */}
                <span className="hidden sm:inline-block group relative">
                  <span className="w-1.5 h-1.5 rounded-full bg-white/30 inline-block" />
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[180px] opacity-0 group-hover:opacity-100 transition-opacity z-50">
                    <span className="block rounded-lg bg-foreground text-background text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40 text-center">
                      Complete setup to go live in the marketplace
                    </span>
                  </span>
                </span>
                <span className="sm:hidden w-1.5 h-1.5 rounded-full bg-white/30" />
                {activeTab === "getting_started" && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-foreground rounded-t" />
                )}
              </button>
            )}
          </div>

          {/* Tab-specific right-rail actions */}
          <div className="flex items-center gap-1 pr-2">
            {activeTab === "notifications" && unreadCount > 0 && (
              <div className="group relative flex items-center">
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[#f5f5f7]/70 hover:text-white hover:bg-white/[0.08] transition-colors"
                  title="Mark all notifications as read"
                  aria-label="Mark all notifications as read"
                >
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                  <span className="text-[9px] font-bold uppercase tracking-wider hidden sm:inline">
                    Read
                  </span>
                </button>
                <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-[180px] z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="block rounded-lg bg-foreground text-background text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40">
                    Marks every notification as read. Items stay in the list — only the unread dot disappears.
                  </span>
                </span>
              </div>
            )}

            <div className="group relative flex items-center">
              <Info className="w-3 h-3 text-foreground/25 hover:text-foreground/50 cursor-help transition-colors" />
              <span className="pointer-events-none absolute top-full right-0 mt-1.5 w-[220px] z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="block rounded-lg bg-foreground text-background text-[10.5px] font-medium px-2.5 py-1.5 leading-snug shadow-xl shadow-black/40">
                  <span className="block font-bold mb-0.5">
                    {activeTab === "notifications"
                      ? "Notifications"
                      : "Getting Started"}
                  </span>
                  {activeTab === "notifications"
                    ? "Live updates about your orders, payments, and chats. Tap any item to open it."
                    : "A short checklist to finish your setup. It disappears once you're live."}
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ── Getting Started Tab ─────────────────────────── */}
        {activeTab === "getting_started" && onboardingNeedsAttention && (
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1.5">
            <OnboardingSetupCard
              onOpenPaymentMethods={onOpenPaymentMethods}
              onOpenSettings={onOpenSettings}
            />
          </div>
        )}

        {/* ── Notifications Tab ───────────────────────────── */}
        {activeTab === "notifications" && (
        <div className="flex-1 min-h-0 overflow-y-auto py-3 px-4 space-y-3">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-foreground/15">
              <div className="w-12 h-12 rounded-full bg-foreground/[0.03] border border-foreground/[0.06] flex items-center justify-center mb-3">
                <Bell className="w-5 h-5 opacity-40" />
              </div>
              <p className="text-[11px] font-medium text-foreground/40">All caught up</p>
              <p className="text-[10px] text-foreground/25 mt-0.5">New events will appear here</p>
            </div>
          ) : (
            <>
            {groupedNotifications.slice(0, visibleCount).map((group) => {
              const notif = group.latest;
              const hasUnread = group.ids.some((id) => notifications.find((n) => n.id === id && !n.read));
              const style = getStyle(notif.type);

              return (
                <button
                  key={group.ids[0]}
                  onClick={() => {
                    group.ids.forEach((id) => onMarkRead(id));
                    if (notif.orderId) {
                      // Sentinel orderIds (prefixed with __) are virtual
                      // actions, not real orders. They dispatch a window
                      // event that a feature-specific bridge listens for —
                      // currently used by the onboarding flow to reopen its
                      // overlay when the "Setup incomplete" notification
                      // is tapped.
                      if (notif.orderId.startsWith('__')) {
                        if (notif.orderId === '__onboarding_resume__') {
                          window.dispatchEvent(new Event('onboarding:resume-requested'));
                        }
                        return;
                      }
                      if (notif.type === 'message' && onOpenChat) {
                        onOpenChat(notif.orderId);
                      } else {
                        onSelectOrder(notif.orderId);
                      }
                    }
                  }}
                  className={`group relative w-full text-left p-2.5 rounded-xl border overflow-hidden transition-all ${
                    hasUnread
                      ? 'bg-white/[0.055] border-white/[0.12] hover:border-white/20'
                      : 'bg-foreground/[0.015] border-foreground/[0.05] hover:border-foreground/[0.10] opacity-70 hover:opacity-100'
                  }`}
                >
                  {/* Unread accent stripe */}
                  {hasUnread && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-white/30 rounded-r" />
                  )}

                  <div className="flex items-start gap-3">
                    {/* Type icon — no badge, just a crisp colored glyph in front */}
                    <div className="relative w-5 h-5 flex items-center justify-center shrink-0 mt-[1px]">
                      {notif.type === 'order' && <ShoppingBag className={`w-5 h-5 ${style.icon}`} strokeWidth={2.4} />}
                      {notif.type === 'escrow' && <Shield className={`w-5 h-5 ${style.icon}`} strokeWidth={2.4} />}
                      {notif.type === 'payment' && <DollarSign className={`w-5 h-5 ${style.icon}`} strokeWidth={2.4} />}
                      {notif.type === 'dispute' && <AlertTriangle className={`w-5 h-5 ${style.icon}`} strokeWidth={2.4} />}
                      {notif.type === 'complete' && <CheckCircle2 className={`w-5 h-5 ${style.icon}`} strokeWidth={2.4} />}
                      {notif.type === 'message' && <MessageCircle className={`w-5 h-5 ${style.icon}`} strokeWidth={2.4} />}
                      {notif.type === 'system' && <Bell className={`w-5 h-5 ${style.icon}`} strokeWidth={2.4} />}

                      {/* Group count badge — shows UNREAD count, not total.
                          Without this the badge keeps growing forever as old
                          read notifications stay in the list and get counted
                          alongside fresh ones (the "5d ago" group inflation
                          bug). */}
                      {group.unreadCount > 1 && (
                        <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 bg-foreground text-background text-[9px] font-extrabold rounded-full flex items-center justify-center ring-2 ring-background tabular-nums">
                          {group.unreadCount > 9 ? '9+' : group.unreadCount}
                        </span>
                      )}
                    </div>

                    {/* Content column */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2 mb-0.5">
                        <p className={`text-[13px] leading-snug line-clamp-2 ${
                          hasUnread ? 'text-foreground font-semibold' : 'text-foreground/55 font-normal'
                        }`}>
                          {notif.message}
                        </p>
                        <span className={`text-[10px] font-mono tabular-nums shrink-0 ${
                          hasUnread ? 'text-white/60' : 'text-foreground/25'
                        }`}>
                          {relativeTime(notif.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Unread dot */}
                    {hasUnread && (
                      <div className="w-2 h-2 rounded-full bg-[#f5f5f7] shrink-0 mt-1.5" />
                    )}
                  </div>
                </button>
              );
            })}
            {groupedNotifications.length > visibleCount && (
              <button
                onClick={() => setVisibleCount((v) => v + 20)}
                className="w-full py-3 text-[12px] font-medium text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                Load more ({groupedNotifications.length - visibleCount} remaining)
              </button>
            )}
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
});
