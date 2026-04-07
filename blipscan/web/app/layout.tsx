import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'BlipScan - Solana P2P Escrow Explorer',
  description: 'Blockchain explorer for Blip Money P2P escrow protocol on Solana',
};

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
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
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
