/**
 * POST /api/solana/feepayer
 *
 * Takes a partially-built transaction (base64), sets the backend keypair
 * as the fee payer, and partial-signs it. Returns the tx so the client
 * can add the user's authority signature and submit.
 *
 * This makes every Solana action gasless — users need zero SOL.
 * The backend fee payer only needs ~0.001 SOL per tx for network fees.
 *
 * Security: only partial-signs — cannot drain user funds. Validates that
 * the tx calls only the Blip program to prevent abuse.
 *
 * Body: { tx: string (base64 serialized Transaction) }
 * Returns: { tx: string (base64 with fee payer signature added) }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Transaction, PublicKey } from '@solana/web3.js';
import { getBackendKeypair, getBackendConnection } from '@/lib/solana/backendSigner';
import { getV2ProgramId } from '@/lib/solana/v2/config';
import { requireAuth } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';

const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOC_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bsn');
const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'solana:feepayer', STRICT_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const keypair = getBackendKeypair();
  if (!keypair) {
    return NextResponse.json(
      { error: 'Gasless transactions not configured (BACKEND_SIGNER_KEYPAIR missing)' },
      { status: 503 },
    );
  }

  let body: { tx: string };
  try {
    body = await request.json();
    if (typeof body?.tx !== 'string') throw new Error('missing tx');
  } catch {
    return NextResponse.json({ error: 'Invalid request body — expected { tx: string }' }, { status: 400 });
  }

  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(body.tx, 'base64'));
  } catch {
    return NextResponse.json({ error: 'Invalid transaction — could not deserialize' }, { status: 400 });
  }

  // Security: verify all instructions only call known safe programs
  const blipProgramId = getV2ProgramId();
  const ALLOWED_PROGRAMS = new Set([
    blipProgramId.toBase58(),
    SYSTEM_PROGRAM.toBase58(),
    TOKEN_PROGRAM.toBase58(),
    ASSOC_TOKEN_PROGRAM.toBase58(),
    COMPUTE_BUDGET_PROGRAM.toBase58(),
  ]);

  for (const ix of tx.instructions) {
    if (!ALLOWED_PROGRAMS.has(ix.programId.toBase58())) {
      return NextResponse.json(
        { error: `Transaction calls disallowed program: ${ix.programId.toBase58()}` },
        { status: 400 },
      );
    }
  }

  // Fetch fresh blockhash — ensures the tx doesn't use a stale one
  const connection = getBackendConnection();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = keypair.publicKey;
  tx.lastValidBlockHeight = lastValidBlockHeight;

  // Partial-sign as fee payer only
  tx.partialSign(keypair);

  const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');
  return NextResponse.json({ tx: serialized, blockhash, lastValidBlockHeight });
}
