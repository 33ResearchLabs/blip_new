'use client';

/**
 * IssueReporterProvider — supplies the plugin's config via React Context.
 *
 * Wrap the part of your tree that renders <IssueReporter /> (or calls
 * useIssueReporter) with this provider. Consumers inside the plugin
 * read config through `useIssueReporterConfig()` so the modal and
 * hook never import host-specific modules.
 *
 *   <IssueReporterProvider config={{ endpoint, getAuthToken, authed }}>
 *     <App />
 *   </IssueReporterProvider>
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_CONFIG, type IssueReporterConfig } from './types';

type ResolvedConfig = IssueReporterConfig & typeof DEFAULT_CONFIG;

const IssueReporterConfigContext = createContext<ResolvedConfig | null>(null);

export interface IssueReporterProviderProps {
  config: IssueReporterConfig;
  children: ReactNode;
}

export function IssueReporterProvider({
  config,
  children,
}: IssueReporterProviderProps) {
  // Merge over defaults once per config-object identity so memoization
  // downstream (in the hook) stays cheap. The host is expected to
  // memoize its own config object — when they don't, we still avoid
  // creating new merged refs on every render via this useMemo.
  const merged = useMemo<ResolvedConfig>(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    [config],
  );
  return (
    <IssueReporterConfigContext.Provider value={merged}>
      {children}
    </IssueReporterConfigContext.Provider>
  );
}

/**
 * Read the resolved config inside the plugin. Throws when called
 * outside an <IssueReporterProvider> — that's a programming error,
 * not a runtime fallback path.
 */
export function useIssueReporterConfig(): ResolvedConfig {
  const ctx = useContext(IssueReporterConfigContext);
  if (!ctx) {
    throw new Error(
      '[issue-reporter] useIssueReporterConfig() called outside <IssueReporterProvider>. ' +
        'Wrap your app (or the subtree that renders the reporter) in <IssueReporterProvider config={...}>.',
    );
  }
  return ctx;
}
