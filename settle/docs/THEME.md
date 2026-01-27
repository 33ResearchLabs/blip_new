# Blip Money - Theme & Design System

A comprehensive guide to the theme and design patterns used in the Blip Money P2P trading app.

**Design Philosophy**: Black, White, Orange - Only 1-2 orange accents per screen for modern, minimal aesthetic.

---

## Color Palette

### CSS Custom Properties (globals.css)

```css
/* Dark mode (default) - Black/White/Orange Theme */
:root {
  --background: #000000;
  --foreground: #ffffff;
  --card: rgba(255, 255, 255, 0.04);
  --card-solid: #0a0a0a;
  --border: rgba(255, 255, 255, 0.08);
  --muted: #71717a;
  --muted-bg: #141414;
  --accent: #f97316;
  --accent-dark: #ea580c;
  --accent-subtle: rgba(249, 115, 22, 0.1);
  --accent-glow: rgba(249, 115, 22, 0.15);
}

/* Light mode */
:root.light {
  --background: #ffffff;
  --foreground: #0a0a0a;
  --card: rgba(0, 0, 0, 0.03);
  --card-solid: #fafafa;
  --border: rgba(0, 0, 0, 0.06);
  --muted: #71717a;
  --muted-bg: #f5f5f5;
  --accent: #ea580c;
  --accent-dark: #c2410c;
  --accent-subtle: rgba(234, 88, 12, 0.08);
  --accent-glow: rgba(234, 88, 12, 0.12);
}
```

### Primary Colors

| Color | Dark Mode | Light Mode | Usage |
|-------|-----------|------------|-------|
| Background | `#000000` | `#ffffff` | Main app background |
| Foreground | `#ffffff` | `#0a0a0a` | Primary text |
| Card | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.03)` | Glass card backgrounds |
| Card Solid | `#0a0a0a` | `#fafafa` | Solid card backgrounds |
| Border | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.06)` | Borders |

### Accent Colors (Orange Theme)

| Color | Value | Usage |
|-------|-------|-------|
| Orange | `#f97316` / `orange-500` | Primary accent, CTAs (use sparingly!) |
| Orange Dark | `#ea580c` / `orange-600` | Primary buttons, CTAs |
| Orange Subtle | `rgba(249, 115, 22, 0.1)` | Active states, subtle backgrounds |
| Orange Glow | `rgba(249, 115, 22, 0.15)` | Glow effects |

### Status Colors

| Status | Background | Text | Border |
|--------|------------|------|--------|
| Success | `emerald-500/10` | `emerald-400` | `emerald-500/30` |
| Warning | `amber-500/10` | `amber-400` | `amber-500/30` |
| Error | `red-500/10` | `red-400` | `red-500/30` |
| Info | `blue-500/10` | `blue-400` | `blue-500/30` |

---

## Typography

### Font Family
```css
font-family: var(--font-geist-sans), -apple-system, system-ui, sans-serif;
```

### Font Sizes (Tailwind)
- `text-[32px]` - Page titles
- `text-xl` / `text-lg` - Section headers
- `text-[17px]` - Body text, inputs
- `text-[15px]` - Secondary text
- `text-sm` / `text-[14px]` - Labels
- `text-[13px]` - Small labels
- `text-xs` / `text-[12px]` - Metadata, badges

### Font Weights
- `font-bold` - Titles, emphasis
- `font-semibold` - Headers, buttons
- `font-medium` - Labels, navigation

---

## Spacing & Layout

### Container Width
```tsx
const maxW = "max-w-[440px] mx-auto";
```

### Common Padding
- Page padding: `px-6`
- Card padding: `p-4` or `p-5`
- Button padding: `px-4 py-3` or `px-6 py-4`
- Input padding: `px-4 py-4`

### Border Radius
- Large: `rounded-2xl` (buttons, cards)
- Medium: `rounded-xl` (inputs, smaller cards)
- Small: `rounded-lg` (chips, badges)
- Full: `rounded-full` (avatars, pills)

---

## Components

