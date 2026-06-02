/**
 * POST /api/solana/prepare-tx
 *
 * Builds any on-chain instruction server-side, sets the backend keypair
 * as feePayer, partial-signs, and returns the serialized tx as base64.
 * The client deserializes, user wallet signs, client submits.
 *
 * This makes every Solana action gasless — users need zero SOL.
 *
 * Body: { action: GaslessAction, params: { ... } }
 * Returns: { tx: string (base64), action: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  getBackendKeypair,
  getBackendConnection,
  getBackendProgram,
} from '@/lib/solana/backendSigner';
import {
  buildCreateTradeTx,
  buildFundEscrowTx,
  buildAcceptTradeTx,
  buildLockEscrowTx,
  buildReleaseEscrowTx,
  buildRefundEscrowTx,
  buildConfirmPaymentTx,
  buildOpenDisputeTx,
} from '@/lib/solana/v2/program';
import { getUsdtMint, getFeeTreasury } from '@/lib/solana/v2/config';
import { findProtocolConfigPda } from '@/lib/solana/v2/pdas';
import { requireAuth, forbiddenResponse, errorResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { TradeSide } from '@/lib/solana/v2/types';

const bodySchema = z.object({
  action: z.enum([
    'createTrade',
    'fundEscrow',
    'acceptTrade',
    'lockEscrow',
    'releaseEscrow',
    'refundEscrow',
    'confirmPayment',
    'openDispute',
  ]),
  params: z.record(z.unknown()),
});

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'prepare-tx', STRICT_LIMIT);
  if (rl) return rl;

  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const keypair = getBackendKeypair();
  if (!keypair) {
    return NextResponse.json(
      { error: 'Gasless transactions not configured (BACKEND_SIGNER_KEYPAIR missing)' },
      { status: 503 },
    );
  }

  const connection = getBackendConnection();
  const program = getBackendProgram();
  if (!program) {
    return NextResponse.json({ error: 'Failed to initialize program' }, { status: 500 });
  }

  const mint = getUsdtMint();
  const p = body.params as Record<string, any>;

  try {
    let tx: Transaction;

    switch (body.action) {
      case 'createTrade': {
        const creator = new PublicKey(p.creator);
        tx = await buildCreateTradeTx(program, creator, mint, {
          tradeId: Number(p.tradeId),
          amount: new BN(p.amount),
          side: p.side === 'buy' ? TradeSide.Buy : TradeSide.Sell,
          feeBps: Number(p.feeBps),
        });
        break;
      }

      case 'fundEscrow': {
        const depositor = new PublicKey(p.depositor);
        const tradePda = new PublicKey(p.tradePda);
        tx = await buildFundEscrowTx(program, depositor, tradePda, mint, {
          escrowDurationSecs: p.escrowDurationSecs ? Number(p.escrowDurationSecs) : null,
        });
        break;
      }

      case 'acceptTrade': {
        const acceptor = new PublicKey(p.acceptor);
        const tradePda = new PublicKey(p.tradePda);
        tx = await buildAcceptTradeTx(program, acceptor, tradePda);
        break;
      }

      case 'lockEscrow': {
        const depositor = new PublicKey(p.depositor);
        const tradePda = new PublicKey(p.tradePda);
        const counterparty = new PublicKey(p.counterparty);
        tx = await buildLockEscrowTx(program, depositor, tradePda, counterparty, mint, {
          escrowDurationSecs: p.escrowDurationSecs ? Number(p.escrowDurationSecs) : null,
        });
        break;
      }

      case 'releaseEscrow': {
        const releaser = new PublicKey(p.releaser);
        const tradePda = new PublicKey(p.tradePda);
        const counterparty = new PublicKey(p.counterparty);
        const [protocolConfigPda] = findProtocolConfigPda();
        const protocolConfig = await program.account.protocolConfig.fetch(protocolConfigPda);
        tx = await buildReleaseEscrowTx(program, releaser, {
          tradePda,
          counterparty,
          mint,
          protocolAuthority: new PublicKey((protocolConfig as any).authority),
        });
        break;
      }

      case 'refundEscrow': {
        const refunder = new PublicKey(p.refunder);
        const tradePda = new PublicKey(p.tradePda);
        const [protocolConfigPda] = findProtocolConfigPda();
        const protocolConfig = await program.account.protocolConfig.fetch(protocolConfigPda);
        tx = await buildRefundEscrowTx(program, refunder, {
          tradePda,
          mint,
          protocolConfigPda,
          protocolAuthority: new PublicKey((protocolConfig as any).authority),
        });
        break;
      }

      case 'confirmPayment': {
        const signer = new PublicKey(p.signer);
        const tradePda = new PublicKey(p.tradePda);
        tx = await buildConfirmPaymentTx(program, signer, { tradePda });
        break;
      }

      case 'openDispute': {
        const signer = new PublicKey(p.signer);
        const tradePda = new PublicKey(p.tradePda);
        tx = await buildOpenDisputeTx(program, signer, { tradePda });
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }

    // Set backend keypair as feePayer — user pays zero SOL
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.lastValidBlockHeight = lastValidBlockHeight;

    // Backend partial-signs (covers the fee payer requirement)
    tx.partialSign(keypair);

    // Return serialized tx — client will add user signature then submit
    const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

    return NextResponse.json({ tx: serialized, action: body.action });
  } catch (err: any) {
    return errorResponse(err?.message || 'Failed to build transaction');
  }
}
