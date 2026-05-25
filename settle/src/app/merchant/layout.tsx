import type { Metadata, Viewport } from "next";
import { MerchantErrorBoundary } from "./error-boundary";
import { IssueReporter } from "@/components/IssueReporter";
import { MerchantPresenceHeartbeat } from "@/components/merchant/MerchantPresenceHeartbeat";
import { PwaAppGuard } from "@/components/PwaAppGuard";

export const metadata: Metadata = {
  title: "Blip Money Merchant",
  description: "Manage your P2P trades and orders",
  manifest: "/manifest-merchant.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Merchant",
    startupImage: [
      {
        url: "/splash/merchant-splash.png",
        media: "(device-width: 375px) and (device-height: 812px)",
      },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#060606",
};

export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MerchantErrorBoundary>
      {/* Mount the presence heartbeat at the layout level so every
          merchant route (dashboard, wallet, settings, my-issues, …)
          keeps last_seen_at fresh. Previously only /merchant fired
          heartbeats, so a merchant sitting on a sub-page looked
          permanently offline in the admin Compliance table. */}
      <MerchantPresenceHeartbeat />
      {/* Block the User PWA from accessing /merchant routes. No-ops in
          regular browsers and in the Merchant PWA. */}
      <PwaAppGuard expected="merchant" />
      {children}
      {/* Floating trigger hidden — the navbar bug icon (MerchantNavbar)
          owns the entry point on merchant pages, so the floating amber
          button is just duplicate visual noise. The reporter modal stays
          mounted; the navbar opens it via openIssueReporter(). */}
      <IssueReporter hideTrigger />
    </MerchantErrorBoundary>
  );
}
