/**
 * Visual "or" separator between primary auth (email/password) and
 * alternate auth (Google). Shared across waitlist + merchant + user
 * landing screens so the divider stays visually consistent.
 *
 * Border / text colors mirror the rest of the waitlist auth shell:
 *   - light mode: black/10 lines, black/40 label
 *   - dark mode:  white/10 lines, white/40 label
 */

// `dark` is optional: when supplied (e.g. from the waitlist-scoped theme),
// colors are pinned explicitly so they follow that theme rather than the
// global `.dark` class. When omitted, the Tailwind `dark:` variants apply
// (global theme) — the behavior existing non-waitlist callers rely on.
export default function OrDivider({ label = "or", dark }: { label?: string; dark?: boolean }) {
  const line = dark === undefined ? "bg-black/10 dark:bg-white/10" : dark ? "bg-white/10" : "bg-black/10";
  const text = dark === undefined ? "text-black/40 dark:text-white/40" : dark ? "text-white/40" : "text-black/40";
  return (
    <div className="flex items-center gap-3 my-1">
      <div className={`flex-1 h-px ${line}`} />
      <span className={`text-[11px] uppercase tracking-wider ${text}`}>
        {label}
      </span>
      <div className={`flex-1 h-px ${line}`} />
    </div>
  );
}
