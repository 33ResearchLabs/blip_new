/**
 * Keypair Wallet Adapter
 * Wraps a Solana Keypair into the wallet interface expected by AnchorProvider
 * Compatible with: new AnchorProvider(connection, adapter, opts)
 */

import { Keypair, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';

export interface WalletAdapter {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

export function createKeypairWalletAdapter(keypair: Keypair): WalletAdapter {
  return {
    publicKey: keypair.publicKey,

    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof Transaction) {
        tx.partialSign(keypair);
      }
      return tx;
    },

    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      for (const tx of txs) {
        if (tx instanceof Transaction) {
          tx.partialSign(keypair);
        }
      }
      return txs;
    },

    async signMessage(message: Uint8Array): Promise<Uint8Array> {
      return nacl.sign.detached(message, keypair.secretKey);
    },
  };
}
