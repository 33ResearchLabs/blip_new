/** @type {import('next').NextConfig} */
const REMOTE_API = process.env.NEXT_PUBLIC_REMOTE_API || 'https://scan.blip.money';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // When no local DATABASE_URL is configured, proxy /api/* to the live
    // BlipScan deployment so the UI shows real production data.
    if (process.env.DATABASE_URL) return { beforeFiles: [], afterFiles: [], fallback: [] };
    return {
      beforeFiles: [
        { source: '/api/:path*', destination: `${REMOTE_API}/api/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

module.exports = nextConfig;