### Primary Button
```tsx
<motion.button
  whileTap={{ scale: 0.97 }}
  className="w-full py-4 rounded-2xl bg-orange-500 text-white text-[17px] font-semibold glow-accent press-effect"
>
  Button Text
</motion.button>
```

### Secondary Button
```tsx
<button className="px-4 py-3 rounded-xl bg-neutral-900 text-white text-[15px] font-medium">
  Secondary
</button>
```

### Outline Button
```tsx
<button className="px-4 py-3 rounded-xl border border-neutral-700 text-white text-[15px] font-medium">
  Outline
</button>
```

### Text Input
```tsx
<input
  className="w-full bg-neutral-900 rounded-2xl px-4 py-4 text-white text-[17px] placeholder:text-neutral-600 outline-none focus:ring-2 focus:ring-orange-500 focus-glow"
  placeholder="Enter value..."
/>
```

### Card Container
```tsx
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  className="glass-card rounded-2xl p-4 hover-lift"
>
  {/* Card content */}
</motion.div>
```

### Status Badge
```tsx
// Success
<span className="px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 text-xs font-medium">
  Complete
</span>

// Warning
<span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-400 text-xs font-medium">
  Pending
</span>

// Error
<span className="px-2 py-1 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium">
  Failed
</span>
```

### Avatar
```tsx
<div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
  <span className="text-xl">🦊</span>
</div>
```

### Chip/Pill Selector
```tsx
<div className="flex gap-2">
  {options.map(option => (
    <button
      key={option.id}
      className={`px-4 py-2 rounded-xl text-[14px] font-medium transition-colors ${
        selected === option.id
          ? 'bg-blue-500 text-white'
          : 'bg-neutral-900 text-neutral-400'
      }`}
    >
      {option.label}
    </button>
  ))}
</div>
```

### Order Progress Steps
```tsx
<div className="flex items-center justify-between">
  {[1, 2, 3, 4].map((s) => (
    <div key={s} className="flex items-center">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
        step >= s ? 'bg-orange-500 text-white' : 'bg-neutral-800 text-neutral-500'
      }`}>
        {s}
      </div>
      {s < 4 && (
        <div className={`h-0.5 w-12 mx-1 ${
          step > s ? 'bg-orange-500' : 'bg-neutral-800'
        }`} />
      )}
    </div>
  ))}
</div>
```

---

## Special Effects

### Ambient Background Gradient
```tsx
<div className="degen-bg">
  {/* Subtle orange gradient overlay at top */}
</div>
```

```css
.degen-bg {
  background:
    radial-gradient(ellipse at 50% -20%, var(--accent-glow) 0%, transparent 60%),
    var(--background);
}
```

### Orange Glow Effect
```tsx
<div className="glow-accent">
  {/* Element with subtle orange glow */}
</div>
```

```css
.glow-accent {
  box-shadow:
    0 0 30px var(--accent-glow),
    0 0 80px rgba(249, 115, 22, 0.05);
}
```

### Glass Morphism Card
```tsx
<div className="glass-card rounded-2xl p-4">
  {/* Frosted glass effect */}
</div>
```

```css
.glass-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
```

### Animations

```css
/* Classic animations */
.wiggle { animation: wiggle 0.3s ease-in-out; }
.float { animation: float 2s ease-in-out infinite; }
.pulse-slow { animation: pulse-slow 2s ease-in-out infinite; }

