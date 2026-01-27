import bs58 from 'bs58';

/**
 * Generate a login message for the user to sign
 */
export function generateLoginMessage(walletAddress: string): string {
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).substring(7);

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

/**
 * Authenticate user with wallet signature
 */
export async function authenticateWithWallet(
  walletAddress: string,
  signature: string,
  message: string
): Promise<{
  success: boolean;
  user?: any;
  isNewUser?: boolean;
  needsUsername?: boolean;
  error?: string;
}> {
  try {
    const response = await fetch('/api/auth/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'wallet_login',
        wallet_address: walletAddress,
        signature,
        message,
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
 * Set username for first-time users
 */
export async function setUsername(
  walletAddress: string,
  signature: string,
  message: string,
  username: string
): Promise<{
  success: boolean;
  user?: any;
  error?: string;
}> {
  try {
    const response = await fetch('/api/auth/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_username',
        wallet_address: walletAddress,
        signature,
        message,
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
 * Authenticate merchant with wallet signature
 */
export async function authenticateMerchantWithWallet(
  walletAddress: string,
  signature: string,
  message: string
): Promise<{
  success: boolean;
  merchant?: any;
  isNewMerchant?: boolean;
  needsUsername?: boolean;
  error?: string;
}> {
  try {
    const response = await fetch('/api/auth/merchant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'wallet_login',
        wallet_address: walletAddress,
        signature,
        message,
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
 * Create merchant account with username
 */
export async function createMerchantAccount(
  walletAddress: string,
  signature: string,
  message: string,
  username: string
): Promise<{
  success: boolean;
  merchant?: any;
  error?: string;
}> {
  try {
    const response = await fetch('/api/auth/merchant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_merchant',
        wallet_address: walletAddress,
        signature,
        message,
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
