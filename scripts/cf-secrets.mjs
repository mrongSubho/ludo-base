#!/usr/bin/env node
/**
 * scripts/cf-secrets.mjs — provision the Cloudflare Worker's Production secrets.
 *
 * Values are read from .env.local at runtime (never hardcoded, never printed).
 * Every private key is derived and compared against the address registered on the
 * live Base Sepolia contracts; a mismatch aborts before anything is sent.
 * The payload is piped to `wrangler secret bulk` on stdin (no temp file on disk).
 * In JSON mode a value of `null` deletes the secret — so the whole wipe-and-
 * resubmit is one request.
 *
 * Usage:
 *   node scripts/cf-secrets.mjs --dry-run     print the plan, change nothing
 *   node scripts/cf-secrets.mjs               safe fix (default)
 *   node scripts/cf-secrets.mjs --wipe        full wipe-and-resubmit
 *
 * Default (safe fix — no downtime, only the typo is deleted):
 *   SET     SUPABASE_SERVICE_ROLE_KEY, NEYNAR_API_KEY, EDGE_SETTLE_PRIVATE_KEY,
 *           MISSION_OP_PRIVATE_KEY, MISSION_PROGRESS_PRIVATE_KEY, ETHERSCAN_API_KEY,
 *           VAPID_SUBJECT
 *   DELETE  ETHERSCHAIN_API_KEY        (misnamed — code reads ETHERSCAN_API_KEY)
 *   UNTOUCHED  VAPID_PRIVATE_KEY       (live prod pair — see --reset-vapid)
 *             CHIPS_ADDRESS, CLAIM_HUB_ADDRESS, MATCH_POOL_ADDRESS,
 *             MISSION_CLAIM_ADDRESS, SEASON_CLAIM_ADDRESS   (script-only; see --wipe)
 *
 * --wipe (the full reset):
 *   + SET    VAPID_PRIVATE_KEY from .env.local (pair consistency is validated)
 *   + DELETE the 5 script-only address secrets above (the Worker never reads them)
 *   --keep-address-secrets opts out of just those 5 deletions
 *   --reset-vapid alone adds VAPID_PRIVATE_KEY without the address deletions
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createECDH } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env.local");
const WRANGLER = path.join(ROOT, "node_modules", ".bin", "wrangler");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const wipe = argv.includes("--wipe");
const resetVapid = wipe || argv.includes("--reset-vapid");
const keepAddressSecrets = argv.includes("--keep-address-secrets");

// Private keys -> the address each live contract has registered. Verified via
// `cast call` on Base Sepolia 2026-10-23.
const KEY_CHECKS = [
  { env: "EDGE_SETTLE_PRIVATE_KEY", expect: "0x77BCbB1EE19b7DEc89D7e13Fe136d2774F24A0E2", role: "MatchPool(0x4740048b).edgeSigner()" },
  { env: "MISSION_OP_PRIVATE_KEY", expect: "0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF", role: "MissionClaim(0x1A337180).opKey()" },
  { env: "MISSION_PROGRESS_PRIVATE_KEY", expect: "0xCE2C06C39F1D852b758c93db4273Aa4E43A15CA2", role: "MissionSystem(0x663d7c6b).progressOracle()" },
];

const SCRIPT_ONLY_ADDRESS_SECRETS = [
  "CHIPS_ADDRESS",
  "CLAIM_HUB_ADDRESS",
  "MATCH_POOL_ADDRESS",
  "MISSION_CLAIM_ADDRESS",
  "SEASON_CLAIM_ADDRESS",
];

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Minimal .env parser. Inline comments are NOT stripped — a value may contain '#'. */
function loadEnv(file) {
  const out = {};
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function normalizePk(pk) {
  return pk.startsWith("0x") || pk.startsWith("0X") ? pk : `0x${pk}`;
}

/** Derive the VAPID public key (base64url, uncompressed P-256 point) from the private scalar. */
function vapidPublicFromPrivate(privB64url) {
  const d = Buffer.from(privB64url, "base64url");
  if (d.length !== 32) throw new Error(`VAPID private key is ${d.length} bytes, expected 32`);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  return Buffer.from(ecdh.getPublicKey(null, "uncompressed")).toString("base64url");
}

const env = loadEnv(ENV_FILE);

// ---- 1. required values present -------------------------------------------
const required = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEYNAR_API_KEY",
  "EDGE_SETTLE_PRIVATE_KEY",
  "MISSION_OP_PRIVATE_KEY",
  "MISSION_PROGRESS_PRIVATE_KEY",
  "ETHERSCAN_API_KEY",
  "VAPID_SUBJECT",
  ...(resetVapid ? ["VAPID_PRIVATE_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"] : []),
];
const missing = required.filter((k) => !env[k] || !env[k].trim());
if (missing.length > 0) die(`missing in ${path.relative(ROOT, ENV_FILE)}: ${missing.join(", ")}`);

