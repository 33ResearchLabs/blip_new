'use client';

import { useState, useEffect } from 'react';

export interface MobileDetectResult {
  isMobile: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isBrave: boolean;
  isInAppBrowser: boolean;
  platform: 'ios' | 'android' | 'desktop';
  canUseWalletExtension: boolean;
}

// In-app browser detection patterns
const IN_APP_BROWSERS = [
  'FBAN', 'FBAV', // Facebook
  'Instagram',
  'Twitter',
  'LinkedIn',
  'TikTok',
  'Snapchat',
  'Pinterest',
  'Line',
  'WeChat',
  'MicroMessenger',
];

function detectMobile(): MobileDetectResult {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isMobile: false,
      isIOS: false,
      isAndroid: false,
      isBrave: false,
      isInAppBrowser: false,
      platform: 'desktop',
      canUseWalletExtension: true,
    };
  }

  const ua = navigator.userAgent || '';
  const vendor = navigator.vendor || '';

  // iOS detection
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Android detection
  const isAndroid = /Android/i.test(ua);

  // Mobile detection (includes tablets)
  const isMobile = isIOS || isAndroid || /webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua);

  // Brave browser detection
  const isBrave = !!(navigator as any).brave;

  // In-app browser detection
  const isInAppBrowser = IN_APP_BROWSERS.some(browser => ua.includes(browser));

  // Determine platform
  let platform: 'ios' | 'android' | 'desktop' = 'desktop';
  if (isIOS) platform = 'ios';
  else if (isAndroid) platform = 'android';

  // Can use wallet extension (desktop browsers, not in-app)
  const canUseWalletExtension = !isMobile && !isInAppBrowser;

  return {
    isMobile,
    isIOS,
    isAndroid,
    isBrave,
    isInAppBrowser,
    platform,
    canUseWalletExtension,
  };
}

export function useMobileDetect(): MobileDetectResult {
  const [result, setResult] = useState<MobileDetectResult>(() => detectMobile());

  useEffect(() => {
    // Re-detect on mount (handles SSR hydration)
    setResult(detectMobile());
  }, []);

  return result;
}

// Static helper for non-hook contexts
export function getMobileDetect(): MobileDetectResult {
  return detectMobile();
}
