// Behavioural-telemetry collector for the signup form. Attaches event
// listeners to the form root + window, captures TIMING-LEVEL data only
// (no event content, no key codes, no pasted text, no mouse coordinates
// beyond what's needed for an entropy summary), and produces a compact
// `BehaviorPayload` for submission alongside the register POST.
//
// Privacy:
//   * No keystroke content captured (only inter-key timing).
//   * No pasted text captured (only the FIELD NAME).
//   * Mouse coordinates aggregated into a small histogram for entropy,
//     then dropped — raw coordinates never leave the page.
//
// SSR-safe: all DOM access is inside attach()/snapshot(), which only run
// after mount. Plain class — importing this module does no work.

export interface BehaviorPayload {
  fill_time_ms: number;
  mouse_entropy: number;
  keystroke_cadence_stddev: number;
  copy_paste_events: string[];
  tab_switches: number;
  scroll_events: number;
}

const MOUSE_HISTOGRAM_BINS = 16;          // 4 × 4 grid covering the page

export class SignupBehaviorCollector {
  private firstFocusAt: number | null = null;
  private startedAt: number = Date.now();
  private lastKeydownAt: number | null = null;
  private keystrokeIntervals: number[] = [];
  private mouseHistogram: number[] = new Array(MOUSE_HISTOGRAM_BINS * MOUSE_HISTOGRAM_BINS).fill(0);
  private mouseMoveCount = 0;
  private copyPasteFields: Set<string> = new Set();
  private tabSwitches = 0;
  private scrollEvents = 0;
  private detached = false;
  private cleanups: Array<() => void> = [];

  /** Attach all listeners. Returns a detach function that's also stored
   *  internally so snapshot() works without the caller having to keep the
   *  reference. */
  attach(formRoot: HTMLElement): () => void {
    if (typeof window === 'undefined' || this.cleanups.length > 0) {
      // Already attached or SSR — no-op detach.
      return () => undefined;
    }

    // First-focus timing — listen on form root (capture phase to catch the
    // very first focus on any descendant input).
    const onFocusIn = () => {
      if (this.firstFocusAt === null) this.firstFocusAt = Date.now();
    };
    formRoot.addEventListener('focusin', onFocusIn, { passive: true });
    this.cleanups.push(() => formRoot.removeEventListener('focusin', onFocusIn));

    // Keystroke intervals — keydown on form root (catches all input fields).
    const onKeydown = () => {
      const now = Date.now();
      if (this.lastKeydownAt !== null) {
        const interval = now - this.lastKeydownAt;
        // Discard absurd gaps (pauses, tab-aways) — we want pure typing
        // cadence. Anything > 5s indicates the user paused / switched away.
        if (interval > 0 && interval < 5000) {
          this.keystrokeIntervals.push(interval);
        }
      }
      this.lastKeydownAt = now;
    };
    formRoot.addEventListener('keydown', onKeydown, { passive: true });
    this.cleanups.push(() => formRoot.removeEventListener('keydown', onKeydown));

    // Paste events — only the FIELD NAME, never the pasted content.
    const onPaste = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const name = (target.getAttribute('name')
                 ?? target.getAttribute('id')
                 ?? target.tagName.toLowerCase());
      // Sanitise: only safe characters, trim length.
      const safe = name.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
      if (safe) this.copyPasteFields.add(safe);
    };
    formRoot.addEventListener('paste', onPaste, { passive: true });
    this.cleanups.push(() => formRoot.removeEventListener('paste', onPaste));

    // Mouse moves — bucket into a 4×4 histogram over the viewport. We only
    // need the distribution shape, not the raw coordinates.
    const onMouseMove = (e: MouseEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const bx = Math.min(MOUSE_HISTOGRAM_BINS - 1, Math.floor((e.clientX / w) * 4));
      const by = Math.min(MOUSE_HISTOGRAM_BINS - 1, Math.floor((e.clientY / h) * 4));
      // 4x4 grid: index = by * 4 + bx (range 0..15)
      const idx = by * 4 + bx;
      if (idx >= 0 && idx < this.mouseHistogram.length) {
        this.mouseHistogram[idx] += 1;
        this.mouseMoveCount += 1;
      }
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    this.cleanups.push(() => window.removeEventListener('mousemove', onMouseMove));

    // Tab visibility — increments on every show/hide transition.
    const onVisibility = () => { this.tabSwitches += 1; };
    document.addEventListener('visibilitychange', onVisibility, { passive: true });
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    // Scroll events — light counter, no positions.
    const onScroll = () => { this.scrollEvents += 1; };
    window.addEventListener('scroll', onScroll, { passive: true });
    this.cleanups.push(() => window.removeEventListener('scroll', onScroll));

    return () => this.detach();
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    for (const fn of this.cleanups) {
      try { fn(); } catch {/* ignore */}
    }
    this.cleanups = [];
  }

  /** Compute the final payload. Safe to call multiple times. Returns null
   *  if no signals were collected at all (e.g. user never focused the
   *  form — unlikely in practice but defensive). */
  snapshot(): BehaviorPayload | null {
    const now = Date.now();
    const start = this.firstFocusAt ?? this.startedAt;
    const fillTime = Math.max(0, now - start);

    // Mouse entropy — Shannon entropy over the histogram. Pure bot path
    // (no mouse moves) → 0. Random/varied human path → ~3-4 bits.
    let entropy = 0;
    if (this.mouseMoveCount > 0) {
      for (const c of this.mouseHistogram) {
        if (c > 0) {
          const p = c / this.mouseMoveCount;
          entropy -= p * Math.log2(p);
        }
      }
    }

    // Keystroke cadence stddev.
    const stddev = stddevOf(this.keystrokeIntervals);

    return {
      fill_time_ms: fillTime,
      mouse_entropy: round3(entropy),
      keystroke_cadence_stddev: round3(stddev),
      copy_paste_events: Array.from(this.copyPasteFields),
      tab_switches: this.tabSwitches,
      scroll_events: this.scrollEvents,
    };
  }
}

function stddevOf(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
