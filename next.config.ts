import type { NextConfig } from "next";
import { execSync } from 'child_process';

const getGitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (e) {
    return 'unknown';
  }
};

// Monotonic per-commit build number → PATCH in lib/version.ts (v0.1.N-beta).
const getBuildNumber = () => {
  try {
    return execSync('git rev-list --count HEAD').toString().trim();
  } catch (e) {
    return '';
  }
};

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_HASH: getGitHash(),
    NEXT_PUBLIC_BUILD_NUMBER: getBuildNumber(),
  },
  turbopack: {},
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'pino-pretty': false,
      'lokijs': false,
      'encoding': false
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },

  // Full-project `tsc` is clean (see CI). Keep the gate on.
  typescript: {
    ignoreBuildErrors: false,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;