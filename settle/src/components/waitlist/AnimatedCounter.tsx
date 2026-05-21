'use client';

import { useEffect, useState } from 'react';
import { formatCount } from '@/lib/format';

// Count-up animation for the points hero. Animates from 0 (or `start`) to
// `value` over `duration` ms. Pure CSS would jitter on slow renders, so we
// step the number via rAF.

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  start?: number;
  className?: string;
}

export function AnimatedCounter({ value, duration = 1200, start = 0, className }: AnimatedCounterProps) {
  const [n, setN] = useState(start);

  useEffect(() => {
    let raf = 0;
    const begin = performance.now();
    function step(now: number) {
      const t = Math.min((now - begin) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(start + (value - start) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, start]);

  return <span className={className}>{formatCount(n)}</span>;
}
