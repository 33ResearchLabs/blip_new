"use client";

import { motion } from "framer-motion";
import AuthCardStack from "./AuthCardStack";
import { RewardCards } from "./RewardCards";

interface AuthPageLayoutProps {
  children: React.ReactNode;
  badge?: string;
  heading?: string;
  description?: string;
  variant?: "merchant" | "user";
  bottomContent?: React.ReactNode;
}

export default function AuthPageLayout({
  children,
  badge,
  heading,
  description,
  variant = "user",
  bottomContent,
}: AuthPageLayoutProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="max-w-7xl mx-auto"
    >
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-8 lg:gap-0 py-10 lg:py-20">
        {/* LEFT: Card visual + tagline (hidden below lg) */}
        <div className="hidden lg:flex flex-1 flex-col items-start justify-center overflow-hidden pl-4">
          <AuthCardStack variant={variant} className="self-center" />
          <RewardCards />
        </div>

        {/* Divider line between card and form (hidden below lg).
            NOTE: this app uses `data-theme="<name>"` + an optional `.light`
            class — it never adds Tailwind's `.dark` class. So `dark:` modifiers
            silently break on themes like navy/emerald/orchid/gold. Use the
            semantic `foreground` / `border` tokens that all themes wire up. */}
        <div className="hidden lg:block w-px bg-foreground/[0.08]" />

        {/* RIGHT: Form side */}
        <div className="flex-1 w-full max-w-md mx-auto lg:mx-0 lg:pl-12 flex flex-col justify-center">
          {badge && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 border border-foreground/10"
            >
              <span className="text-[11px] font-semibold text-foreground/60 uppercase tracking-wider">
                {badge}
              </span>
            </motion.div>
          )}

          {heading && (
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
              {heading}
            </h2>
          )}

          {description && (
            <p className="text-foreground/50 mb-10">
              {description}
            </p>
          )}

          {children}
        </div>
      </div>

      {/* Optional bottom content (feature grids, etc.) */}
      {bottomContent}
    </motion.div>
  );
}
