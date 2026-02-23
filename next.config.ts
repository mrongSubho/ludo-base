import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack needs this to be empty to stop complaining
  turbopack: {},

  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
  // In Next 16, these are moved or handled differently, 
  // but keeping them inside the object usually works if --webpack flag is used
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;