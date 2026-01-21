/**
 * Disable Wallet Standard auto-detection
 *
 * This script must run BEFORE any wallet extensions register themselves.
 * It blocks the Wallet Standard API to prevent StandardWalletAdapter instances.
 */

(function() {
  'use strict';

  console.log('[Wallet Standard Blocker] Disabling Wallet Standard API...');

  // Block the Wallet Standard registration
  if (typeof window !== 'undefined') {
    // Override the Wallet Standard registration functions
    Object.defineProperty(window, 'solana', {
      get: function() {
        // Return undefined to prevent Wallet Standard detection
        return undefined;
      },
      set: function() {
        // Ignore attempts to set
      },
      configurable: false
    });

    console.log('[Wallet Standard Blocker] ✅ Wallet Standard API blocked');
  }
})();
