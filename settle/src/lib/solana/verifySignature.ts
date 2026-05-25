import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

/**
 * Verify a wallet signature for authentication
 * @param walletAddress - The public key of the wallet
 * @param signature - The signature in base58 format
 * @param message - The original message that was signed
 * @returns true if signature is valid
 */
export async function verifyWalletSignature(
  walletAddress: string,
  signature: string,
  message: string
): Promise<boolean> {
  try {
    // Decode the public key
    const publicKey = new PublicKey(walletAddress);

    // Decode the signature from base58
    const signatureUint8 = bs58.decode(signature);

    // Convert message to Uint8Array
    const messageUint8 = new TextEncoder().encode(message);

    // Verify the signature
    const isValid = nacl.sign.detached.verify(
      messageUint8,
      signatureUint8,
      publicKey.toBytes()
    );

    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Generate a login message for the user to sign
 * @param walletAddress - The wallet address
 * @param nonce - Optional nonce for replay protection
 * @returns The message to sign
 */
export function generateLoginMessage(walletAddress: string, nonce?: string): string {
  const timestamp = Date.now();
  const nonceStr = nonce || Math.random().toString(36).substring(7);

  return `Sign this message to authenticate with Blip Money\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonceStr}`;
}

/**
 * Validate that a message was signed recently (within 5 minutes)
 * @param message - The signed message
 * @returns true if message is recent
 */
export function isMessageRecent(message: string): boolean {
  try {
    const timestampMatch = message.match(/Timestamp: (\d+)/);
    if (!timestampMatch) return false;

    const timestamp = parseInt(timestampMatch[1]);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    return (now - timestamp) < fiveMinutes;
  } catch (error) {
    return false;
  }
}
