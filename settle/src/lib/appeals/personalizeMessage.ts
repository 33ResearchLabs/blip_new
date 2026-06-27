/**
 * Personalize an appeal system chat message for the viewer.
 *
 * Appeal system messages are a SINGLE shared row shown to both parties, so they
 * name the actor by role ("The seller raised an appeal", "The buyer proposed
 * to …"). For the party who actually performed the action, that reads in an odd
 * third person. This rewrites the leading clause to "You …" when the role named
 * in the message matches the viewer's own trade role.
 *
 *   viewer is seller, message "The seller raised an appeal" → "You raised an appeal"
 *   viewer is buyer,  message "The seller raised an appeal" → unchanged
 *
 * Pure + idempotent. Returns the text untouched when role is unknown or the
 * message isn't one of the personable appeal lines.
 */
export function personalizeAppealMessage(
  text: string | null | undefined,
  viewerRole: "buyer" | "seller" | null | undefined,
): string {
  if (!text || !viewerRole) return text ?? "";
  return text
    .replace(`The ${viewerRole} raised an appeal`, "You raised an appeal")
    .replace(`The ${viewerRole} proposed to`, "You proposed to");
}
