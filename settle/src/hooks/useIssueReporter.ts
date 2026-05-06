/**
 * Compatibility shim — the real hook now lives in
 * `@/plugins/issue-reporter`. Existing imports keep working.
 *
 * NOTE: the new hook reads its endpoint and auth from the plugin's
 * config provider (see <IssueReporterProvider>). The
 * <IssueReporterAdapter> at @/components/IssueReporterAdapter wraps
 * the modal in the provider with Blip-specific config, so any place
 * that renders the modal already gets the right context.
 *
 * For ad-hoc callers of `useIssueReporter()` outside the modal:
 * make sure the calling tree is inside an <IssueReporterProvider>.
 * In Blip's app the merchant/user pages always have one because the
 * adapter mounts it.
 */

export {
  useIssueReporter,
  ISSUE_CATEGORIES,
} from '@/plugins/issue-reporter';

export type {
  IssueCategory,
  AttachmentInput,
  ScreenshotInput,
  SubmitInput,
  SubmitResult,
} from '@/plugins/issue-reporter';