/* 2025-2026 Modern Animations */
.animate-slideUp { animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.animate-slideDown { animation: slideDown 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.animate-fadeIn { animation: fadeIn 0.4s ease-out forwards; }
.animate-scaleIn { animation: scaleIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.animate-slideInRight { animation: slideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

/* Animation delays for staggering */
.delay-100 { animation-delay: 100ms; }
.delay-200 { animation-delay: 200ms; }
.delay-300 { animation-delay: 300ms; }
```

### Micro-interactions

```css
/* Hover lift effect */
.hover-lift { transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.hover-lift:hover { transform: translateY(-2px); }
.hover-lift:active { transform: translateY(0) scale(0.98); }

/* Press effect for buttons */
.press-effect { transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1); }
.press-effect:active { transform: scale(0.97); }

/* Focus glow (for inputs) */
.focus-glow:focus {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-subtle), 0 0 20px var(--accent-glow);
}

/* Ring pulse for notifications */
.ring-pulse { animation: ring-pulse 2s infinite; }
```

### Shimmer Loading Effect

```css
.shimmer {
  background: linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.05) 50%, rgba(255,255,255,0) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

---

## Page Layout

### Full Screen Mobile Layout
```tsx
<div className="h-dvh bg-black flex flex-col items-center overflow-hidden">
  {/* Content */}
</div>
```

### Scrollable Content Area
```tsx
<div className="flex-1 overflow-y-auto px-6">
  {/* Scrollable content */}
</div>
```

### Bottom Navigation
```tsx
<nav className="glass-card border-t border-white/5 px-6 pb-8 pt-3 safe-bottom">
  <div className="flex items-center justify-around">
    {navItems.map(item => (
      <motion.button
        key={item.id}
        whileTap={{ scale: 0.95 }}
        className={`flex flex-col items-center gap-1 relative px-4 py-1 rounded-xl transition-all ${
          active === item.id ? 'text-orange-400' : 'text-neutral-600'
        }`}
      >
        {active === item.id && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute inset-0 bg-orange-500/10 rounded-xl"
            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
          />
        )}
        <item.icon className="w-5 h-5 relative z-10" strokeWidth={active === item.id ? 2.5 : 1.5} />
        <span className="text-[10px] font-medium relative z-10">{item.label}</span>
      </motion.button>
    ))}
  </div>
</nav>
```

---

## Theme Switching

### Theme Context Usage
```tsx
import { useTheme } from "@/context/ThemeContext";

function Component() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button onClick={toggleTheme}>
      {theme === 'dark' ? <Sun /> : <Moon />}
    </button>
  );
}
```

### Theme Toggle Button
```tsx
<button
  onClick={toggleTheme}
  className="p-2 rounded-xl bg-neutral-900 text-neutral-400 hover:text-white transition-colors"
>
  {theme === 'dark' ? (
    <Sun className="w-5 h-5" />
  ) : (
    <Moon className="w-5 h-5" />
  )}
</button>
```

---

## Icon Library

We use **Lucide React** for icons:

```tsx
import {
  ArrowDownUp,
  MessageCircle,
  Check,
  Copy,
  MapPin,
  Clock,
  User,
  Wallet,
  Shield,
  Bell,
  Sun,
  Moon,
  ChevronRight,
  ChevronLeft,
  X,
  Plus,
  Trash2,
  Star,
  Navigation,
  ExternalLink,
  Banknote,
  Building2,
  Loader2,
} from "lucide-react";
```

### Icon Sizes
- Navigation: `w-5 h-5`
- Buttons: `w-4 h-4` or `w-5 h-5`
- Large display: `w-6 h-6` to `w-10 h-10`

---

## Animation Library

We use **Framer Motion** for animations:

```tsx
import { motion, AnimatePresence } from "framer-motion";

// Page transitions
<AnimatePresence mode="wait">
  <motion.div
    key={screen}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
  >
    {/* Content */}
  </motion.div>
</AnimatePresence>

// Button tap effect
<motion.button whileTap={{ scale: 0.98 }}>
  Click me
</motion.button>
```

---

## Best Practices

1. **Always use CSS variables** for theme-aware colors
2. **Use Tailwind classes** for spacing and sizing
3. **Prefer `dvh` over `vh`** for mobile viewport height
4. **Use `safe-bottom`** class for bottom navigation padding
5. **Keep text readable** - use `text-neutral-400` for secondary text
6. **Maintain 60px+ tap targets** for touch accessibility
7. **Use `transition-colors`** for hover/active states
8. **Add `overflow-hidden`** to prevent unwanted scrolling

---

## File Structure

```
src/
├── app/
│   ├── globals.css          # Theme variables & overrides
│   ├── layout.tsx           # ThemeProvider wrapper
│   └── page.tsx             # Main app with theme usage
├── context/
│   └── ThemeContext.tsx     # Theme state management
└── hooks/
    └── useSounds.ts         # Sound effects
```
