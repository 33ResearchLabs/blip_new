"use client";

import { memo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { BlipLogo } from "@/components/shared/BlipLogo";

interface LogoProps {
  href?: string;
  className?: string;
  onDark?: boolean;
  ariaLabel?: string;
  onClick?: () => void;
}

export const Logo = memo(function Logo({
  href = "/",
  className = "",
  onDark = false,
  ariaLabel = "Blip Market home",
  onClick,
}: LogoProps) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex items-center gap-1.5 group no-underline hover:no-underline"
    >
      {/* SVG + text dimensions match futureStick Navbar.tsx Logo:
            - SVG: h-[17px] (was 20px — 3px too tall)
            - Text: 22px / fontWeight 700 / letterSpacing -0.045em
            - flex items-baseline so the lightning bolt aligns with the
              text baseline rather than its center.
          "money" stays italic, fontWeight 600. */}
      <BlipLogo priority />

      <motion.span
        className={`${className} text-[19px] leading-none flex items-baseline`}
        style={{ letterSpacing: "-0.04em", fontWeight: 700 }}
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.2 }}
      >
        <span
          className={onDark ? undefined : "text-foreground"}
          style={onDark ? { color: "#ffffff" } : undefined}
        >
          Blip
        </span>
        <span
          style={{
            fontWeight: 600,
            letterSpacing: "-0.04em",
            color: "#10b981",
            fontStyle: "italic",
          }}
          className="ml-1"
        >
          Market
        </span>
      </motion.span>
    </Link>
  );
});
