/**
 * Mobile Wallet Deep Link Utilities
 *
 * Handles opening mobile wallet apps via deep links and universal links
 */

export interface DeepLinkConfig {
  scheme: string;      // e.g., 'phantom://'
  universal: string;   // e.g., 'https://phantom.app/ul/'
  appStoreIOS: string;
  playStoreAndroid: string;
}

// Wallet deep link configurations
const WALLET_DEEP_LINKS: Record<string, DeepLinkConfig> = {
  Phantom: {
    scheme: 'phantom://',
    universal: 'https://phantom.app/ul/v1/',
    appStoreIOS: 'https://apps.apple.com/app/phantom-solana-wallet/id1598432977',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=app.phantom',
  },
  Solflare: {
    scheme: 'solflare://',
    universal: 'https://solflare.com/ul/v1/',
    appStoreIOS: 'https://apps.apple.com/app/solflare/id1580902717',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=com.solflare.mobile',
  },
};

// Wallets that support mobile deep links
const MOBILE_SUPPORTED_WALLETS = ['Phantom', 'Solflare'];

/**
 * Check if a wallet supports mobile deep links
 */
export function hasMobileDeepLink(walletName: string): boolean {
  return MOBILE_SUPPORTED_WALLETS.includes(walletName);
}

/**
 * Get list of wallets that support mobile
 */
export function getMobileSupportedWallets(): string[] {
  return [...MOBILE_SUPPORTED_WALLETS];
}

/**
 * Build a connect deep link URL for a wallet
 */
export function buildConnectDeepLink(
  walletName: string,
  options: {
    dappUrl: string;
    redirectUrl?: string;
    cluster?: 'devnet' | 'mainnet-beta';
  }
): string | null {
  const config = WALLET_DEEP_LINKS[walletName];
  if (!config) return null;

  const { dappUrl, redirectUrl, cluster = 'devnet' } = options;

  // Encode parameters
  const appUrl = encodeURIComponent(dappUrl);
  const redirect = encodeURIComponent(redirectUrl || dappUrl);

  if (walletName === 'Phantom') {
    // Phantom deep link format
    // https://docs.phantom.app/phantom-deeplinks/provider-methods/connect
    return `${config.universal}connect?app_url=${appUrl}&redirect_link=${redirect}&cluster=${cluster}`;
  }

  if (walletName === 'Solflare') {
    // Solflare deep link format
    return `${config.universal}connect?app_url=${appUrl}&redirect_url=${redirect}&cluster=${cluster}`;
  }

  return null;
}

/**
 * Build a browse/dapp deep link URL
 */
export function buildBrowseDeepLink(
  walletName: string,
  targetUrl: string
): string | null {
  const config = WALLET_DEEP_LINKS[walletName];
  if (!config) return null;

  const encodedUrl = encodeURIComponent(targetUrl);

  if (walletName === 'Phantom') {
    return `${config.universal}browse/${encodedUrl}`;
  }

  if (walletName === 'Solflare') {
    return `${config.universal}browse?url=${encodedUrl}`;
  }

  return null;
}

/**
 * Open a wallet's app store page
 */
export function getAppStoreLink(
  walletName: string,
  platform: 'ios' | 'android'
): string | null {
  const config = WALLET_DEEP_LINKS[walletName];
  if (!config) return null;

  return platform === 'ios' ? config.appStoreIOS : config.playStoreAndroid;
}

/**
 * Attempt to open a mobile wallet via deep link
 * Returns true if the link was opened, false if wallet not supported
 */
export function openMobileWallet(
  walletName: string,
  options: {
    dappUrl?: string;
    platform: 'ios' | 'android';
    action?: 'connect' | 'browse';
  }
): boolean {
  const { dappUrl = typeof window !== 'undefined' ? window.location.origin : '', platform, action = 'connect' } = options;

  let deepLink: string | null = null;

  if (action === 'connect') {
    deepLink = buildConnectDeepLink(walletName, {
      dappUrl,
      redirectUrl: typeof window !== 'undefined' ? window.location.href : dappUrl,
    });
  } else if (action === 'browse') {
    deepLink = buildBrowseDeepLink(walletName, dappUrl);
  }

  if (!deepLink) {
    // Wallet doesn't support deep links - try app store
    const storeLink = getAppStoreLink(walletName, platform);
    if (storeLink && typeof window !== 'undefined') {
      window.location.href = storeLink;
      return true;
    }
    return false;
  }

  // Open the deep link
  if (typeof window !== 'undefined') {
    window.location.href = deepLink;
    return true;
  }

  return false;
}

/**
 * Get wallet info for display in mobile UI
 */
export function getMobileWalletInfo(walletName: string): {
  name: string;
  hasDeepLink: boolean;
  iconUrl?: string;
} | null {
  if (!MOBILE_SUPPORTED_WALLETS.includes(walletName)) {
    return null;
  }

  const icons: Record<string, string> = {
    Phantom: 'https://phantom.app/img/phantom-icon-purple.svg',
    Solflare: 'https://solflare.com/favicon.ico',
  };

  return {
    name: walletName,
    hasDeepLink: true,
    iconUrl: icons[walletName],
  };
}
