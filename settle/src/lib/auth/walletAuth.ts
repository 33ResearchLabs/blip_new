import bs58 from 'bs58';
import { randomBytes } from 'crypto';

/**
 * @deprecated Client-generated login messages are vulnerable to replay
 * (the server has no record of the nonce so it cannot mark it consumed).
 * Use {@link fetchLoginNonce} → {@link signLoginNonce} instead. Kept exported
 * only for non-auth call sites that rely on the same string format.
 */
export function generateLoginMessage(walletAddress: string): string {
  const timestamp = Date.now();
  const nonce = randomBytes(16).toString('hex');

  return `Sign this message to authenticate with Blip Money\n\nWallet: ${walletAddress}\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
}

/**
 * Request signature from Solana wallet
 * @param signMessage - Function from wallet adapter
 * @param message - Message to sign
 * @returns Base58 encoded signature
 */
export async function requestWalletSignature(
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined,
  message: string
): Promise<string> {
  if (!signMessage) {
    throw new Error('Wallet does not support message signing');
  }

  // Encode message
  const encodedMessage = new TextEncoder().encode(message);

  // Request signature from wallet
  const signature = await signMessage(encodedMessage);

  // Convert to base58
  return bs58.encode(signature);
}

/** Server-issued login nonce + canonical message-to-sign (replay protection). */
export interface LoginNonce {
  nonce: string;
  message: string;
  expiresAt: string;
}

/** Ask the server for a login nonce. The returned `message` is what to sign. */
export async function fetchLoginNonce(walletAddress: string): Promise<LoginNonce> {
  const res = await fetch('/api/auth/nonce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet_address: walletAddress }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success || !json?.data?.nonce || !json?.data?.message) {
    throw new Error(json?.error || 'Failed to obtain login nonce');
  }
  return {
    nonce: json.data.nonce,
    message: json.data.message,
    expiresAt: json.data.expires_at,
  };
}

/**
 * Single entry point for "ask server for nonce, sign it, return everything the
 * auth endpoint needs". Every wallet-signature flow (user / merchant /
 * compliance / link / set_username / wallet update) uses this.
 */
export async function signLoginNonce(
  walletAddress: string,
  signMessage: ((message: Uint8Array) => Promise<Uint8Array>) | undefined,
): Promise<{ nonce: string; message: string; signature: string }> {
  const issued = await fetchLoginNonce(walletAddress);
  const signature = await requestWalletSignature(signMessage, issued.message);
  return { nonce: issued.nonce, message: issued.message, signature };
}

type SignMessageFn = ((message: Uint8Array) => Promise<Uint8Array>) | undefined;

/**
 * Authenticate user with wallet signature.
 *
 * Caller passes the wallet's `signMessage` function; this helper takes care of
 * fetching a server-issued nonce and including it in the POST body. There is
 * no signature-only path: the server requires nonce + signature + timestamp.
 */
export async function authenticateWithWallet(
  walletAddress: string,
  signMessage: SignMessageFn,
): Promise<{
  success: boolean;
  user?: any;
  isNewUser?: boolean;
  needsUsername?: boolean;
  error?: string;
}> {
  try {
    const { nonce, message, signature } = await signLoginNonce(walletAddress, signMessage);
    const response = await fetch('/api/auth/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'wallet_login',
        wallet_address: walletAddress,
        signature,
        message,
        nonce,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
    };
  }
}

/**
 * Set username for first-time users.
 * Same nonce-required contract as `authenticateWithWallet`.
 */
export async function setUsername(
  walletAddress: string,
  signMessage: SignMessageFn,
  username: string,
): Promise<{
  success: boolean;
  user?: any;
  error?: string;
}> {
  try {
    const { nonce, message, signature } = await signLoginNonce(walletAddress, signMessage);
    const response = await fetch('/api/auth/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_username',
        wallet_address: walletAddress,
        signature,
        message,
        nonce,
        username,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Set username error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to set username',
    };
  }
}

/**
 * Authenticate merchant with wallet signature.
 * Same nonce-required contract as `authenticateWithWallet`.
 */
export async function authenticateMerchantWithWallet(
  walletAddress: string,
  signMessage: SignMessageFn,
): Promise<{
  success: boolean;
  merchant?: any;
  isNewMerchant?: boolean;
  needsUsername?: boolean;
  error?: string;
}> {
  try {
    const { nonce, message, signature } = await signLoginNonce(walletAddress, signMessage);
    const response = await fetch('/api/auth/merchant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'wallet_login',
        wallet_address: walletAddress,
        signature,
        message,
        nonce,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Merchant authentication error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed',
    };
  }
}

/**
 * Create merchant account with username.
 * Same nonce-required contract as `authenticateWithWallet`.
 */
export async function createMerchantAccount(
  walletAddress: string,
  signMessage: SignMessageFn,
  username: string,
): Promise<{
  success: boolean;
  merchant?: any;
  error?: string;
}> {
  try {
    const { nonce, message, signature } = await signLoginNonce(walletAddress, signMessage);
    const response = await fetch('/api/auth/merchant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_merchant',
        wallet_address: walletAddress,
        signature,
        message,
        nonce,
        username,
      }),
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Create merchant error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create merchant account',
    };
  }
}
