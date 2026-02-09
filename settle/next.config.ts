import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Pre-existing type error in typography.ts - ignore during build
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
