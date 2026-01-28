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

// Wallet deep link configurations for mobile apps
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
  'Trust Wallet': {
    scheme: 'trust://',
    universal: 'https://link.trustwallet.com/',
    appStoreIOS: 'https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp',
  },
  'Coinbase Wallet': {
    scheme: 'cbwallet://',
    universal: 'https://go.cb-w.com/',
    appStoreIOS: 'https://apps.apple.com/app/coinbase-wallet-nfts-crypto/id1278383455',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=org.toshi',
  },
  Exodus: {
    scheme: 'exodus://',
    universal: 'https://exodus.com/m/',
    appStoreIOS: 'https://apps.apple.com/app/exodus-crypto-bitcoin-wallet/id1414384820',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=exodusmovement.exodus',
  },
  SafePal: {
    scheme: 'safepal://',
    universal: 'https://link.safepal.io/',
    appStoreIOS: 'https://apps.apple.com/app/safepal-wallet/id1548297139',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=io.safepal.wallet',
  },
  TokenPocket: {
    scheme: 'tpoutside://',
    universal: 'https://tokenpocket.pro/',
    appStoreIOS: 'https://apps.apple.com/app/tokenpocket-crypto-defi-wallet/id1436028697',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=vip.mytokenpocket',
  },
  Coin98: {
    scheme: 'coin98://',
    universal: 'https://coin98.com/ul/',
    appStoreIOS: 'https://apps.apple.com/app/coin98-wallet/id1561969966',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=coin98.crypto.finance.media',
  },
  Bitget: {
    scheme: 'bitkeep://',
    universal: 'https://bkcode.vip/',
    appStoreIOS: 'https://apps.apple.com/app/bitget-wallet-ex-bitkeep/id1395301115',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=com.bitkeep.wallet',
  },
  MathWallet: {
    scheme: 'mathwallet://',
    universal: 'https://mathwallet.org/',
    appStoreIOS: 'https://apps.apple.com/app/mathwallet-web3-wallet/id1582612388',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=com.mathwallet.android',
  },
  OKX: {
    scheme: 'okx://',
    universal: 'https://www.okx.com/download',
    appStoreIOS: 'https://apps.apple.com/app/okx-buy-bitcoin-btc-crypto/id1327268470',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=com.okinc.okex.gp',
  },
  Backpack: {
    scheme: 'backpack://',
    universal: 'https://backpack.app/',
    appStoreIOS: 'https://apps.apple.com/app/backpack-crypto-wallet/id6445964121',
    playStoreAndroid: 'https://play.google.com/store/apps/details?id=app.backpack.mobile',
  },
};

// Wallets that support mobile deep links
const MOBILE_SUPPORTED_WALLETS = [
  'Phantom',
  'Solflare',
  'Trust Wallet',
  'Coinbase Wallet',
  'Exodus',
  'SafePal',
  'TokenPocket',
  'Coin98',
  'Bitget',
  'MathWallet',
  'OKX',
  'Backpack',
];

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

  switch (walletName) {
    case 'Phantom':
      // https://docs.phantom.app/phantom-deeplinks/provider-methods/connect
      return `${config.universal}connect?app_url=${appUrl}&redirect_link=${redirect}&cluster=${cluster}`;

    case 'Solflare':
      return `${config.universal}connect?app_url=${appUrl}&redirect_url=${redirect}&cluster=${cluster}`;

    case 'Trust Wallet':
      // Trust Wallet uses WalletConnect, but we can open the app
      return `${config.universal}open_url?coin_id=501&url=${appUrl}`;

    case 'Coinbase Wallet':
      // Coinbase Wallet deep link
      return `${config.universal}dapp?url=${appUrl}`;

    case 'Exodus':
      return `${config.universal}wc?uri=${appUrl}`;

    case 'SafePal':
      return `${config.universal}wc?uri=${appUrl}`;

    case 'TokenPocket':
      return `${config.scheme}open?params=${encodeURIComponent(JSON.stringify({ url: dappUrl }))}`;

    case 'Coin98':
      return `${config.universal}browser?url=${appUrl}`;

    case 'Bitget':
      return `${config.universal}wc?uri=${appUrl}`;

    case 'MathWallet':
      return `${config.universal}dapp?url=${appUrl}`;

    case 'OKX':
      return `${config.universal}?url=${appUrl}`;

    case 'Backpack':
      return `${config.universal}ul/v1/connect?app_url=${appUrl}&redirect_url=${redirect}`;

    default:
      // Generic fallback - try to open browser in wallet
      return `${config.universal}browser?url=${appUrl}`;
  }
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

  switch (walletName) {
    case 'Phantom':
      return `${config.universal}browse/${encodedUrl}`;

    case 'Solflare':
      return `${config.universal}browse?url=${encodedUrl}`;

    case 'Trust Wallet':
      return `${config.universal}open_url?coin_id=501&url=${encodedUrl}`;

    case 'Coinbase Wallet':
      return `${config.universal}dapp?url=${encodedUrl}`;

    case 'Exodus':
    case 'SafePal':
    case 'Bitget':
      return `${config.universal}browser?url=${encodedUrl}`;

    case 'TokenPocket':
      return `${config.scheme}open?params=${encodeURIComponent(JSON.stringify({ url: targetUrl }))}`;

    case 'Coin98':
      return `${config.universal}browser?url=${encodedUrl}`;

    case 'MathWallet':
      return `${config.universal}dapp?url=${encodedUrl}`;

    case 'OKX':
      return `${config.universal}?url=${encodedUrl}`;

    case 'Backpack':
      return `${config.universal}ul/v1/browse?url=${encodedUrl}`;

    default:
      // Generic fallback
      return `${config.universal}browser?url=${encodedUrl}`;
  }
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
    'Trust Wallet': 'https://trustwallet.com/assets/images/favicon.png',
    'Coinbase Wallet': 'https://www.coinbase.com/favicon.ico',
    Exodus: 'https://exodus.com/favicon.ico',
    SafePal: 'https://www.safepal.com/favicon.ico',
    TokenPocket: 'https://tokenpocket.pro/favicon.ico',
    Coin98: 'https://coin98.com/favicon.ico',
    Bitget: 'https://web3.bitget.com/favicon.ico',
    MathWallet: 'https://mathwallet.org/favicon.ico',
    OKX: 'https://www.okx.com/favicon.ico',
    Backpack: 'https://backpack.app/favicon.ico',
  };

  return {
    name: walletName,
    hasDeepLink: true,
    iconUrl: icons[walletName],
  };
}

/**
 * Detect if user is on a mobile device
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Detect the mobile platform
 */
export function getMobilePlatform(): 'ios' | 'android' | null {
  if (typeof window === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return null;
}

/**
 * Check if running inside a wallet's in-app browser
 */
export function isInWalletBrowser(): string | null {
  if (typeof window === 'undefined') return null;

  // Check for Phantom
  if ((window as any).phantom?.solana?.isPhantom) return 'Phantom';

  // Check for Solflare
  if ((window as any).solflare?.isSolflare) return 'Solflare';

  // Check for Trust Wallet
  if ((window as any).trustwallet) return 'Trust Wallet';

  // Check for Coinbase Wallet
  if ((window as any).coinbaseWalletExtension) return 'Coinbase Wallet';

  // Check for Backpack
  if ((window as any).backpack) return 'Backpack';

  // Check for Bitget
  if ((window as any).bitkeep) return 'Bitget';

  // Check for OKX
  if ((window as any).okxwallet) return 'OKX';

  return null;
}
