/**
 * ECDH public-key validation and canonicalisation (Phase 3 / SEC-25).
 *
 * The route used to persist the posted JWK verbatim:
 *
 *   upsert({ wallet_address, ecdh_pubkey: publicKey })
 *
 * A P-256 JWK may carry `d` — the private scalar. Nothing rejected it, so a
 * client could post `{ kty, crv, x, y, d }`, have the private key written to
 * `players.ecdh_pubkey`, and then read it back out of `GET /api/profile/ecdh`,
 * which returns the stored blob to any session-holder. Worse, every other
 * recipient would then derive a shared secret from a key the attacker controls.
 *
 * So the key is **rebuilt from the four fields we accept** rather than stored.
 * Anything else the client sent — `d`, `key_ops`, `ext`, `alg`, unknown members —
 * is dropped by construction, not filtered by a blocklist.
 */

/** Exactly the members we persist. Nothing else can survive this function. */
export interface CanonicalP256Jwk {
    kty: 'EC';
    crv: 'P-256';
    x: string;
    y: string;
}

/** base64url, no padding, exactly 32 bytes of payload. */
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;

export type JwkVerdict =
    | { ok: true; key: CanonicalP256Jwk }
    | { ok: false; error: string };

/**
 * Validate and canonicalise a posted JWK.
 *
 * Returns a NEW object built from the accepted fields only. Callers must persist
 * `verdict.key`, never the input.
 */
export function canonicalizeP256Jwk(input: unknown): JwkVerdict {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, error: 'publicKey must be a JWK object' };
    }
    const jwk = input as Record<string, unknown>;

    if (jwk.kty !== 'EC') return { ok: false, error: 'kty must be EC' };
    if (jwk.crv !== 'P-256') return { ok: false, error: 'crv must be P-256' };

    // A private scalar, or any other unexpected member, is a hard refusal rather
    // than something to strip silently: a client posting `d` has a bug or an
    // intent, and neither should be quietly accepted.
    for (const forbidden of ['d', 'key_ops', 'ext', 'alg', 'use'] as const) {
        if (jwk[forbidden] !== undefined) {
            return { ok: false, error: `publicKey must not contain "${forbidden}"` };
        }
    }

    const { x, y } = jwk;
    if (typeof x !== 'string' || typeof y !== 'string') {
        return { ok: false, error: 'x and y are required base64url strings' };
    }
    if (!BASE64URL_32.test(x)) return { ok: false, error: 'x must be 32 bytes of base64url' };
    if (!BASE64URL_32.test(y)) return { ok: false, error: 'y must be 32 bytes of base64url' };

    return { ok: true, key: { kty: 'EC', crv: 'P-256', x, y } };
}

/** True when a stored value is a well-formed canonical key (drift detector). */
export function isCanonicalP256Jwk(value: unknown): value is CanonicalP256Jwk {
    const v = canonicalizeP256Jwk(value);
    return v.ok;
}
