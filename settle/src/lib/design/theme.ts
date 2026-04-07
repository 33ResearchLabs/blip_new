// ─── Theme-aware Design Tokens ───────────────────────────────────────────
// All values are CSS variable references defined in globals.css.
// Inline styles using these will automatically respect the active theme
// (dark / light) — no component refactor needed.

export const colors = {
  // Background hierarchy
  bg: {
    primary:   'var(--color-bg-primary)',
    secondary: 'var(--color-bg-secondary)',
    tertiary:  'var(--color-bg-tertiary)',
    elevated:  'var(--color-bg-tertiary)',
  },

  // Accent — flips white (dark mode) ↔ navy (light mode)
  accent: {
    primary:   'var(--accent)',
    bright:    'var(--accent-bright)',
    dim:       'var(--accent-dim)',
    subtle:    'var(--accent-subtle)',
    glow:      'var(--accent-glow)',
    border:    'var(--color-border-strong)',
    text:      'var(--accent-text)',
  },

  // Semantic
  success:       'var(--color-success)',
  successDim:    'var(--color-success-dim)',
  successBorder: 'var(--color-success-border)',
  warning:       'var(--color-warning)',
  warningDim:    'var(--color-warning-dim)',
  warningBorder: 'var(--color-warning-border)',
  error:         'var(--color-error)',
  errorDim:      'var(--color-error-dim)',
  errorBorder:   'var(--color-error-border)',
  info:          'var(--color-info)',

  // Text
  text: {
    primary:    'var(--color-text-primary)',
    secondary:  'var(--color-text-secondary)',
    tertiary:   'var(--color-text-tertiary)',
    quaternary: 'var(--color-text-quaternary)',
    inverse:    'var(--accent-text)',
  },

  // Borders
  border: {
    subtle:  'var(--color-border-subtle)',
    medium:  'var(--color-border-medium)',
    strong:  'var(--color-border-strong)',
  },

  // Surfaces (glass cards)
  surface: {
    glass:   'var(--color-surface-card)',
    card:    'var(--color-surface-card)',
    hover:   'var(--color-surface-hover)',
    active:  'var(--color-surface-active)',
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
