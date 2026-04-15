import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // TypeScript errors MUST be fixed — do not set ignoreBuildErrors: true
  // Dev-lock flag: set DEV_LOCK_ENABLED=true as a separate env var.
  // The actual password stays in DEV_ACCESS_PASSWORD (Node.js API routes only).
  env: {
    DEV_LOCK_ENABLED: process.env.DEV_LOCK_ENABLED || (process.env.DEV_ACCESS_PASSWORD ? 'true' : ''),
  },
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
    silent: !process.env.CI,
    // Automatically tree-shake Sentry logger statements to reduce bundle size
    disableLogger: true,
    // Source map upload: set SENTRY_AUTH_TOKEN (and optionally SENTRY_ORG /
    // SENTRY_PROJECT) to get readable stack traces in production. Safe to
    // leave unset in dev — source maps still work locally via the bundler.
    authToken: process.env.SENTRY_AUTH_TOKEN,
    // Upload a wider set of client files so production stack traces resolve
    // to real filenames more often.
    widenClientFileUpload: true,
    // Create a proxy route at /monitoring so ad-blockers can't drop the
    // Sentry beacon. Remember to exclude '/monitoring' from any middleware
    // that requires auth.
    tunnelRoute: "/monitoring",
  });
} catch {
  // @sentry/nextjs not installed — skip Sentry wrapper
}

export default exportedConfig;
