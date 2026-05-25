"use client";

import { memo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";

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
      <svg
        viewBox="0 0 70 60"
        className="h-[20px] w-auto"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M4 36 L16 36 L25 8 L38 52 L47 28 L66 28"
          className={onDark ? "stroke-white" : "stroke-black dark:stroke-white"}
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <motion.span
        className={`${className} text-[20px] font-semibold tracking-tight leading-none flex items-center`}
        whileHover={{ scale: 1.02 }}
        transition={{ duration: 0.2 }}
      >
        <span className={onDark ? "text-white" : "text-black dark:text-white"}>
          Blip
        </span>
        <span
          className={`relative ml-1 italic ${onDark ? "text-white" : "text-black dark:text-white"}`}
        >
          money
        </span>
      </motion.span>
    </Link>
  );
});
