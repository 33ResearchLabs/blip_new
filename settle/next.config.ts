import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript errors MUST be fixed — do not set ignoreBuildErrors: true
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'api.dicebear.com' },
    ],
  },
  experimental: {
    optimizePackageImports: ['framer-motion', '@solana/web3.js', 'lucide-react'],
  },
};

// Wrap with Sentry if @sentry/nextjs is installed
let exportedConfig: NextConfig = nextConfig;
try {
  const { withSentryConfig } = require("@sentry/nextjs");
  exportedConfig = withSentryConfig(nextConfig, {
    // Suppresses source map upload logs during build
    silent: true,
    // Automatically tree-shake Sentry logger statements to reduce bundle size
    disableLogger: true,
  });
} catch {
  // @sentry/nextjs not installed — skip Sentry wrapper
}

export default exportedConfig;
