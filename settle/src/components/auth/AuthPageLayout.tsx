"use client";

import { motion } from "framer-motion";
import AuthCardStack from "./AuthCardStack";

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
        </div>

        {/* Divider line between card and form (hidden below lg) */}
        <div className="hidden lg:block w-px bg-black/[0.08] dark:bg-white/[0.08]" />

        {/* RIGHT: Form side */}
        <div className="flex-1 w-full max-w-md mx-auto lg:mx-0 lg:pl-12 flex flex-col justify-center">
          {badge && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6 border border-black/10 dark:border-white/10"
            >
              <span className="text-[11px] font-semibold text-gray-600 dark:text-white uppercase tracking-wider">
                {badge}
              </span>
            </motion.div>
          )}

          {heading && (
            <h2 className="text-3xl md:text-4xl font-bold text-black dark:text-white mb-3">
              {heading}
            </h2>
          )}

          {description && (
            <p className="text-black/50 dark:text-white/50 mb-10">
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
