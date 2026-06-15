"use client";

import Image from "next/image";

/**
 * Single source of truth for the Blip logo *icon* (the square brand mark).
 *
 * Renders the raster icon via Next.js `<Image>`, which downscales the large
 * source PNG to the displayed size and serves it as AVIF/WebP (with a PNG
 * fallback) — a few KB instead of the 1.8 MB original. This is what makes
 * the logo appear instantly and consistently across Chrome, Firefox, Edge
 * and Brave; a raw <img> on the full-size PNG could flash the `alt` text
 * on a cold load before the bytes arrived.
 *
 * The leading slash is required so the path resolves from the `public` root
 * on every route (a relative `brand/...` path breaks on nested routes like
 * `/market/login`).
 *
 * For the full "Blip Market" wordmark lockup (icon + text wrapped in a
 * Link), use `Logo` from `@/components/shared/Logo` instead — that
 * component composes this one.
 *
 * To swap the asset (e.g. to a transparent-background star), change this
 * one constant — every call site updates automatically.
 */
// const LOGO_SRC = "/brand/blip-icon.png";
const LOGO_SRC = "/brand/blip-icon-bg-remove.png";

interface BlipLogoProps {
  /** Width & height in pixels. Defaults to 36 (matches the old `w-9 h-9`). */
  size?: number;
  /** Extra classes appended after `object-contain`. */
  className?: string;
  /** Accessible name. Pass "" for decorative use inside a labelled parent. */
  alt?: string;
  /**
   * Preload eagerly (skip lazy-loading). Set true for above-the-fold uses
   * like the header so the logo paints immediately on first load.
   */
  priority?: boolean;
}

export function BlipLogo({
  size = 36,
  className = "",
  alt = "Blip",
  priority = false,
}: BlipLogoProps) {
  return (
    <Image
      src={LOGO_SRC}
      alt={alt}
      width={size}
      height={size}
      // Render at 2x the CSS size so the downscaled raster stays crisp on
      // HiDPI/retina displays without shipping the full 2000px source.
      sizes={`${size * 2}px`}
      priority={priority}
      style={{ width: size, height: size }}
      className={`object-contain ${className}`.trim()}
    />
  );
}

export default BlipLogo;
