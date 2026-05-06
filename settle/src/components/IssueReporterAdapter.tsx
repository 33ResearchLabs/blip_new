'use client';

/**
 * Blip-specific adapter for the issue-reporter plugin.
 *
 * The plugin (under @/plugins/issue-reporter) is host-agnostic. This
 * file is the only place that wires Blip-specific concerns into it:
 *   - merchant store for the `authed` gate (logged-in OR has merchant id)
 *   - localStorage tokens for `getAuthToken`
 *   - /api/issues/create as the endpoint
 *   - branded footer copy
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
      getAuthToken: getBlipAuthToken,
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

/**
 * Reads the Blip session/access token from the same localStorage
 * keys the rest of the app uses. Kept Blip-specific so the plugin
 * stays portable.
 */
function getBlipAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      window.localStorage.getItem('blip_access_token') ||
      window.localStorage.getItem('blip_merchant_token') ||
      null
    );
  } catch {
    return null;
  }
}
