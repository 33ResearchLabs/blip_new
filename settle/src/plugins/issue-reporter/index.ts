/**
 * Issue Reporter — drop-in plugin
 *
 * Public surface: import these from `@/plugins/issue-reporter` (or the
 * relative path you've placed this folder at). Nothing else from this
 * directory is part of the contract.
 */

export { IssueReporter, openIssueReporter } from './IssueReporter';
export {
  IssueReporterProvider,
  useIssueReporterConfig,
} from './config';
export {
  useIssueReporter,
  ISSUE_CATEGORIES,
} from './useIssueReporter';

export type {
  IssueReporterConfig,
  IssueCategory,
  AttachmentInput,
  ScreenshotInput,
  IssueSubmission,
  SubmitInput,
  SubmitResult,
} from './types';
export { DEFAULT_CONFIG } from './types';
