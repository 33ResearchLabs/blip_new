/**
 * Type declarations for productionEnvGuard.js (CommonJS — runs from
 * server.js BEFORE Next.js transpile).
 */

export interface SecurityEnvFailure {
  name: string;
  expected: string;
  actual: string | null;
  reason: string;
}

export interface SecurityEnvCheckResult {
  ok: boolean;
  failures: SecurityEnvFailure[];
  skipped?: boolean;
}

export type SecurityEnvCheckMode = 'enforce' | 'warn';

export interface SecurityEnvLogger {
  info?: (m: string) => void;
  warn?: (m: string) => void;
  error?: (m: string) => void;
}

export interface AssertOptions {
  mode?: SecurityEnvCheckMode;
  logger?: SecurityEnvLogger;
  env?: Record<string, string | undefined>;
}

export const REQUIRED_VARS: ReadonlyArray<{
  readonly name: string;
  readonly expected: string;
  readonly reason: string;
}>;

export function checkProductionSecurityEnv(
  env?: Record<string, string | undefined>
): SecurityEnvCheckResult;

export function assertProductionSecurityEnv(
  opts?: AssertOptions
): SecurityEnvCheckResult;
