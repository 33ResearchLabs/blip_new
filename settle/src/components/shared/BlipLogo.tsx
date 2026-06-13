"use client";

/**
 * Single source of truth for the Blip logo *icon* (the square brand mark).
 *
 * Renders the raster icon from `public/brand/blip-icon.png`. The leading
 * slash is required so the path resolves from the `public` root on every
 * route (a relative `brand/...` path breaks on nested routes like
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
}

export function BlipLogo({
  size = 36,
  className = "",
  alt = "Blip",
}: BlipLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt={alt}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`object-contain ${className}`.trim()}
    />
  );
}

export default BlipLogo;
