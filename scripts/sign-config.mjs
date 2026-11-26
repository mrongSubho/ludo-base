#!/usr/bin/env node
/**
 * Generate P-256 signing keys or sign a versioned Config Registry envelope for CONFIG_KV (`config:v1`).
 *
 * Usage:
 *   node scripts/sign-config.mjs --keygen
 *   node scripts/sign-config.mjs --sign config.json > signed-config-v1.json
 *   (Reads private JWK from process.env.CONFIG_SIGNING_JWK or --key <file.jwk>)
 */
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

function toBase64Url(bytes) {
    return Buffer.from(bytes).toString('base64url');
}

function stableSortValue(val) {
    if (Array.isArray(val)) return val.map(stableSortValue);
    if (val && typeof val === 'object') {
        const out = {};
        for (const k of Object.keys(val).sort()) {
            out[k] = stableSortValue(val[k]);
        }
        return out;
    }
    return val;
}

const args = process.argv.slice(2);

if (args.includes('--keygen')) {
    const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
    const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
    console.log(
        JSON.stringify(
            {
                NEXT_PUBLIC_CONFIG_PUBKEY: JSON.stringify(publicJwk),
                CONFIG_SIGNING_JWK: JSON.stringify(privateJwk),
            },
            null,
            2,
        ),
    );
    process.exit(0);
}

const signIdx = args.indexOf('--sign');
if (signIdx !== -1) {
    const inputPath = args[signIdx + 1];
    if (!inputPath) {
        console.error('Usage: node scripts/sign-config.mjs --sign <buckets-or-config.json> [--key <jwk-file>]');
        process.exit(1);
    }
    const keyFlagIdx = args.indexOf('--key');
    const rawJwk =
        keyFlagIdx !== -1 && args[keyFlagIdx + 1]
            ? readFileSync(args[keyFlagIdx + 1], 'utf8')
            : process.env.CONFIG_SIGNING_JWK;
    if (!rawJwk) {
        console.error('Missing CONFIG_SIGNING_JWK env var or --key <file>');
        process.exit(1);
    }
    const privateJwk = JSON.parse(rawJwk);
    const parsed = JSON.parse(readFileSync(inputPath, 'utf8'));
    const buckets = parsed.buckets ?? parsed;
    const version = Number(parsed.version ?? 1);
    const issuedAt = new Date().toISOString();
    const keyId = parsed.keyId || 'k1';

    const bytes = new TextEncoder().encode(
        JSON.stringify({ version, issuedAt, buckets: stableSortValue(buckets) }),
    );
    const key = await subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes);

    const envelope = {
        version,
        issuedAt,
        buckets,
        alg: 'ECDSA-P256-SHA256',
        keyId,
        signature: toBase64Url(sig),
    };
    console.log(JSON.stringify(envelope, null, 2));
    process.exit(0);
}

console.error('Specify --keygen or --sign <input.json>');
process.exit(1);
