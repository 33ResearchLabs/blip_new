/**
 * Release a stuck on-chain escrow for a specific Trade PDA.
 *
 * Context: `orders.release_tx_hash` was getting fake "server-release-fallback-<ts>"
 * values when the on-chain release_escrow call failed — DB flipped to `completed`
 * but the real on-chain Trade stayed in PaymentSent with funds locked in the
 * vault. That frontend fallback has been removed (see useOrderActions.ts) and
 * the backend now rejects non-base58 tx_hash (escrow/route.ts schema). This
 * script resolves any leftover stuck trades by issuing a real on-chain release
 * signed by either the `creator` or `counterparty` (whichever keypair you
 * provide) — the only signers the deployed program accepts.
 *
 * Usage:
 *   SIGNER_SECRET_B58='<base58 secret key>' \
 *   tsx scripts/release-stuck-trade.ts <trade_pda> [--order-id <uuid>]
 *
 * Getting the secret key for the test wallets (dev only):
 *   1. Browser DevTools > Application > Local Storage > localhost:3000
 *   2. Copy the value of `blip_wallet_session` (base58-encoded secret key,
 *      only present while the embedded wallet is unlocked).
 *   3. Paste as SIGNER_SECRET_B58 env var.
 *
 * What it does:
 *   - derives Trade/Escrow/VaultAuthority PDAs
 *   - fetches on-chain Trade state to confirm creator, counterparty, mint, amount
 *   - asserts the signer pubkey is creator OR counterparty (fails otherwise)
 *   - builds + submits `release_escrow` via the v2 program
 *   - prints the real Solana signature
 *   - OPTIONAL: if --order-id is supplied, updates orders.release_tx_hash with
 *     the real signature (overwriting any previous ghost "server-release-fallback-...")
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { Client as PgClient } from 'pg';

import {
  findEscrowPda,
  findProtocolConfigPda,
  findVaultAuthorityPda,
} from '../src/lib/solana/v2/pdas';
import { BLIP_V2_PROGRAM_ID, getFeeTreasury } from '../src/lib/solana/v2/config';
import { convertIdlToAnchor29 } from '../src/lib/solana/idlConverter';

// Load the same IDL the app uses.
const idlPath = resolvePath(__dirname, '../src/lib/solana/v2/idl.json');
const idlRaw = JSON.parse(readFileSync(idlPath, 'utf8'));

function parseArgs(argv: string[]): { tradePda: string; orderId?: string } {
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length < 1) {
    console.error('Usage: tsx scripts/release-stuck-trade.ts <trade_pda> [--order-id <uuid>]');
    process.exit(2);
  }
  const tradePda = positional[0];
  const idx = argv.indexOf('--order-id');
  const orderId = idx >= 0 ? argv[idx + 1] : undefined;
  return { tradePda, orderId };
}

function loadSigner(): Keypair {
  const raw = process.env.SIGNER_SECRET_B58;
  if (!raw) {
    console.error('SIGNER_SECRET_B58 env var is required (base58-encoded 64-byte secret key).');
    process.exit(2);
  }
  try {
    const bytes = bs58.decode(raw.trim());
    if (bytes.length !== 64) {
      throw new Error(`expected 64-byte secret key, got ${bytes.length}`);
    }
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    console.error('Failed to parse SIGNER_SECRET_B58:', (e as Error).message);
    process.exit(2);
  }
}

function rpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    'https://api.devnet.solana.com'
  );
}

async function main() {
  const { tradePda: tradePdaStr, orderId } = parseArgs(process.argv.slice(2));
  const signer = loadSigner();
  const tradePda = new PublicKey(tradePdaStr);
  const connection = new Connection(rpcUrl(), 'confirmed');

  // Build a provider/program using the same IDL shim the app uses.
  const provider = new AnchorProvider(
    connection,
    // Only publicKey is used for reads; sign* intentionally throws.
    {
      publicKey: signer.publicKey,
      signTransaction: async () => {
        throw new Error('provider should not be used to sign; we sign manually');
      },
      signAllTransactions: async () => {
        throw new Error('provider should not be used to sign; we sign manually');
      },
    } as unknown as AnchorProvider['wallet'],
    { commitment: 'confirmed' },
  );
  const program = new Program(
    convertIdlToAnchor29(idlRaw) as unknown as Idl,
    BLIP_V2_PROGRAM_ID,
    provider,
  );

  // ---- Fetch Trade to verify signer authority and extract fields ----
  const tradeAcct = await connection.getAccountInfo(tradePda, 'confirmed');
  if (!tradeAcct) throw new Error(`Trade PDA not found on-chain: ${tradePda.toBase58()}`);
  const data = tradeAcct.data;
  // Layout: 8 disc + 32 creator + 32 cp + 8 tid + 32 mint + 8 amount + 1 status
  const creator = new PublicKey(data.subarray(8, 40));
  const counterparty = new PublicKey(data.subarray(40, 72));
  const mint = new PublicKey(data.subarray(80, 112));
  const amountRaw = data.readBigUInt64LE(112);
  const status = data[120];

  console.log('[release-stuck] Trade on-chain state:');
  console.log('  trade       :', tradePda.toBase58());
  console.log('  creator     :', creator.toBase58());
  console.log('  counterparty:', counterparty.toBase58());
  console.log('  mint        :', mint.toBase58());
  console.log('  amount      :', Number(amountRaw) / 1_000_000, 'USDT');
  console.log('  status byte :', status, '(1=Locked, 3=PaymentSent expected)');
  console.log('  signer      :', signer.publicKey.toBase58());

  const isCreator = signer.publicKey.equals(creator);
  const isCounterparty = signer.publicKey.equals(counterparty);
  if (!isCreator && !isCounterparty) {
    throw new Error(
      `Signer ${signer.publicKey.toBase58()} is neither creator nor counterparty; deployed program rejects.`,
    );
  }
  console.log(`[release-stuck] Signer authorized as ${isCreator ? 'creator' : 'counterparty'}.`);

  // ---- Derive accounts for release_escrow ----
  const [escrowPda] = findEscrowPda(tradePda);
  const [vaultAuthority] = findVaultAuthorityPda(escrowPda);
  const [protocolConfigPda] = findProtocolConfigPda();
  const vaultAta = await getAssociatedTokenAddress(mint, vaultAuthority, true);
  const counterpartyAta = await getAssociatedTokenAddress(mint, counterparty);
  const treasury = getFeeTreasury();
  const treasuryAta = await getAssociatedTokenAddress(mint, treasury);

  console.log('[release-stuck] Derived accounts:');
  console.log('  escrow          :', escrowPda.toBase58());
  console.log('  vault_authority :', vaultAuthority.toBase58());
  console.log('  vault_ata       :', vaultAta.toBase58());
  console.log('  counterparty_ata:', counterpartyAta.toBase58());
  console.log('  treasury_ata    :', treasuryAta.toBase58());

  // ---- Build + submit release_escrow ----
  const ix = await (program.methods as any)
    .releaseEscrow()
    .accounts({
      signer: signer.publicKey,
      protocolConfig: protocolConfigPda,
      trade: tradePda,
      escrow: escrowPda,
      vaultAuthority,
      vaultAta,
      counterpartyAta,
      treasuryAta,
      creator,
      mint,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = signer.publicKey;
  tx.sign(signer);

  console.log('[release-stuck] Submitting release_escrow...');
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error(`Release tx failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }
  console.log('[release-stuck] Released. signature =', sig);

  // ---- Optionally correct orders.release_tx_hash in the DB ----
  if (orderId) {
    const connUrl =
      process.env.DATABASE_URL ||
      `postgres://${process.env.DB_USER || 'zeus'}:@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'settle'}`;
    const pg = new PgClient({ connectionString: connUrl });
    await pg.connect();
    try {
      const { rows } = await pg.query<{ release_tx_hash: string | null }>(
        'SELECT release_tx_hash FROM orders WHERE id = $1',
        [orderId],
      );
      if (rows.length === 0) {
        console.warn(`[release-stuck] No DB order ${orderId}; skipping DB update.`);
      } else {
        // Flip status → completed in the same statement. Guard with a
        // WHERE clause on the terminal-able statuses so a follow-up
        // reconciler re-run that already moved the row elsewhere (e.g.
        // admin manually set it) doesn't get clobbered. We bump
        // order_version to keep optimistic-lock callers happy.
        const res = await pg.query(
          `UPDATE orders
              SET release_tx_hash = $1,
                  status         = 'completed',
                  completed_at   = NOW(),
                  updated_at     = NOW(),
                  order_version  = COALESCE(order_version, 1) + 1
            WHERE id = $2
              AND status IN ('payment_sent', 'payment_confirmed', 'releasing', 'escrowed')
            RETURNING status`,
          [sig, orderId],
        );
        if (res.rowCount === 0) {
          // Status wasn't in a flip-able state — still store the tx hash
          // so the real signature is recorded, but leave status alone.
          await pg.query(
            `UPDATE orders
                SET release_tx_hash = $1,
                    updated_at = NOW()
              WHERE id = $2`,
            [sig, orderId],
          );
          console.log(
            `[release-stuck] DB order ${orderId}: release_tx_hash ${rows[0].release_tx_hash} → ${sig} (status NOT flipped; left at current value)`,
          );
        } else {
          console.log(
            `[release-stuck] DB order ${orderId}: release_tx_hash ${rows[0].release_tx_hash} → ${sig}; status → completed`,
          );
        }
      }
    } finally {
      await pg.end();
    }
  }

  console.log('[release-stuck] Done.');
}

main().catch((err) => {
  console.error('[release-stuck] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
