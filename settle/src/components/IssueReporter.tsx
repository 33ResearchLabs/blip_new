/**
 * Compatibility shim — the real component now lives in the
 * `@/plugins/issue-reporter` folder, wrapped by the Blip-specific
 * adapter at `@/components/IssueReporterAdapter`.
 *
 * Existing imports (`@/components/IssueReporter`) keep working
 * unchanged. New code should import from `@/components/IssueReporterAdapter`
 * (Blip surfaces) or `@/plugins/issue-reporter` (other apps).
 */

export {
  IssueReporter,
  openIssueReporter,
} from './IssueReporterAdapter';