// ---- 2. safety gate: every key must match its on-chain registration --------
console.log("\nValidating keys against live Base Sepolia registrations:");
for (const { env: name, expect, role } of KEY_CHECKS) {
  const derived = privateKeyToAccount(normalizePk(env[name])).address;
  if (derived.toLowerCase() !== expect.toLowerCase()) {
    die(`${name} derives to ${derived}, but ${role} is ${expect}. Refusing to push a wrong key.`);
  }
  console.log(`  ✔ ${name} → ${derived} (${role})`);
}
if (resetVapid) {
  const derivedPub = vapidPublicFromPrivate(env.VAPID_PRIVATE_KEY);
  if (derivedPub !== env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    die(
      "VAPID pair in .env.local is inconsistent:\n" +
        `  private derives to public ${derivedPub}\n` +
        `  but NEXT_PUBLIC_VAPID_PUBLIC_KEY is ${env.NEXT_PUBLIC_VAPID_PUBLIC_KEY}\n` +
        "Fix the pair in .env.local (or drop --reset-vapid to keep the live dashboard key)."
    );
  }
  console.log("  ✔ VAPID_PRIVATE_KEY → matches NEXT_PUBLIC_VAPID_PUBLIC_KEY (pair consistent)");
}

// ---- 3. build the payload (null = delete) -----------------------------------
const set = {
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  NEYNAR_API_KEY: env.NEYNAR_API_KEY,
  EDGE_SETTLE_PRIVATE_KEY: env.EDGE_SETTLE_PRIVATE_KEY,
  MISSION_OP_PRIVATE_KEY: env.MISSION_OP_PRIVATE_KEY,
  MISSION_PROGRESS_PRIVATE_KEY: env.MISSION_PROGRESS_PRIVATE_KEY,
  ETHERSCAN_API_KEY: env.ETHERSCAN_API_KEY,
  VAPID_SUBJECT: env.VAPID_SUBJECT,
  ...(resetVapid ? { VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY } : {}),
};
const del = ["ETHERSCHAIN_API_KEY"];
if (wipe && !keepAddressSecrets) del.push(...SCRIPT_ONLY_ADDRESS_SECRETS);

const payload = { ...set };
for (const name of del) payload[name] = null;

// ---- 4. print the plan (names only — never values) ---------------------------
console.log(`\nPlan for Worker "ludo-base" (Production)${wipe ? " — WIPE MODE" : ""}:`);
for (const name of Object.keys(set)) console.log(`  SET    ${name}`);
for (const name of del) console.log(`  DELETE ${name}`);
console.log(`\n${Object.keys(payload).length} operations in one request.`);

if (dryRun) {
  console.log("\n--dry-run: nothing was sent. Re-run without --dry-run to apply.\n");
  process.exit(0);
}

// ---- 5. apply ----------------------------------------------------------------
function wrangler(args, input) {
  const res = spawnSync(WRANGLER, args, { cwd: ROOT, input, encoding: "utf8" });
  process.stdout.write(res.stdout ?? "");
  process.stderr.write(res.stderr ?? "");
  return res.status ?? 1;
}

console.log("\nSending to Cloudflare…");
let code = wrangler(["secret", "bulk"], JSON.stringify(payload));
if (code !== 0) die(`wrangler secret bulk exited ${code}`);

console.log("\nResulting Production secrets:");
code = wrangler(["secret", "list"]);
if (code !== 0) die(`wrangler secret list exited ${code}`);

console.log(
  "\nDone. Plain (non-secret) variables are set from .env.local by\n" +
    "`opennextjs-cloudflare deploy` — no dashboard paste needed. Secrets are managed\n" +
    "by this script only.\n"
);
