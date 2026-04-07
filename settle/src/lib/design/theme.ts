// ─── Premium Dark-First Design System ────────────────────────────────────
// Inspired by Stripe, Revolut, Coinbase
// Consistent across all user screens

export const colors = {
  // Background hierarchy
  bg: {
    primary:   '#0B0F14',    // main app background
    secondary: '#111827',    // card background
    tertiary:  '#1F2937',    // elevated / hover
    elevated:  '#374151',    // inputs, active states
  },

  // Accent — monochrome white (matches dark-glass theme)
  accent: {
    primary:   '#FFFFFF',    // white — primary CTA
    bright:    'rgba(255,255,255,0.85)',  // hover
    dim:       'rgba(255,255,255,0.70)',  // pressed
    subtle:    'rgba(255,255,255,0.06)',  // tinted bg
    glow:      'rgba(255,255,255,0.08)',  // glow effect
    border:    'rgba(255,255,255,0.15)',  // accent border
    text:      '#0B0F14',   // dark text on white CTA
  },

  // Semantic
  success:     '#10B981',
  successDim:  'rgba(16,185,129,0.12)',
  successBorder: 'rgba(16,185,129,0.25)',
  warning:     '#F59E0B',
  warningDim:  'rgba(245,158,11,0.12)',
  warningBorder: 'rgba(245,158,11,0.25)',
  error:       '#EF4444',
  errorDim:    'rgba(239,68,68,0.10)',
  errorBorder: 'rgba(239,68,68,0.20)',
  info:        '#60A5FA',

  // Text
  text: {
    primary:    'rgba(255,255,255,0.92)',
    secondary:  'rgba(255,255,255,0.55)',
    tertiary:   'rgba(255,255,255,0.30)',
    quaternary: 'rgba(255,255,255,0.15)',
    inverse:    '#0B0F14',
  },

  // Borders
  border: {
    subtle:  'rgba(255,255,255,0.06)',
    medium:  'rgba(255,255,255,0.10)',
    strong:  'rgba(255,255,255,0.16)',
  },

  // Surfaces (for glass cards)
  surface: {
    glass:   'rgba(255,255,255,0.03)',
    card:    'rgba(255,255,255,0.04)',
    hover:   'rgba(255,255,255,0.06)',
    active:  'rgba(255,255,255,0.08)',
  },

  white: '#ffffff',
  black: '#000000',
} as const;

// ─── Card presets ────────────────────────────────────────────────────────
export const card = {
  base: {
    background: colors.surface.card,
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: 16,
  },
  elevated: {
    background: colors.bg.secondary,
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: 16,
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  },
  interactive: {
    background: colors.surface.card,
    border: `1px solid ${colors.border.subtle}`,
    borderRadius: 16,
  },
} as const;

// ─── Section label (overline) ────────────────────────────────────────────
export const sectionLabel = {
  fontSize: 10,
  fontWeight: 700 as const,
  letterSpacing: '0.22em',
  color: colors.text.tertiary,
  textTransform: 'uppercase' as const,
};

// ─── Card label (inside dark cards) ──────────────────────────────────────
export const cardLabel = {
  fontSize: 10,
  fontWeight: 700 as const,
  letterSpacing: '0.22em',
  color: colors.text.tertiary,
  textTransform: 'uppercase' as const,
};

// ─── Number display (monospace for financial data) ───────────────────────
export const mono = {
  fontFamily: "var(--font-mono), 'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
};

// ─── Spacing (8px grid) ─────────────────────────────────────────────────
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

// ─── Radius ──────────────────────────────────────────────────────────────
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  full: 9999,
} as const;
