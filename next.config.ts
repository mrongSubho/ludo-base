import type { NextConfig } from "next";
import { execSync } from 'child_process';

const getGitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (_e) {
    return 'unknown';
  }
};

// Monotonic per-commit build number → PATCH in lib/version.ts (v0.1.N-beta).
const getBuildNumber = () => {
  try {
    return execSync('git rev-list --count HEAD').toString().trim();
  } catch (_e) {
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
        // Documents must never be served stale from a cache. In-app webviews
        // (Farcaster/X/Coinbase) happily reuse a cached HTML shell, which pins
        // the old hashed CSS/JS and makes a shipped fix look like a no-op.
        // Hashed build assets, API routes and files stay cacheable.
        source: '/:path((?!_next/|api/|.*\\.[^/]+$).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, max-age=0',
          },
        ],
      },
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