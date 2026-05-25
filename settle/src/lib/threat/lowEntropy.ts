// Shannon-entropy helpers used to flag low-entropy strings (dummy names,
// keyboard-mash business names, etc.). Pure functions, side-effect free.

/**
 * Shannon entropy of a string in bits per character. Uses lowercase
 * collapsing so 'AAaa' and 'aaaa' score the same.
 */
export function shannonEntropy(s: string | null | undefined): number {
  if (!s) return 0;
  const lowered = s.toLowerCase();
  const len = lowered.length;
  if (len === 0) return 0;

  const counts = new Map<string, number>();
  for (const ch of lowered) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }

  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** True when a string has < threshold bits of entropy. Defaults to 1.5 bits —
 *  catches 'aaaa', 'aaaaa', 'asdf' but allows real short names like 'Lee'. */
export function isLowEntropy(s: string | null | undefined, threshold = 1.5): boolean {
  if (!s) return false;
  const trimmed = s.trim();
  // Strings under 3 chars don't carry meaningful entropy in either direction —
  // skip flagging to avoid false-positives on real short names ('Bo', 'Ed').
  if (trimmed.length < 3) return false;
  return shannonEntropy(trimmed) < threshold;
}
