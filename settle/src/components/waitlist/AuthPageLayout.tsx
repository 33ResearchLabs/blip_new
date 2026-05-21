'use client';

// Ported from futureStick's blip-protocol-ui/src/components/auth/AuthPageLayout.tsx.
// Two-column layout: AuthCardStack (phone-frame visual) on the left, form on the right.
// Below large screens the visual collapses, leaving a centered form column.

import { motion } from 'framer-motion';
import AuthCardStack from './AuthCardStack';

interface AuthPageLayoutProps {
  children: React.ReactNode;
  badge?: string;
  heading?: string;
  description?: string;
  variant?: 'merchant' | 'user';
  bottomContent?: React.ReactNode;
}

export default function AuthPageLayout({
  children, badge, heading, description, variant = 'user', bottomContent,
}: AuthPageLayoutProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="max-w-7xl mx-auto"
    >
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-6 lg:gap-0 py-4 lg:py-6">
        {/* LEFT: card visual (hidden below lg) */}
        <div className="hidden lg:flex flex-1 flex-col items-start justify-center overflow-hidden pl-4">
          <AuthCardStack variant={variant} className="self-center" />
        </div>

        {/* Divider */}
        <div className="hidden lg:block w-px bg-black/[0.08] dark:bg-white/[0.08]" />

        {/* RIGHT: form side */}
        <div className="flex-1 w-full max-w-md mx-auto lg:mx-0 lg:pl-12 flex flex-col justify-center">
          {badge && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-3 border border-black/10 dark:border-white/10 w-fit"
            >
              <span className="text-[11px] font-semibold text-gray-600 dark:text-white uppercase tracking-wider">{badge}</span>
            </motion.div>
          )}
          {heading && (
            <h2 className="text-2xl md:text-[28px] font-bold text-black dark:text-white mb-2 leading-tight">{heading}</h2>
          )}
          {description && (
            <p className="text-sm text-black/50 dark:text-white/50 mb-5">{description}</p>
          )}
          {children}
        </div>
      </div>

      {bottomContent}
    </motion.div>
  );
}
