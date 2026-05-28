"use client";

/**
 * MarketingLanding — fullscreen public landing for the user app.
 *
 * Strategy: render the pixel-perfect static landing (built off the
 * `docs/showcase/index.html` showcase) inside a same-origin iframe. The
 * iframe owns its own CSS variables, fonts, and inline scripts (the live
 * waitlist counter + market pulse animations), so nothing leaks into the
 * surrounding `.user-scope` tokens that drive the rest of the user app.
 *
 * The middleware carves `/marketing.html` out of the strict CSP so its
 * inline `<script>` can run; the parent CSP's `frame-src 'self'` lets us
 * embed it here.
 *
 * The marketing site carries its own navbar (Sign in → /login, Join
 * Waitlist → /waitlist/user — both `target="_top"` so they navigate the
 * outer window, not the iframe) and footer strip, so this React shell
 * stays empty.
 */

export function MarketingLanding() {
  return (
    <div className="fixed inset-0 w-full h-dvh bg-[#FAF8F5]">
      <iframe
        src="/marketing.html"
        title="Blip money"
        className="absolute inset-0 w-full h-full border-0"
        loading="eager"
      />
    </div>
  );
}
