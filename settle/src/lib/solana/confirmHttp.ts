import type { Connection, TransactionSignature } from '@solana/web3.js';

/**
 * Poll-based transaction confirmation. web3.js's `confirmTransaction` opens a
 * WebSocket subscription; on mainnet the public WS rejects browser
 * connections and the call hangs forever. This helper uses HTTP-only
 * `getSignatureStatuses` polling so confirmation works regardless of WS
 * availability.
 *
 * Returns the signature on success. Throws on on-chain error, blockhash
 * expiry, or timeout.
 */
export async function confirmHttp(
  connection: Connection,
  signature: TransactionSignature,
  opts: { lastValidBlockHeight?: number; deadlineMs?: number; pollMs?: number } = {},
): Promise<TransactionSignature> {
  const pollMs = opts.pollMs ?? 1500;
  const deadlineMs = opts.deadlineMs ?? 60_000;
  const start = Date.now();

  while (Date.now() - start < deadlineMs) {
    const res = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const s = res?.value?.[0];
    if (s) {
      if (s.err) throw new Error(`on-chain error: ${JSON.stringify(s.err)}`);
      if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') {
        return signature;
      }
    }
    if (opts.lastValidBlockHeight !== undefined) {
      const tip = await connection.getBlockHeight('confirmed').catch(() => null);
      if (tip !== null && tip > opts.lastValidBlockHeight) {
        const final = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
        const fs = final?.value?.[0];
        if (fs && !fs.err && (fs.confirmationStatus === 'confirmed' || fs.confirmationStatus === 'finalized')) {
          return signature;
        }
        throw new Error('blockhash expired before transaction confirmed');
      }
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  throw new Error(`confirmation timed out after ${deadlineMs}ms (signature: ${signature})`);
}
