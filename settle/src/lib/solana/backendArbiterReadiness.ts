/**
 * Backend Arbiter Readiness — startup + per-use validation that the backend
 * arbiter is actually safe to settle disputes with.
 *
 * The finalize route only enters the backend-settlement path when BOTH the
 * feature flag is on AND this validation passes. If anything is wrong (key
 * missing/invalid, RPC unreachable, wrong program, ArbiterSet absent, or the
 * arbiter not registered on-chain) we report NOT READY — the route then falls
 * back to the human-wallet path and never finalizes through the backend. The
 * app keeps running.
 *
 * SECURITY: only the arbiter PUBLIC key is ever read or logged here — never the
 * secret. Validation runs server-side only.
 */

import { PublicKey } from '@solana/web3.js';
import { getArbiterKeypair, isBackendArbiterEnabled } from './backendArbiter';
import { getBackendConnection } from './backendSigner';
import { getV2ProgramId, isMainnetActive } from './v2/config';
import { logger } from '@/lib/logger';

export interface ArbiterReadiness {
  ready: boolean;
  reason?: string;
  arbiterPubkey?: string;
  programId?: string;
  network?: string;
  arbiterCount?: number;
}

// Cache only a POSITIVE result. While NOT ready we re-check each call so the
// route self-heals once registration lands (no process restart required).
let cachedReady: ArbiterReadiness | null = null;

function currentNetwork(): string {
  return process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
}

/** Parse the on-chain ArbiterSet account → registered arbiter pubkeys. */
function parseArbiterSet(data: Buffer): string[] {
  // 8 disc | authority 32 | arbiters[10]*32 | count u8 | bump u8
  const count = data.readUInt8(8 + 32 + 320);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const off = 40 + i * 32;
    out.push(new PublicKey(data.subarray(off, off + 32)).toBase58());
  }
  return out;
}

async function runValidation(): Promise<ArbiterReadiness> {
  const network = currentNetwork();

  if (!isBackendArbiterEnabled()) {
    return { ready: false, reason: 'BACKEND_ARBITER_ENABLED is not true', network };
  }

  const keypair = getArbiterKeypair();
  if (!keypair) {
    return { ready: false, reason: 'arbiter keypair not configured (BACKEND_ARBITER_KEYPAIR)', network };
  }
  const arbiterPubkey = keypair.publicKey.toBase58();
  const programId = getV2ProgramId();
  const base = { arbiterPubkey, programId: programId.toBase58(), network };

  try {
    const conn = getBackendConnection();

    // Program must exist and be executable on the connected cluster.
    const progInfo = await conn.getAccountInfo(programId);
    if (!progInfo || !progInfo.executable) {
      return { ...base, ready: false, reason: `program ${base.programId} not found/executable on ${network}` };
    }

    // ArbiterSet PDA must exist (set_arbiters has been run on this cluster).
    const [arbiterSetPda] = PublicKey.findProgramAddressSync([Buffer.from('arbiter-set')], programId);
    const setInfo = await conn.getAccountInfo(arbiterSetPda);
    if (!setInfo) {
      return { ...base, ready: false, reason: 'ArbiterSet PDA does not exist (set_arbiters never run on this cluster)' };
    }

    // The backend arbiter must be a registered member.
    const arbiters = parseArbiterSet(setInfo.data);
    if (!arbiters.includes(arbiterPubkey)) {
      return { ...base, ready: false, reason: 'backend arbiter is NOT registered in the on-chain ArbiterSet', arbiterCount: arbiters.length };
    }

    return { ...base, ready: true, arbiterCount: arbiters.length };
  } catch (err) {
    return { ...base, ready: false, reason: `validation RPC error: ${(err as Error).message}` };
  }
}

/** Validate readiness. Returns a cached positive result; re-checks when not ready. */
export async function validateBackendArbiterReadiness(force = false): Promise<ArbiterReadiness> {
  if (cachedReady?.ready && !force) return cachedReady;
  const result = await runValidation();
  if (result.ready) cachedReady = result;
  return result;
}

/** Gate used by the finalize route — true only when backend settlement is safe. */
export async function ensureBackendArbiterReady(): Promise<boolean> {
  try {
    return (await validateBackendArbiterReadiness()).ready;
  } catch {
    return false; // fail closed
  }
}

/** Startup log. Skips RPC entirely when the feature is disabled. */
export async function logBackendArbiterReadinessAtStartup(): Promise<void> {
  if (!isBackendArbiterEnabled()) {
    logger.info('[BackendArbiter] disabled (BACKEND_ARBITER_ENABLED != true) — backend settlement OFF, human-wallet flow active');
    return;
  }
  if (isMainnetActive()) {
    // Phase 3 is devnet-only. Loudly refuse to arm on mainnet.
    logger.error('[BackendArbiter] BACKEND_ARBITER_ENABLED is on but network is MAINNET — backend settlement must not be armed on mainnet yet (Phase 3 is devnet-only)');
  }
  const r = await validateBackendArbiterReadiness(true);
  if (r.ready) {
    logger.info('[BackendArbiter] READY — backend dispute settlement armed', {
      arbiter: r.arbiterPubkey, programId: r.programId, network: r.network, arbiterCount: r.arbiterCount,
    });
  } else {
    logger.error('[BackendArbiter] NOT READY — backend settlement DISABLED, falling back to human-wallet flow', {
      reason: r.reason, arbiter: r.arbiterPubkey, programId: r.programId, network: r.network,
    });
  }
}
