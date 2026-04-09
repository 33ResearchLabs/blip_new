import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { PusherProvider } from "@/context/PusherContext";
import { WebSocketChatProvider } from "@/context/WebSocketChatContext";
import { ModalProvider } from "@/context/ModalContext";
import ClientWalletProvider from "@/components/ClientWalletProvider";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
        <link rel="apple-touch-icon" href="/icons/icon.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
        <ThemeProvider>
          <ClientWalletProvider>
            <PusherProvider>
              <WebSocketChatProvider>
                <ModalProvider>
                  <AppProvider>
                    {children}
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
