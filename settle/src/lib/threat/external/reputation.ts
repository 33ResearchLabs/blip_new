// External-reputation orchestrator. Runs all configured external lookups
// (IPQS, HIBP) in parallel via Promise.allSettled so a slow / failed source
// can never block the others. Each lookup individually returns null on
// failure; this wrapper aggregates those nulls into a single result shape.
//
// Phase B scope: IPQS + HIBP only. Sift (Phase H) plugs into the same shape.

import { checkIp, type IpqsResult } from './ipqs';
import { checkEmail, type HibpResult } from './hibp';

export interface ExternalSignals {
  ipqs: IpqsResult | null;
  hibp: HibpResult | null;
}

export interface ExternalSignalsRequest {
  ip: string | null;
  email: string | null;
}

/**
 * Run all enabled external lookups for an actor in parallel. Always
 * resolves — individual sources that error / time out / have no API key
 * just return null. Never throws to callers.
 */
export async function getExternalSignals(
  req: ExternalSignalsRequest,
): Promise<ExternalSignals> {
  const settled = await Promise.allSettled([
    checkIp(req.ip),
    checkEmail(req.email),
  ]);

  return {
    ipqs: settled[0].status === 'fulfilled' ? settled[0].value : null,
    hibp: settled[1].status === 'fulfilled' ? settled[1].value : null,
  };
}
