import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Settle Merchant",
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
  themeColor: "#c9a962",
};

export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
