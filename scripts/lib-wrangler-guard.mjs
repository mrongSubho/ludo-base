/**
 * scripts/lib-wrangler-guard.mjs
 *
 * Security guardrail against secret leakage in wrangler.jsonc / wrangler.toml `vars`.
 *
 * Enforces:
 * 1. Key Naming:
 *    - Every variable MUST start with `NEXT_PUBLIC_`.
 *    - No variable may contain secret keywords:
 *      SECRET, PRIVATE, SERVICE_ROLE, PASSWORD, PASSPHRASE,
 *      MNEMONIC, ADMIN_KEY, MASTER_KEY, ACCESS_TOKEN, AUTH_TOKEN,
 *      SIGNING_KEY, ENCRYPTION_KEY.
 *
 * 2. Value Deep Inspection:
 *    - No 32-byte / 64-hex EVM private keys (0x... or plain 64 hex chars).
 *    - No PEM private key blocks (-----BEGIN ... PRIVATE KEY-----).
 *    - JWT inspection: If a JWT is detected, its payload is decoded;
 *      role MUST be 'anon'. Tokens with 'service_role', 'supabase_admin', etc. fail.
 *    - No known high-risk cloud API keys (e.g. AWS AKIA, OpenAI sk-, GitHub PATs, Slack tokens, Stripe live keys).
 *    - No 12 or 24-word BIP-39 mnemonic seed phrases.
 */

export const FORBIDDEN_KEY_PATTERNS = [
  /(?:^|_)SECRET(?:_|$)/i,
  /(?:^|_)PRIVATE(?:_|$)/i,
  /(?:^|_)SERVICE_ROLE(?:_|$)/i,
  /(?:^|_)PASSWORD(?:_|$)/i,
  /(?:^|_)PASSPHRASE(?:_|$)/i,
  /(?:^|_)MNEMONIC(?:_|$)/i,
  /(?:^|_)ADMIN_KEY(?:_|$)/i,
  /(?:^|_)MASTER_KEY(?:_|$)/i,
  /(?:^|_)SIGNING_KEY(?:_|$)/i,
  /(?:^|_)ENCRYPTION_KEY(?:_|$)/i,
  /(?:^|_)AUTH_TOKEN(?:_|$)/i,
  /(?:^|_)ACCESS_TOKEN(?:_|$)/i,
];

/** Strip JSONC comments so the config parses as JSON. */
export function stripJsonc(raw) {
  let out = '';
  let inStr = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    const n = raw[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i++; }
      continue;
    }
    if (inStr) {
      out += c;
      if (c === '\\') { out += n ?? ''; i++; }
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

/** Helper to decode JWT payload safely. */
export function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Inspect a single key/value pair. Returns array of error strings (empty if clean).
 * @param {string} key
 * @param {unknown} rawValue
 * @returns {string[]}
 */
export function inspectVar(key, rawValue) {
  const errors = [];
  if (key === '_comment') return errors;

  // 1. Key check: Must start with NEXT_PUBLIC_
  if (!key.startsWith('NEXT_PUBLIC_')) {
    errors.push(`Key "${key}" does not start with NEXT_PUBLIC_. Only public client-facing variables may be committed to wrangler.jsonc vars.`);
  }

  // Key check: Forbidden sensitive keywords
  for (const pattern of FORBIDDEN_KEY_PATTERNS) {
    if (pattern.test(key)) {
      errors.push(`Key "${key}" contains forbidden sensitive keyword matching ${pattern.toString()}.`);
    }
  }

  // 2. Value deep inspection
  const value = String(rawValue).trim();

  // 2a. Raw 32-byte hex private key (64 hex characters, with or without 0x)
  if (/^0x[a-fA-F0-9]{64}$/.test(value) || /^[a-fA-F0-9]{64}$/.test(value)) {
    errors.push(`Value for "${key}" matches a 64-hex EVM private key signature.`);
  }

  // 2b. PEM private key block
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i.test(value)) {
    errors.push(`Value for "${key}" contains a PEM private key block.`);
  }

  // 2c. JWT inspection
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    const payload = decodeJwtPayload(value);
    if (payload && typeof payload === 'object') {
      if (payload.role && payload.role !== 'anon') {
        errors.push(`Value for "${key}" is a JWT with privileged role "${payload.role}". Only public "anon" tokens are permitted.`);
      }
    }
  }

  // 2d. Cloud/Provider secret patterns
  if (/^AKIA[0-9A-Z]{16}$/.test(value)) {
    errors.push(`Value for "${key}" matches an AWS Access Key ID.`);
  }
  if (/^sk-(?:proj-)?[a-zA-Z0-9_-]{20,}$/.test(value)) {
    errors.push(`Value for "${key}" matches an OpenAI Secret Key.`);
  }
  if (/^gh[pousr]_[a-zA-Z0-9]{36,}$/.test(value) || /^github_pat_[a-zA-Z0-9_]{82}$/.test(value)) {
    errors.push(`Value for "${key}" matches a GitHub Access Token.`);
  }
  if (/^xox[baprs]-[0-9a-zA-Z]{10,}/.test(value)) {
    errors.push(`Value for "${key}" matches a Slack Token.`);
  }
  if (/^sk_live_[0-9a-zA-Z]{24,}$/.test(value)) {
    errors.push(`Value for "${key}" matches a Stripe Live Secret Key.`);
  }

  // 2e. BIP-39 Mnemonic phrase (12 or 24 space-separated lowercase words)
  const words = value.split(/\s+/);
  if ((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w))) {
    errors.push(`Value for "${key}" matches a 12/24-word seed phrase pattern.`);
  }

  return errors;
}

/**
 * Inspect an entire vars dictionary.
 * @param {Record<string, unknown>} vars
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function inspectWranglerVars(vars) {
  const allErrors = [];
  if (!vars || typeof vars !== 'object') {
    return { valid: true, errors: [] };
  }

  for (const [key, val] of Object.entries(vars)) {
    const errs = inspectVar(key, val);
    if (errs.length > 0) {
      allErrors.push(...errs);
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
  };
}
