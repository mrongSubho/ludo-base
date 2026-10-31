/**
 * scripts/wrangler-guard.test.ts
 *
 * Security gate test verifying wrangler.jsonc variable rules:
 * - Must strictly prefix with NEXT_PUBLIC_
 * - Must not contain forbidden secret keywords
 * - Deep value inspection: no EVM private keys, no service_role JWTs,
 *   no cloud API secret patterns, no PEM private blocks, no mnemonic phrases.
 *
 * Run: npm test (or npx tsx --test scripts/wrangler-guard.test.ts)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  inspectVar,
  inspectWranglerVars,
  stripJsonc,
} from './lib-wrangler-guard.mjs';

const root = join(import.meta.dirname ?? __dirname, '..');
const wranglerPath = join(root, 'wrangler.jsonc');

test('wrangler-guard: current wrangler.jsonc vars passes all security checks', () => {
  assert.ok(existsSync(wranglerPath), 'wrangler.jsonc must exist');
  const raw = readFileSync(wranglerPath, 'utf8');
  const config = JSON.parse(stripJsonc(raw));
  assert.ok(config.vars, 'wrangler.jsonc must contain a vars block');

  const result = inspectWranglerVars(config.vars);
  assert.deepEqual(
    result.errors,
    [],
    `Security violations detected in wrangler.jsonc vars:\n${result.errors.join('\n')}`
  );
  assert.equal(result.valid, true);
});

test('wrangler-guard: rejects keys missing NEXT_PUBLIC_ prefix', () => {
  const errs1 = inspectVar('SUPABASE_SERVICE_ROLE_KEY', 'safe-value');
  assert.ok(errs1.some((e) => e.includes('does not start with NEXT_PUBLIC_')));

  const errs2 = inspectVar('EDGE_SETTLE_PRIVATE_KEY', '0x123');
  assert.ok(errs2.some((e) => e.includes('does not start with NEXT_PUBLIC_')));

  const errs3 = inspectVar('DATABASE_URL', 'postgres://localhost');
  assert.ok(errs3.some((e) => e.includes('does not start with NEXT_PUBLIC_')));
});

test('wrangler-guard: rejects keys with secret/private keywords even with NEXT_PUBLIC_ prefix', () => {
  const badKeys = [
    'NEXT_PUBLIC_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_PRIVATE_KEY',
    'NEXT_PUBLIC_APP_SECRET',
    'NEXT_PUBLIC_DB_PASSWORD',
    'NEXT_PUBLIC_ADMIN_KEY',
    'NEXT_PUBLIC_PASSPHRASE',
    'NEXT_PUBLIC_MNEMONIC',
    'NEXT_PUBLIC_AUTH_TOKEN',
    'NEXT_PUBLIC_ACCESS_TOKEN',
    'NEXT_PUBLIC_SIGNING_KEY',
  ];

  for (const k of badKeys) {
    const errs = inspectVar(k, 'some-safe-looking-val');
    assert.ok(
      errs.some((e) => e.includes('forbidden sensitive keyword')),
      `Expected key "${k}" to be rejected for sensitive keywords, got: ${errs.join(', ')}`
    );
  }
});

test('wrangler-guard: rejects 64-hex EVM private keys in value', () => {
  // With 0x prefix (66 chars total)
  const pk1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const errs1 = inspectVar('NEXT_PUBLIC_TEST_VAR', pk1);
  assert.ok(
    errs1.some((e) => e.includes('64-hex EVM private key signature')),
    `Expected EVM private key to be rejected: ${errs1.join(', ')}`
  );

  // Without 0x prefix (64 hex chars)
  const pk2 = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const errs2 = inspectVar('NEXT_PUBLIC_TEST_VAR', pk2);
  assert.ok(
    errs2.some((e) => e.includes('64-hex EVM private key signature')),
    `Expected EVM private key without 0x to be rejected: ${errs2.join(', ')}`
  );
});

test('wrangler-guard: rejects PEM private key blocks in value', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
  const errs = inspectVar('NEXT_PUBLIC_TEST_KEY', pem);
  assert.ok(errs.some((e) => e.includes('PEM private key block')));
});

test('wrangler-guard: inspects JWT tokens, rejects non-anon roles and accepts anon', () => {
  const makeJwt = (payloadObj: Record<string, unknown>) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
    const sig = 'fakesignature1234567890';
    return `${header}.${payload}.${sig}`;
  };

  // Anon JWT (should pass)
  const anonJwt = makeJwt({ role: 'anon', iss: 'supabase' });
  const anonErrs = inspectVar('NEXT_PUBLIC_ANON_TOKEN', anonJwt);
  assert.deepEqual(anonErrs, []);

  // Service role JWT (must fail)
  const serviceJwt = makeJwt({ role: 'service_role', iss: 'supabase' });
  const serviceErrs = inspectVar('NEXT_PUBLIC_SERVICE_TOKEN_FAKE_NAME', serviceJwt);
  assert.ok(
    serviceErrs.some((e) => e.includes('privileged role "service_role"')),
    `Expected service_role JWT to fail: ${serviceErrs.join(', ')}`
  );

  // Admin JWT (must fail)
  const adminJwt = makeJwt({ role: 'supabase_admin', iss: 'supabase' });
  const adminErrs = inspectVar('NEXT_PUBLIC_ADMIN_TOKEN_FAKE_NAME', adminJwt);
  assert.ok(
    adminErrs.some((e) => e.includes('privileged role "supabase_admin"')),
    `Expected supabase_admin JWT to fail: ${adminErrs.join(', ')}`
  );
});

test('wrangler-guard: rejects known cloud provider secret patterns in value', () => {
  // Construct dummy test tokens at runtime to prevent false positives in GitHub Push Protection
  const dummyAws = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  const dummyOpenAi = ['sk-proj-', 'abcdef1234567890abcdef1234567890'].join('');
  const dummyGhp = ['ghp_', '1234567890abcdef1234567890abcdef1234'].join('');
  const dummyStripe = ['sk', 'live', '1234567890abcdef12345678'].join('_');

  assert.ok(
    inspectVar('NEXT_PUBLIC_AWS_ID', dummyAws).some((e) => e.includes('AWS Access Key ID'))
  );
  assert.ok(
    inspectVar('NEXT_PUBLIC_OPENAI_KEY', dummyOpenAi).some((e) => e.includes('OpenAI Secret Key'))
  );
  assert.ok(
    inspectVar('NEXT_PUBLIC_GITHUB_PAT', dummyGhp).some((e) => e.includes('GitHub Access Token'))
  );
  assert.ok(
    inspectVar('NEXT_PUBLIC_STRIPE_KEY', dummyStripe).some((e) => e.includes('Stripe Live Secret Key'))
  );
});

test('wrangler-guard: rejects BIP-39 mnemonic seed phrase patterns in value', () => {
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const errs = inspectVar('NEXT_PUBLIC_SEED', phrase);
  assert.ok(errs.some((e) => e.includes('seed phrase pattern')));
});

test('wrangler-guard: allows legitimate public variables and addresses', () => {
  // Standard EVM contract addresses (20 bytes = 40 hex chars, length 42 with 0x)
  assert.deepEqual(
    inspectVar('NEXT_PUBLIC_CHIPS_ADDRESS', '0xB200000000000000000000821408122b9Ed3d05B'),
    []
  );

  // Public URLs and WebSocket endpoints
  assert.deepEqual(
    inspectVar('NEXT_PUBLIC_SUPABASE_URL', 'https://xvwaqxqyjtlsuijgwozi.supabase.co'),
    []
  );
  assert.deepEqual(
    inspectVar('NEXT_PUBLIC_EDGE_SERVER_URL', 'wss://ludo-edge-server.onrender.com'),
    []
  );

  // VAPID public key
  assert.deepEqual(
    inspectVar('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BLKZUPgz1lB2ZFUv60t_BjJ7t5s2NY0kHAP4VbeF0CbMRz1u-ugyopRhIS76Z_0nFkFPNE7h_jAwidYxs07kvI4'),
    []
  );

  // Feature flags
  assert.deepEqual(inspectVar('NEXT_PUBLIC_WALLET_INGAME', '1'), []);
  assert.deepEqual(inspectVar('NEXT_PUBLIC_CDP_AUTH', '0'), []);
});
