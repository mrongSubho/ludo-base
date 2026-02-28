import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Turbopack needs this to stay quiet
  turbopack: {
    root: ".",
  },

  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },

  // Next 16 might still want these here if using --webpack, 
  // but if the warning persists, you can remove the eslint block entirely.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;