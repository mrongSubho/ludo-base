#!/usr/bin/env node
/**
 * Build-time environment guard.
 *
 * Why this exists: on 2026-10-23 the Cloudflare Workers Builds pipeline produced
 * a bundle with no CDP project id and no Supabase URL, because the pipeline had
 * no build variables configured. The build logged:
 *
 *   ⚠️ Supabase environment variables are missing. Using placeholders for build.
 *
 * ...and then deployed successfully. The result was a live site with no CDP
 * wallet and no Supabase connection, and nothing on the deploy side said so. A
 * second deploy (mine, with correct env) was then overwritten by the pipeline.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so a missing variable is not
 * a runtime configuration problem — it is baked into the bundle and cannot be
 * fixed without a rebuild. A placeholder build is therefore strictly worse than a
 * failed build: one is silently broken, the other is honest.
 *
 * Runs as part of `npm run build`, which `opennextjs-cloudflare build` invokes
 * (visible in CI logs as `> ludo-base@0.1.0 build`), so this covers both local
 * and pipeline builds.
 *
 * Escape hatch: SKIP_ENV_CHECK=1 for deliberate local experiments.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Required: absence silently breaks wallet sign-in or data access, and the
 * failure is invisible at runtime. Deliberately NOT an exhaustive list — vars
 * with safe defaults (PeerJS, room WS, paymaster) are excluded so this cannot
 * fail a build that would otherwise work.
 */
const REQUIRED = [
  ['NEXT_PUBLIC_SUPABASE_URL', 'Supabase client — no DB, no auth, no realtime'],
  ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'Supabase anon key — no auth'],
  ['NEXT_PUBLIC_CDP_PROJECT_ID', 'OnchainKit CDP — no embedded wallet'],
  ['NEXT_PUBLIC_CDP_AUTH', 'OnchainKit CDP auth — no embedded wallet'],
  ['NEXT_PUBLIC_WC_PROJECT_ID', 'WalletConnect — no external wallets'],
  ['NEXT_PUBLIC_ONCHAINKIT_API_KEY', 'OnchainKit API'],
];

if (process.env.SKIP_ENV_CHECK === '1') {
  console.log('○ build-env check SKIPPED (SKIP_ENV_CHECK=1)');
  process.exit(0);
}

// `.env.local` is not loaded by Next in this context, so read it directly for
// local builds. In CI the variables come from the environment instead.
function fromEnvLocal(key) {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return undefined;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '').trim() || undefined;
  }
  return undefined;
}

const missing = [];
for (const [key, why] of REQUIRED) {
  const value = process.env[key] || fromEnvLocal(key);
  if (!value) missing.push([key, why]);
}

if (missing.length > 0) {
  console.error('✗ build-env check: required NEXT_PUBLIC_* variables are missing\n');
  for (const [key, why] of missing) {
    console.error(`    ${key}`);
    console.error(`      ${why}`);
  }
  console.error('\n  These are inlined at build time, so a missing value is baked into the');
  console.error('  bundle and cannot be fixed without a rebuild. Deploying anyway produces a');
  console.error('  silently broken site — no wallet, no database — which is what happened on');
  console.error('  2026-10-23 when the Workers Builds pipeline had no variables configured.');
  console.error('\n  Fix (Cloudflare dashboard):');
  console.error('    Workers & Pages → ludo-base → Settings → Build → Variables and secrets');
  console.error('\n  Fix (local): add them to .env.local, or SKIP_ENV_CHECK=1 to override.');
  process.exit(1);
}

console.log(`✓ build-env check clean (${REQUIRED.length} required NEXT_PUBLIC_* vars present)`);
