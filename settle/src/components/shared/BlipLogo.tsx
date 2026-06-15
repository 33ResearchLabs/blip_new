"use client";

/**
 * Single source of truth for the Blip logo *icon* (the square brand mark).
 *
 * Renders a pre-sized raster icon from `public/brand/blip-icon-192.png`
 * (~32 KB) with a plain <img>. We deliberately do NOT use next/image here:
 * the image optimizer (`/_next/image`) is not reliable in the production
 * runtime, so an optimized logo would 404/500 on live and the browser would
 * fall back to rendering the `alt` text ("Blip") next to a broken-image
 * icon — even though it worked in dev. Serving an already-small static PNG
 * directly works identically in dev and production and across Chrome,
 * Firefox, Edge and Brave, with no optimizer dependency.
 *
 * The source artwork is 2000x2000 / 1.8 MB; that file is too large to ship
 * raw (it flashed the alt text on cold loads), so we ship the downscaled
 * 192px variant generated from it. The 192px size stays crisp up to a 96px
 * display at 2x DPR — well above every call site (36-46px today).
 *
 * The leading slash is required so the path resolves from the `public` root
 * on every route (a relative `brand/...` path breaks on nested routes like
 * `/market/login`).
 *
 * For the full "Blip Market" wordmark lockup (icon + text wrapped in a
 * Link), use `Logo` from `@/components/shared/Logo` instead — that
 * component composes this one.
 *
 * To swap the asset, regenerate the downscaled PNG and change this constant
 * — every call site updates automatically.
 */
const LOGO_SRC = "/brand/blip-icon-192.png";

interface BlipLogoProps {
  /** Width & height in pixels. Defaults to 36 (matches the old `w-9 h-9`). */
  size?: number;
  /** Extra classes appended after `object-contain`. */
  className?: string;
  /** Accessible name. Pass "" for decorative use inside a labelled parent. */
  alt?: string;
  /**
   * Hint the browser to fetch this image at high priority. Set true for
   * above-the-fold uses like the header so the logo paints immediately.
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
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt={alt}
      width={size}
      height={size}
      decoding="async"
      loading={priority ? "eager" : "lazy"}
      // fetchPriority is a standard HTML attribute; React passes it through.
      fetchPriority={priority ? "high" : "auto"}
      style={{ width: size, height: size }}
      className={`object-contain ${className}`.trim()}
    />
  );
}

export default BlipLogo;
