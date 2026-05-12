import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
// Wallet-adapter UI styles — imported EAGERLY at the root layout so they
// bundle into the main page CSS instead of being split into a runtime
// chunk that Turbopack's dynamic-import async-loader has to fetch on
// demand. The async-loader path was failing under Turbopack with
// `ChunkLoadError: Failed to load chunk solana_wallet-adapter-react-ui_*.css`
// because the CSS contains an `@import "https://fonts.googleapis.com/..."`
// that the runtime loader couldn't resolve through our CSP. Importing
// here makes it part of the initial CSS bundle and bypasses the loader
// entirely. (The duplicate import inside SolanaWalletContext is left in
// place for forward-compat; the build deduplicates the module.)
import "@solana/wallet-adapter-react-ui/styles.css";
import { AppProvider } from "@/context/AppContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { PusherProvider } from "@/context/PusherContext";
import { WebSocketChatProvider } from "@/context/WebSocketChatContext";
import { ModalProvider } from "@/context/ModalContext";
import { AppLockProvider } from "@/context/AppLockContext";
import ClientWalletProvider from "@/components/ClientWalletProvider";
import ErrorTrackingBoot from "@/components/ErrorTrackingBoot";
import { AppLockOverlay } from "@/components/app-lock/AppLockOverlay";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Blip Money",
  description: "P2P settlement. Send crypto to anyone.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Blip Money",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

// Script to prevent theme flash - runs before React hydrates
const themeScript = `
  (function() {
    try {
      var theme = localStorage.getItem('theme');
      var lightThemes = ['light', 'clean'];
      var bgMap = {
        light: '#FDF6E3', clean: '#FFFFFF', navy: '#0B1120',
        emerald: '#050705', orchid: '#1A1A2E', gold: '#1C1C1C', dark: '#060606'
      };
      if (theme && theme !== 'dark') {
        document.documentElement.setAttribute('data-theme', theme);
        if (lightThemes.indexOf(theme) !== -1) {
          document.documentElement.classList.add('light');
        }
      }
      var bg = bgMap[theme || 'dark'] || '#060606';
      document.documentElement.style.backgroundColor = bg;
    } catch (e) {}
  })();
`;

// Service worker DISABLED - just cleanup, no registration
const swScript = `
  (async function() {
    try {
      if ('serviceWorker' in navigator) {
        var regs = await navigator.serviceWorker.getRegistrations();
        for (var i = 0; i < regs.length; i++) { await regs[i].unregister(); }
      }
      if ('caches' in window) {
        var keys = await caches.keys();
        for (var j = 0; j < keys.length; j++) { await caches.delete(keys[j]); }
      }
    } catch(e) {}
  })();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-request CSP nonce, set by middleware in `x-nonce`. The two inline
  // <script> blocks below MUST carry it or the browser will block them under
  // the strict (no 'unsafe-inline') script-src.
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Convention so client libs (Vite/webpack chunk preloaders, etc.)
            can locate the nonce via `meta[property="csp-nonce"]`. */}
        {nonce && <meta property="csp-nonce" content={nonce} />}
        {/* suppressHydrationWarning: modern browsers strip the `nonce`
            attribute from the DOM after the CSP check, so React always
            sees a server/client mismatch on these inline scripts. The
            CSP enforcement happens at HTML-parse time and is unaffected. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: themeScript }}
          suppressHydrationWarning
        />
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: swScript }}
          suppressHydrationWarning
        />
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`} suppressHydrationWarning>
        <ErrorTrackingBoot />
        <ThemeProvider>
          <ClientWalletProvider>
            <PusherProvider>
              <WebSocketChatProvider>
                <ModalProvider>
                  <AppProvider>
                    {/* AppLockProvider sits innermost so it can read auth
                        state and render its lock overlay on top of the
                        app content via AppLockOverlay. The overlay is a
                        sibling of {children} so route changes never
                        unmount it. */}
                    <AppLockProvider>
                      {children}
                      <AppLockOverlay />
                    </AppLockProvider>
                  </AppProvider>
                </ModalProvider>
              </WebSocketChatProvider>
            </PusherProvider>
          </ClientWalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
