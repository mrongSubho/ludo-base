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
  // Phase 6 hygiene: trim the client bundle at the import level. react-icons
  // and framer-motion are barrel packages — without this, one icon import
  // pulls every icon. canvas-confetti is single-entry but listed for intent.
  experimental: {
    optimizePackageImports: ['react-icons', 'framer-motion', 'canvas-confetti'],
  },
  // Strip console.* from production builds, keeping error/warn for the
  // telemetry pipeline (captureException paths log through those).
  compiler: {
    removeConsole: {
      exclude: ['error', 'warn'],
    },
  },
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

// Cloudflare Workers local dev: lets `next dev` resolve workerd bindings.
// Inert under `next build` / `next start` / Vercel — only the preview/dev
// path consumes it. (opennext adapter, pinned to Next 16.1.x support.)
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();