import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This tells Next.js 16 to keep using Webpack instead of Turbopack
  // so it can read our custom aliases below
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");

    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };

    return config;
  },

  // Note: Next.js 16 changed how it handles these flags
  // We'll keep them here, but the error might persist until we push
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;