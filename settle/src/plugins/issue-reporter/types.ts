/**
 * Public types for the issue-reporter plugin.
 *
 * Anything importable by the host app lives here so consumers don't
 * have to dig into individual component files. The plugin's
 * `index.ts` re-exports everything in this module.
 */

export type IssueCategory =
  | 'ui_bug'
  | 'backend'
  | 'payment'
  | 'performance'
  | 'other';

export interface AttachmentInput {
  name: string;
  dataUrl: string;
  mime: string;
  size: number;
}

/**
 * One screenshot in the multi-shot list. `dataUrl` is what gets
 * uploaded — for annotated shots that's the annotated overlay, for
 * raw captures or uploads it's the source image. `type` distinguishes
 * in-app screen captures from manually uploaded files so the host
 * (and any admin UI it has) can render them differently.
 */
export interface ScreenshotInput {
  dataUrl: string;
  type: 'screenshot' | 'upload';
  mime?: string;
  size_bytes?: number;
}

/**
 * Payload the plugin hands to the host's submission function /
 * endpoint. The plugin doesn't care HOW the host persists this — it
 * just hands over the raw form fields. The host must POST these to
 * its own backend (or call its own write helper).
 */
export interface IssueSubmission {
  title: string;
  category: IssueCategory;
  description: string;
  /** Legacy field — only populated when `screenshots` is empty. */
  screenshot?: string;
  /** v2 ordered list. Preferred over `screenshot` when non-empty. */
  screenshots?: ScreenshotInput[];
  attachments: Array<{ name: string; dataUrl: string }>;
  /** Auto-collected (route, viewport, UA, etc.) plus host extras. */
  metadata: Record<string, unknown>;
}

export interface SubmitResult {
  ok: boolean;
  /** Tracking ID returned by the host backend, if any. */
  issueId?: string;
  /** Human-readable error when ok=false. Surfaced as a toast. */
  error?: string;
}

/**
 * Hook input shape. The modal builds this from its internal state and
 * passes it to `useIssueReporter().submit()`. External callers can
 * call submit() directly to bypass the modal — useful for "Report
 * this" auto-prompts attached to caught errors.
 */
export interface SubmitInput {
  title: string;
  category: IssueCategory;
  description: string;
  /** Legacy single-shot. Use `screenshots` for new code. */
  screenshotDataUrl: string | null;
  /** v2 multi-shot. When supplied, takes precedence over the legacy field. */
  screenshots?: ScreenshotInput[];
  attachments: AttachmentInput[];
}

/**
 * Host-supplied configuration. Threaded down through
 * <IssueReporterProvider> so the modal/hook never have to import
 * anything app-specific (auth store, API URLs, etc.).
 */
export interface IssueReporterConfig {
  /**
   * Where to POST the issue. The body shape matches `IssueSubmission`.
   * Required unless `submit` is provided (which lets the host call
   * any custom transport instead of fetch).
   */
  endpoint?: string;

  /**
   * Custom submission transport. Receives the assembled payload and
   * returns a SubmitResult. Use this when the host wants to skip
   * fetch entirely — e.g. to call an internal SDK function or queue
   * the report locally for later sync.
   *
   * When omitted, the plugin uses fetch() against `endpoint`.
   */
  submit?: (payload: IssueSubmission) => Promise<SubmitResult>;

  /**
   * Returns the current auth token (or null). Called once per
   * submit — its result is sent as `Authorization: Bearer <token>`
   * when the default fetch transport is used. Ignored when `submit`
   * is provided (the host handles its own auth there).
   */
  getAuthToken?: () => string | null | undefined;

  /**
   * Gates the floating trigger and the modal. Hosts that don't have
   * a login concept can pass `true` permanently. Defaults to `true`.
   */
  authed?: boolean;

  /**
   * Extra metadata merged into every submission's `metadata` object.
   * Called fresh per submit so values can change at runtime (e.g.
   * current route, current user id). Reserved keys
   * (`route`, `userAgent`, etc.) are overwritten by the plugin's
   * defaults — pass app-specific keys here.
   */
  extraMetadata?: () => Record<string, unknown>;

  /** Notified on successful submission. Fires once per success. */
  onSubmitted?: (issueId: string | undefined) => void;

  /** Notified when the user closes the modal without submitting. */
  onCancelled?: () => void;

  /** Caps. Defaults: 5 screenshots, 5 attachments. */
  maxScreenshots?: number;
  maxAttachments?: number;

  /** Toggles the global keyboard shortcut. Default: true. */
  shortcutEnabled?: boolean;

  /** Default trigger label and corner. */
  triggerLabel?: string;
  position?: 'bottom-right' | 'bottom-left';

  /**
   * Footer copy shown beneath the Submit button. Defaults to a
   * brand-neutral "Your feedback helps us improve." message — hosts
   * typically override with their product name.
   */
  footerText?: string;

  /**
   * Hide the floating trigger entirely. Use when the host owns its
   * own entry point and opens the modal via the imperative
   * `openIssueReporter()` export.
   */
  hideTrigger?: boolean;
}

/**
 * Default config used when a value isn't supplied. Public so hosts
 * can spread it (`{ ...DEFAULT_CONFIG, endpoint: '/x' }`).
 */
export const DEFAULT_CONFIG: Required<
  Pick<
    IssueReporterConfig,
    | 'authed'
    | 'maxScreenshots'
    | 'maxAttachments'
    | 'shortcutEnabled'
    | 'triggerLabel'
    | 'position'
    | 'hideTrigger'
    | 'footerText'
  >
> = {
  authed: true,
  maxScreenshots: 5,
  maxAttachments: 5,
  shortcutEnabled: true,
  triggerLabel: 'Report Issue',
  position: 'bottom-right',
  hideTrigger: false,
  footerText: 'Your feedback helps us improve.',
};
