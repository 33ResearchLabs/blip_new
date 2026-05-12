'use client';

/**
 * Blip-specific adapter for the issue-reporter plugin.
 *
 * The plugin (under @/plugins/issue-reporter) is host-agnostic. This
 * file is the only place that wires Blip-specific concerns into it:
 *   - merchant store for the `authed` gate (logged-in OR has merchant id)
 *   - /api/issues/create as the endpoint
 *   - branded footer copy
 *
 * Auth: the `/api/issues/create` route reads the access token from the
 * httpOnly `blip_access_token` cookie (see lib/middleware/auth.ts), which
 * is automatically attached on same-origin fetches. We deliberately do
 * NOT read tokens from localStorage here — that path is JS-readable and
 * would re-introduce an XSS-exfiltration vector.
 *
 * Consumers should import <IssueReporter /> from THIS file, not from
 * the plugin directly. That way every Blip surface gets the same
 * config without each call site repeating it.
 */

import { useMemo } from 'react';
import { useMerchantStore } from '@/stores/merchantStore';
import {
  IssueReporter as PluginIssueReporter,
  IssueReporterProvider,
  type IssueReporterConfig,
} from '@/plugins/issue-reporter';

// Re-export the imperative opener so existing call sites that import
// `openIssueReporter` from `@/components/IssueReporter` (legacy path)
// can update to `@/components/IssueReporterAdapter` with no other
// changes — or keep using the legacy shim, which re-exports from here.
export { openIssueReporter } from '@/plugins/issue-reporter';

interface AdapterProps {
  /** Per-mount overrides — same shape as the plugin's IssueReporter. */
  triggerLabel?: string;
  position?: 'bottom-right' | 'bottom-left';
  authed?: boolean;
  hideTrigger?: boolean;
}

/**
 * Drop-in replacement for the legacy <IssueReporter /> component.
 * Internally wraps the plugin's <IssueReporterProvider> so the modal
 * gets Blip's config without each call site needing to know.
 */
export function IssueReporter(props: AdapterProps) {
  const isLoggedIn = useMerchantStore((s) => s.isLoggedIn);
  const merchantId = useMerchantStore((s) => s.merchantId);

  // Memoized so the provider doesn't re-render its children for
  // unrelated parent updates.
  const config = useMemo<IssueReporterConfig>(
    () => ({
      endpoint: '/api/issues/create',
      authed: isLoggedIn || !!merchantId,
      footerText: 'Your feedback helps us improve Blip.money',
    }),
    [isLoggedIn, merchantId],
  );

  return (
    <IssueReporterProvider config={config}>
      <PluginIssueReporter {...props} />
    </IssueReporterProvider>
  );
}
