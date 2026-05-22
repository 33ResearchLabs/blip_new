import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'BlipScan - Solana P2P Escrow Explorer',
  description: 'Blockchain explorer for Blip Market P2P escrow protocol on Solana',
};

// Force dynamic rendering for every route under this layout, so the
// HTML response is NOT cached at the Next.js / Railway edge layer with
// `Cache-Control: s-maxage=31536000`. That long-lived edge cache was
// pinning the HTML — and therefore the JS chunk hashes it references —
// to whatever was first served after a deploy. End result: browsers
// that visited blipscan before a deploy kept serving the old chunk
// from disk cache and never picked up shipped fixes (e.g. the
// sparkline rework in PR #70) without a manual Cmd+Shift+R.
//
// Blipscan is a read-mostly explorer with a tiny per-page render cost,
// so paying for a server render per request is cheap relative to the
// "users see stale fixes after every deploy" problem it solves.
// `_next/static/` chunks remain `immutable` — only the HTML shell goes
// uncached.
export const dynamic = 'force-dynamic';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var theme = localStorage.getItem('blipscan-theme');
                if (theme === 'light') {
                  document.documentElement.classList.add('light');
                }
              } catch(e) {}
            })();
          `,
        }} />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  );
}
