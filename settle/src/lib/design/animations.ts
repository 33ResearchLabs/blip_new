/**
 * Apple-Inspired Animation System
 *
 * Precise easing curves and timing constants based on Apple's design language.
 * All animations target 60fps performance using transform and opacity only.
 */

// ==========================================
// EASING CURVES
// ==========================================

/**
 * Apple's standard easing curves
 * Use these for consistent, polished motion throughout the app
 */
export const easings = {
  /**
   * Standard - Default easing for most transitions
   * Smooth acceleration and deceleration
   */
  standard: [0.4, 0.0, 0.2, 1] as const,

  /**
   * Decelerate - For enter animations
   * Starts fast, ends slow (element settling into place)
   */
  decelerate: [0.0, 0.0, 0.2, 1] as const,

  /**
   * Accelerate - For exit animations
   * Starts slow, ends fast (element leaving quickly)
   */
  accelerate: [0.4, 0.0, 1, 1] as const,

  /**
   * Sharp - For snappy, responsive interactions
   * Quick transitions for immediate feedback
   */
  sharp: [0.4, 0.0, 0.6, 1] as const,

  /**
   * Smooth - For very fluid, elegant motion
   * Use sparingly for hero animations
   */
  smooth: [0.25, 0.1, 0.25, 1] as const,
} as const;

// ==========================================
// DURATION CONSTANTS
// ==========================================

/**
 * Standard duration values in milliseconds
 * Consistent timing across all animations
 */
export const durations = {
  /** Instant - 100ms - For immediate feedback (button press) */
  instant: 100,

  /** Fast - 200ms - For quick transitions (hover states) */
  fast: 200,

  /** Normal - 300ms - Default for most animations */
  normal: 300,

  /** Slow - 400ms - For emphasized transitions */
  slow: 400,

  /** Slowest - 600ms - For complex, choreographed animations */
  slowest: 600,
} as const;

// ==========================================
// FRAMER MOTION VARIANTS
// ==========================================

/**
 * Fade In - Simple opacity transition
 * Use for: Modal overlays, tooltips, notifications
 */
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: {
    duration: durations.normal / 1000,
    ease: easings.standard,
  },
};

/**
 * Slide Up - Element enters from below
 * Use for: Modals, bottom sheets, mobile nav
 */
export const slideUp = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -20, opacity: 0 },
  transition: {
    duration: durations.normal / 1000,
    ease: easings.decelerate,
  },
};

/**
 * Slide Down - Element enters from above
 * Use for: Dropdowns, notifications
 */
export const slideDown = {
  initial: { y: -20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: 20, opacity: 0 },
  transition: {
    duration: durations.normal / 1000,
    ease: easings.decelerate,
  },
};

/**
 * Scale In - Element scales up from center
 * Use for: Modals, popovers, quick actions
 */
export const scaleIn = {
  initial: { scale: 0.96, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.96, opacity: 0 },
  transition: {
    duration: durations.fast / 1000,
    ease: easings.standard,
  },
};

/**
 * Slide In Right - Element enters from right
 * Use for: Side panels, drawer navigation
 */
export const slideInRight = {
  initial: { x: 20, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 20, opacity: 0 },
  transition: {
    duration: durations.normal / 1000,
    ease: easings.decelerate,
  },
};

/**
 * Slide In Left - Element enters from left
 * Use for: Side panels, previous page transitions
 */
export const slideInLeft = {
  initial: { x: -20, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: -20, opacity: 0 },
  transition: {
    duration: durations.normal / 1000,
    ease: easings.decelerate,
  },
};

// ==========================================
// INTERACTION PRESETS
// ==========================================

/**
 * Button Press - Subtle scale on tap
 * Apply with whileTap in Framer Motion
 */
export const buttonPress = {
  scale: 0.98,
  transition: {
    duration: durations.instant / 1000,
    ease: easings.sharp,
  },
};

/**
 * Card Hover - Lift on hover
 * Apply with whileHover in Framer Motion
 */
export const cardHover = {
  y: -2,
  transition: {
    duration: durations.fast / 1000,
    ease: easings.standard,
  },
};

/**
 * Card Tap - Quick press feedback
 * Apply with whileTap in Framer Motion
 */
export const cardTap = {
  scale: 0.98,
  transition: {
    duration: durations.instant / 1000,
    ease: easings.sharp,
  },
};

// ==========================================
// STAGGER CONFIGURATIONS
// ==========================================

/**
 * Stagger Children - For animating lists
 * Use with Framer Motion's staggerChildren
 */
export const stagger = {
  /** Fast stagger - 50ms between items */
  fast: {
    staggerChildren: 0.05,
    delayChildren: 0,
  },

  /** Normal stagger - 100ms between items */
  normal: {
    staggerChildren: 0.1,
    delayChildren: 0,
  },

  /** Slow stagger - 150ms between items */
  slow: {
    staggerChildren: 0.15,
    delayChildren: 0.1,
  },
};

// ==========================================
// LAYOUT ANIMATIONS
// ==========================================

/**
 * Layout Transition - For shared element transitions
 * Use with layout prop in Framer Motion
 */
export const layoutTransition = {
  type: "spring" as const,
  stiffness: 300,
  damping: 30,
};

/**
 * Spring Transition - Natural, bouncy feel
 * Use sparingly for playful interactions
 */
export const springTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 25,
  mass: 0.5,
};

// ==========================================
// PAGE TRANSITIONS
// ==========================================

/**
 * Page Enter/Exit - For route changes
 */
export const pageTransition = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: {
    duration: durations.normal / 1000,
    ease: easings.standard,
  },
};

/**
 * Modal Enter/Exit - For overlays
 */
export const modalTransition = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: {
    duration: durations.fast / 1000,
    ease: easings.standard,
  },
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Create a custom transition with Apple easing
 * @param duration - Duration in milliseconds
 * @param easing - Easing curve (default: standard)
 */
export function createTransition(
  duration: number = durations.normal,
  easing: typeof easings[keyof typeof easings] = easings.standard
) {
  return {
    duration: duration / 1000,
    ease: easing,
  };
}

/**
 * Create a staggered animation variant
 * @param staggerDelay - Delay between children in seconds
 * @param delayChildren - Initial delay before first child
 */
export function createStagger(staggerDelay: number = 0.1, delayChildren: number = 0) {
  return {
    staggerChildren: staggerDelay,
    delayChildren,
  };
}
