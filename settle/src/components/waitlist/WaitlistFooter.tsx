'use client';

// Slim brand footer that sits on every /waitlist/* page (auth + dashboard).
// Mounted by app/waitlist/layout.tsx so individual pages don't have to
// include it. Reads the waitlist theme so it tints correctly in both
// light and dark modes — uses inline colors to dodge the global
// text-* / bg-* remaps in globals.css.

import { Activity } from 'lucide-react';
import { useWaitlistTokens } from '@/context/WaitlistThemeContext';

export default function WaitlistFooter() {
  const t = useWaitlistTokens();
  const textColor = t.d ? 'rgba(255,255,255,0.55)' : 'rgba(29,29,31,0.55)';
  const borderColor = t.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  return (
    <footer
      className={`w-full ${t.bg}`}
      style={{ borderTop: `1px solid ${borderColor}` }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-4">
        <span
          className="text-[10.5px] font-semibold tracking-[0.18em] uppercase"
          style={{ color: textColor }}
        >
          © 2026 BLIP.MONEY
        </span>
        <span
          className="inline-flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.18em] uppercase"
          style={{ color: textColor }}
        >
          <Activity className="w-3 h-3" strokeWidth={2.5} />
          FAST. SIMPLE. BLIP.
        </span>
      </div>
    </footer>
  );
}
