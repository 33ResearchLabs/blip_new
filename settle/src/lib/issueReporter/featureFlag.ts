/**
 * Feature flag for the manual issue-reporting system.
 *
 * When ENABLE_ISSUE_REPORTING is NOT "true":
 *  - POST /api/issues/create returns 204 without writing
 *  - Admin /api/admin/issues routes return 404
 *  - Frontend reporter hook no-ops
 *
 * Kept separate from ENABLE_ERROR_TRACKING so ops can enable manual
 * reporting independently from the auto-error pipeline.
 */
export const ISSUE_REPORTING_ENABLED =
  (process.env.ENABLE_ISSUE_REPORTING || '').toLowerCase() === 'true';

/** Public flag so the client reporter hook can fast-path when disabled. */
export const CLIENT_ISSUE_REPORTING_ENABLED =
  (process.env.NEXT_PUBLIC_ENABLE_ISSUE_REPORTING || '').toLowerCase() === 'true';
