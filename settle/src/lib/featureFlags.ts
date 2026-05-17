/**
 * Client-side feature flags. Tiny, deliberately not framework-y — flip a
 * const to revert. Build-time evaluated so the unused branches get
 * dead-code-eliminated.
 *
 * Adding a flag here? Mention it in the surfaces that read it (with a
 * short comment near the import) so it's obvious how to flip back.
 */

/** Canonical 3-component fee breakdown (Merchant rate · Blip service fee
 *  · Boost · Final settlement) across trade creation / preview / order
 *  detail / completion / QR flows. Flip to `false` to fall back to the
 *  legacy single-blob fee/preview cards. Old code paths are kept under
 *  the else branches so reverting needs zero re-editing. */
export const FEE_UI_V2 = true;
