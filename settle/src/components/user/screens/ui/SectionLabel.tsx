import type { HTMLAttributes, ReactNode } from "react";

interface SectionLabelProps extends HTMLAttributes<HTMLParagraphElement> {
  children?: ReactNode;
  className?: string;
}

/**
 * SectionLabel — uppercase overline used as section/card headings.
 * Maps to the design-system `sectionLabel` / `cardLabel` styles.
 * Tokenized: `text-text-tertiary` swaps automatically when light mode lands.
 */
export const SectionLabel = ({ className = "", children, ...rest }: SectionLabelProps) => (
  <p
    className={`text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase ${className}`}
    {...rest}
  >
    {children}
  </p>
);

/**
 * CardLabel — visually identical to SectionLabel today, but kept as a
 * separate component so they can diverge if light mode introduces
 * different on-card vs on-page hierarchy.
 */
export const CardLabel = ({ className = "", children, ...rest }: SectionLabelProps) => (
  <p
    className={`text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase ${className}`}
    {...rest}
  >
    {children}
  </p>
);
