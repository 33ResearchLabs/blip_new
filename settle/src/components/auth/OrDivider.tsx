/**
 * Visual "or" separator between primary auth (email/password) and
 * alternate auth (Google). Shared across waitlist + merchant + user
 * landing screens so the divider stays visually consistent.
 *
 * Border / text colors mirror the rest of the waitlist auth shell:
 *   - light mode: black/10 lines, black/40 label
 *   - dark mode:  white/10 lines, white/40 label
 */

export default function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 my-1">
      <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
      <span className="text-[11px] uppercase tracking-wider text-black/40 dark:text-white/40">
        {label}
      </span>
      <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
    </div>
  );
}
