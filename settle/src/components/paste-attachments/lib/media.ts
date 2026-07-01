/**
 * Format a media duration (in seconds) as `m:ss`, or `h:mm:ss` past an hour.
 * Returns `""` for non-finite values (e.g. streaming media whose duration the
 * browser reports as `Infinity`) so callers can hide the badge.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hrs > 0 ? String(mins).padStart(2, '0') : String(mins);
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}
