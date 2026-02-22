/**
 * Apple-Inspired Typography System
 *
 * Type scale and typography utilities based on Apple's SF Pro typography system.
 * Adapted for web with Geist Sans font family.
 */

// ==========================================
// TYPE SCALE CONSTANTS
// ==========================================

/**
 * Complete typography scale matching Apple's design language
 * All sizes include font-size, line-height, letter-spacing, and weight
 */
export const typography = {
  /**
   * Display - Largest text for hero sections
   * 64-96px responsive, very tight leading
   */
  display: {
    fontSize: 'clamp(48px, 8vw, 96px)',
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
    fontWeight: 700,
  },

  /**
   * Large Title - Page-level headers
   * 34px, tight leading for impact
   */
  largeTitle: {
    fontSize: '34px',
    lineHeight: 1.1,
    letterSpacing: '-0.015em',
    fontWeight: 700,
  },

  /**
   * Title 1 - Major section headers
   * 28px, balanced proportions
   */
  title1: {
    fontSize: '28px',
    lineHeight: 1.15,
    letterSpacing: '-0.012em',
    fontWeight: 700,
  },

  /**
   * Title 2 - Subsection headers
   * 24px, slightly tighter
   */
  title2: {
    fontSize: '24px',
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
    fontWeight: 600,
  },

  /**
   * Headline - Card titles, prominent labels
   * 22px, medium weight
   */
  headline: {
    fontSize: '22px',
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
    fontWeight: 600,
  },

  /**
   * Body - Standard reading text
   * 17px, optimized for readability
   */
  body: {
    fontSize: '17px',
    lineHeight: 1.47,
    letterSpacing: '-0.005em',
    fontWeight: 400,
  },

  /**
   * Callout - Emphasized body text
   * 16px, slightly tighter leading
   */
  callout: {
    fontSize: '16px',
    lineHeight: 1.4,
    letterSpacing: '-0.003em',
    fontWeight: 400,
  },

  /**
   * Subhead - Secondary descriptive text
   * 15px, comfortable reading
   */
  subhead: {
    fontSize: '15px',
    lineHeight: 1.35,
    letterSpacing: '-0.002em',
    fontWeight: 400,
  },

  /**
   * Footnote - Captions and annotations
   * 13px, neutral spacing
   */
  footnote: {
    fontSize: '13px',
    lineHeight: 1.4,
    letterSpacing: '0',
    fontWeight: 400,
  },

  /**
   * Caption 1 - Small supporting text
   * 12px, slightly wider spacing
   */
  caption1: {
    fontSize: '12px',
    lineHeight: 1.3,
    letterSpacing: '0.01em',
    fontWeight: 400,
  },

  /**
   * Caption 2 - Smallest text, labels
   * 11px, wide spacing, uppercase
   */
  caption2: {
    fontSize: '11px',
    lineHeight: 1.3,
    letterSpacing: '0.06em',
    fontWeight: 400,
    textTransform: 'uppercase' as const,
  },
} as const;

// ==========================================
// FONT WEIGHTS
// ==========================================

/**
 * Standard font weight values
 * Apple uses specific weights for hierarchy
 */
export const fontWeights = {
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
} as const;

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Generate CSS properties object from typography constant
 * @param style - Typography style from the typography object
 * @returns CSS properties object
 */
export function getTypographyStyles(style: keyof typeof typography) {
  return typography[style];
}

/**
 * Generate className string for typography style
 * Matches the CSS classes defined in globals.css
 * @param style - Typography style name
 * @returns className string
 */
export function getTypographyClassName(style: keyof typeof typography): string {
  const classNameMap: Record<keyof typeof typography, string> = {
    display: 'text-display',
    largeTitle: 'text-large-title',
    title1: 'text-title-1',
    title2: 'text-title-2',
    headline: 'text-headline',
    body: 'text-body',
    callout: 'text-callout',
    subhead: 'text-subhead',
    footnote: 'text-footnote',
    caption1: 'text-caption-1',
    caption2: 'text-caption-2',
  };

  return classNameMap[style];
}

/**
 * Create custom typography style
 * @param fontSize - Font size (string or number in px)
 * @param lineHeight - Line height multiplier
 * @param letterSpacing - Letter spacing in em
 * @param fontWeight - Font weight
 */
export function createTypographyStyle(
  fontSize: string | number,
  lineHeight: number = 1.5,
  letterSpacing: string = '0',
  fontWeight: number = 400
) {
  return {
    fontSize: typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
    lineHeight,
    letterSpacing,
    fontWeight,
  };
}

// ==========================================
// TEXT OPACITY LEVELS
// ==========================================

/**
 * Apple's text opacity hierarchy
 * Use these for creating visual hierarchy with white text on dark backgrounds
 */
export const textOpacity = {
  /** Primary - Most important text, 100% */
  primary: 1.0,

  /** Secondary - Supporting text, 70% */
  secondary: 0.7,

  /** Tertiary - De-emphasized text, 50% */
  tertiary: 0.5,

  /** Quaternary - Disabled or placeholder text, 30% */
  quaternary: 0.3,

  /** Disabled - Completely disabled state, 20% */
  disabled: 0.2,
} as const;

// ==========================================
// RESPONSIVE TYPOGRAPHY
// ==========================================

/**
 * Fluid typography scale for responsive designs
 * Uses clamp() for smooth scaling between breakpoints
 */
export const fluidTypography = {
  display: {
    fontSize: 'clamp(48px, 8vw, 96px)',
    lineHeight: 1.05,
    letterSpacing: '-0.02em',
  },
  largeTitle: {
    fontSize: 'clamp(28px, 5vw, 34px)',
    lineHeight: 1.1,
    letterSpacing: '-0.015em',
  },
  title: {
    fontSize: 'clamp(22px, 3.5vw, 28px)',
    lineHeight: 1.15,
    letterSpacing: '-0.012em',
  },
  headline: {
    fontSize: 'clamp(18px, 2.5vw, 22px)',
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
  },
  body: {
    fontSize: 'clamp(15px, 2vw, 17px)',
    lineHeight: 1.47,
    letterSpacing: '-0.005em',
  },
} as const;

// ==========================================
// UTILITY CLASSES GENERATOR
// ==========================================

/**
 * Generate inline styles from typography constant
 * Useful for dynamic styling in components
 */
export function typographyToStyle(style: keyof typeof typography): React.CSSProperties {
  const typo = typography[style];
  const result: React.CSSProperties = {
    fontSize: typo.fontSize,
    lineHeight: typo.lineHeight,
    letterSpacing: typo.letterSpacing,
    fontWeight: typo.fontWeight,
  };
  if ('textTransform' in typo) {
    result.textTransform = (typo as typeof typography.caption2).textTransform;
  }
  return result;
}
