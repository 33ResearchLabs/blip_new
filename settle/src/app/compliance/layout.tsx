import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Blip Money Compliance",
  description: "Dispute resolution and compliance management",
  manifest: "/manifest-compliance.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Compliance",
    startupImage: [
      {
        url: "/splash/compliance-splash.png",
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
  themeColor: "#f97316",
};

export default function ComplianceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
