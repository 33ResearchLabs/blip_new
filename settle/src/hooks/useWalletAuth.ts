import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  generateLoginMessage,
  requestWalletSignature,
  authenticateWithWallet,
  setUsername as setUsernameAPI,
} from '@/lib/auth/walletAuth';

interface User {
  id: string;
  username: string;
  wallet_address: string;
  name?: string;
  rating?: number;
  total_trades?: number;
}

export function useWalletAuth() {
  const { publicKey, signMessage } = useWallet();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string>('');
  const [currentSignature, setCurrentSignature] = useState<string>('');

  /**
   * Authenticate with wallet signature
   * Returns user data if successful, or triggers username modal if needed
   */
  const authenticate = useCallback(async (): Promise<{
    success: boolean;
    user?: User;
    needsUsername?: boolean;
    error?: string;
  }> => {
    if (!publicKey || !signMessage) {
      return {
        success: false,
        error: 'Please connect your wallet first',
      };
    }

    setIsAuthenticating(true);
    setAuthError(null);

    try {
      const walletAddress = publicKey.toBase58();

      // Generate message to sign
      const message = generateLoginMessage(walletAddress);
      setCurrentMessage(message);

      // Request signature
      const signature = await requestWalletSignature(signMessage, message);
      setCurrentSignature(signature);

      // Authenticate with API
      const result = await authenticateWithWallet(walletAddress, signature, message);

      if (!result.success) {
        setAuthError(result.error || 'Authentication failed');
        setIsAuthenticating(false);
        return result;
      }

      // Check if username is needed
      if (result.needsUsername) {
        setShowUsernameModal(true);
        setIsAuthenticating(false);
        return {
          success: true,
          needsUsername: true,
        };
      }

      // Success - user has username
      setIsAuthenticating(false);
      return {
        success: true,
        user: result.user,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      setAuthError(errorMessage);
      setIsAuthenticating(false);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }, [publicKey, signMessage]);

  /**
   * Set username for first-time users
   */
  const setUsername = useCallback(async (username: string): Promise<{
    success: boolean;
    user?: User;
    error?: string;
  }> => {
    if (!publicKey || !signMessage) {
      return {
        success: false,
        error: 'Please connect your wallet first',
      };
    }

    try {
      const walletAddress = publicKey.toBase58();

      // Generate new message and signature for username setting
      const message = generateLoginMessage(walletAddress);
      const signature = await requestWalletSignature(signMessage, message);

      // Set username via API
      const result = await setUsernameAPI(walletAddress, signature, message, username);

      if (!result.success) {
        return result;
      }

      // Close modal on success
      setShowUsernameModal(false);
      return {
        success: true,
        user: result.user,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to set username';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }, [publicKey, signMessage]);

  /**
   * Close username modal (if user cancels)
   */
  const closeUsernameModal = useCallback(() => {
    setShowUsernameModal(false);
  }, []);

  return {
    authenticate,
    setUsername,
    showUsernameModal,
    closeUsernameModal,
    isAuthenticating,
    authError,
    walletAddress: publicKey?.toBase58() || null,
  };
}
