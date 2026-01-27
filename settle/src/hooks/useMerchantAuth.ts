import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  generateLoginMessage,
  requestWalletSignature,
  authenticateMerchantWithWallet,
  createMerchantAccount,
} from '@/lib/auth/walletAuth';

interface Merchant {
  id: string;
  username: string;
  wallet_address: string;
  display_name: string;
  business_name: string;
  rating?: number;
  total_trades?: number;
}

export function useMerchantAuth() {
  const { publicKey, signMessage } = useWallet();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [isNewMerchant, setIsNewMerchant] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  /**
   * Authenticate merchant with wallet signature
   */
  const authenticate = useCallback(async (): Promise<{
    success: boolean;
    merchant?: Merchant;
    isNewMerchant?: boolean;
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

      // Request signature
      const signature = await requestWalletSignature(signMessage, message);

      // Authenticate with API
      const result = await authenticateMerchantWithWallet(walletAddress, signature, message);

      if (!result.success) {
        setAuthError(result.error || 'Authentication failed');
        setIsAuthenticating(false);
        return result;
      }

      // Check if this is a new merchant
      if (result.isNewMerchant) {
        setIsNewMerchant(true);
        setShowUsernameModal(true);
        setIsAuthenticating(false);
        return {
          success: true,
          isNewMerchant: true,
          needsUsername: true,
        };
      }

      // Check if existing merchant needs username
      if (result.needsUsername) {
        setIsNewMerchant(false);
        setShowUsernameModal(true);
        setIsAuthenticating(false);
        return {
          success: true,
          needsUsername: true,
        };
      }

      // Success - merchant authenticated
      setIsAuthenticating(false);
      return {
        success: true,
        merchant: result.merchant,
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
   * Create merchant account with username
   */
  const createMerchant = useCallback(async (username: string): Promise<{
    success: boolean;
    merchant?: Merchant;
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

      // Generate new message and signature
      const message = generateLoginMessage(walletAddress);
      const signature = await requestWalletSignature(signMessage, message);

      // Create merchant account
      const result = await createMerchantAccount(walletAddress, signature, message, username);

      if (!result.success) {
        return result;
      }

      // Close modal on success
      setShowUsernameModal(false);
      return {
        success: true,
        merchant: result.merchant,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create merchant account';
      return {
        success: false,
        error: errorMessage,
      };
    }
  }, [publicKey, signMessage]);

  /**
   * Close username modal
   */
  const closeUsernameModal = useCallback(() => {
    setShowUsernameModal(false);
    setIsNewMerchant(false);
  }, []);

  return {
    authenticate,
    createMerchant,
    showUsernameModal,
    closeUsernameModal,
    isNewMerchant,
    isAuthenticating,
    authError,
    walletAddress: publicKey?.toBase58() || null,
  };
}
