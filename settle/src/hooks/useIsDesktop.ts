"use client";

import { useState, useEffect } from "react";

const DESKTOP_BREAKPOINT = 1024;

/**
 * Returns true when the viewport is wide enough to render the desktop layout.
 * Defaults to false (mobile) so the phone layout shows on first paint.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    check();
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    mq.addEventListener("change", check);
    return () => mq.removeEventListener("change", check);
  }, []);

  return isDesktop;
}
